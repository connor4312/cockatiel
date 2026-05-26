import { ConstantBackoff, IBackoff, IBackoffFactory } from './backoff/Backoff.js';
import { IBreaker } from './breaker/Breaker.js';
import { neverAbortedSignal } from './common/abort.js';
import { defer } from './common/defer.js';
import { EventEmitter } from './common/Event.js';
import { ExecuteWrapper, returnOrThrow } from './common/Executor.js';
import { BrokenCircuitError, HydratingCircuitError, TaskCancelledError } from './errors/Errors.js';
import { IsolatedCircuitError } from './errors/IsolatedCircuitError.js';
import { FailureReason, IDefaultPolicyContext, IPolicy } from './Policy.js';

export enum CircuitState {
  /**
   * Normal operation. Execution of actions allowed.
   */
  Closed,

  /**
   * The automated controller has opened the circuit. Execution of actions blocked.
   */
  Open,

  /**
   * Recovering from open state, after the automated break duration has
   * expired. Execution of actions permitted. Success of subsequent action/s
   * controls onward transition to Open or Closed state.
   */
  HalfOpen,

  /**
   * Circuit held manually in an open state. Execution of actions blocked.
   */
  Isolated,
}

/**
 * Context passed into halfOpenAfter backoff delegate.
 */
export interface IHalfOpenAfterBackoffContext extends IDefaultPolicyContext {
  /**
   * The consecutive number of times the circuit has entered the
   * {@link CircuitState.Open} state.
   */
  attempt: number;
  /**
   * The result of the last method call that caused the circuit to enter the
   * {@link CircuitState.Open} state. Either a thrown error, or a value that we
   * determined should open the circuit.
   */
  result: FailureReason<unknown>;
}

export interface ICircuitBreakerOptions {
  breaker: IBreaker;

  /**
   * When to (potentially) enter the {@link CircuitState.HalfOpen} state from
   * the {@link CircuitState.Open} state. Either a duration in milliseconds or a
   * backoff factory.
   */
  halfOpenAfter: number | IBackoffFactory<IHalfOpenAfterBackoffContext>;

  /**
   * Controls how many calls are sampled while the circuit is half-open before
   * deciding whether to close or reopen it. Defaults to a single call with no
   * permitted failures, matching the traditional circuit breaker behavior.
   */
  halfOpenSampling?: IHalfOpenSamplingOptions;

  /**
   * Initial state from a previous call to {@link CircuitBreakerPolicy.toJSON}.
   */
  initialState?: unknown;
}

export interface IHalfOpenSamplingOptions {
  /**
   * Number of calls to allow through while half-open before closing the circuit
   * if the failure threshold is not exceeded.
   */
  calls: number;

  /**
   * Percentage (from 0 to 1) of half-open calls that may fail before the
   * circuit is reopened.
   */
  threshold: number;
}

type Deferred<T> = ReturnType<typeof defer<T>>;

type InnerState =
  | { value: CircuitState.Closed }
  | { value: CircuitState.Isolated; counters: number }
  | {
      value: CircuitState.Open;
      openedAt: number;
      attemptNo: number;
      backoff: IBackoff<IHalfOpenAfterBackoffContext>;
    }
  | {
      value: CircuitState.HalfOpen;
      attemptNo: number;
      backoff: IBackoff<IHalfOpenAfterBackoffContext>;
      decision: Deferred<void>;
      inFlight: number;
      successes: number;
      failures: number;
    };

interface ISerializedState {
  ownState: Partial<InnerState>;
  breakerState: unknown;
}

export class CircuitBreakerPolicy implements IPolicy {
  declare readonly _altReturn: never;

  private readonly breakEmitter = new EventEmitter<FailureReason<unknown> | { isolated: true }>();
  private readonly resetEmitter = new EventEmitter<void>();
  private readonly halfOpenEmitter = new EventEmitter<void>();
  private readonly stateChangeEmitter = new EventEmitter<CircuitState>();
  private readonly halfOpenAfterBackoffFactory: IBackoffFactory<IHalfOpenAfterBackoffContext>;
  private readonly halfOpenSampling: IHalfOpenSamplingOptions;
  private innerLastFailure?: FailureReason<unknown>;
  private innerState: InnerState = { value: CircuitState.Closed };

  /**
   * Event emitted when the circuit breaker opens.
   */
  public readonly onBreak = this.breakEmitter.addListener;

  /**
   * Event emitted when the circuit breaker resets.
   */
  public readonly onReset = this.resetEmitter.addListener;

  /**
   * Event emitted when the circuit breaker is half open (running a test call).
   * Either `onBreak` on `onReset` will subsequently fire.
   */
  public readonly onHalfOpen = this.halfOpenEmitter.addListener;

  /**
   * Fired whenever the circuit breaker state changes.
   */
  public readonly onStateChange = this.stateChangeEmitter.addListener;

  /**
   * @inheritdoc
   */
  public get onSuccess() {
    return this.executor.onSuccess;
  }

  /**
   * @inheritdoc
   */
  public get onFailure() {
    return this.executor.onFailure;
  }

  /**
   * Gets the current circuit breaker state.
   */
  public get state(): CircuitState {
    return this.innerState.value;
  }

  /**
   * Gets the last reason the circuit breaker failed.
   */
  public get lastFailure() {
    return this.innerLastFailure;
  }

  constructor(
    private readonly options: ICircuitBreakerOptions,
    private readonly executor: ExecuteWrapper,
  ) {
    this.halfOpenAfterBackoffFactory =
      typeof options.halfOpenAfter === 'number'
        ? new ConstantBackoff(options.halfOpenAfter)
        : options.halfOpenAfter;
    this.halfOpenSampling = this.createHalfOpenSamplingOptions(options.halfOpenSampling);

    if (options.initialState) {
      const initialState = options.initialState as ISerializedState;
      this.innerState = initialState.ownState as InnerState;
      this.options.breaker.state = initialState.breakerState;

      if (
        this.innerState.value === CircuitState.Open ||
        this.innerState.value === CircuitState.HalfOpen
      ) {
        this.innerLastFailure = { error: new HydratingCircuitError() };
        let backoff = this.halfOpenAfterBackoffFactory.next({
          attempt: 1,
          result: this.innerLastFailure,
          signal: neverAbortedSignal,
        });
        for (let i = 2; i <= this.innerState.attemptNo; i++) {
          backoff = backoff.next({
            attempt: i,
            result: this.innerLastFailure,
            signal: neverAbortedSignal,
          });
        }
        this.innerState.backoff = backoff;
      }
    }
  }

  /**
   * Manually holds open the circuit breaker.
   * @returns A handle that keeps the breaker open until `.dispose()` is called.
   */
  public isolate() {
    if (this.innerState.value !== CircuitState.Isolated) {
      if (this.innerState.value === CircuitState.HalfOpen) {
        this.innerState.decision.resolve();
      }

      this.innerState = { value: CircuitState.Isolated, counters: 0 };
      this.breakEmitter.emit({ isolated: true });
      this.stateChangeEmitter.emit(CircuitState.Isolated);
    }

    this.innerState.counters++;

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }

        disposed = true;
        if (this.innerState.value === CircuitState.Isolated && !--this.innerState.counters) {
          this.innerState = { value: CircuitState.Closed };
          this.resetEmitter.emit();
          this.stateChangeEmitter.emit(CircuitState.Closed);
        }
      },
    };
  }

  /**
   * Executes the given function.
   * @param fn Function to run
   * @throws a {@link BrokenCircuitError} if the circuit is open
   * @throws a {@link IsolatedCircuitError} if the circuit is held
   * open via {@link CircuitBreakerPolicy.isolate}
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal = neverAbortedSignal,
  ): Promise<T> {
    const state = this.innerState;
    switch (state.value) {
      case CircuitState.Closed:
        const result = await this.executor.invoke(fn, { signal });
        if ('success' in result) {
          this.options.breaker.success(state.value);
        } else {
          this.innerLastFailure = result;
          if (this.options.breaker.failure(state.value)) {
            this.open(result, signal);
          }
        }

        return returnOrThrow(result);

      case CircuitState.HalfOpen:
        return this.executeHalfOpen(fn, signal, state);

      case CircuitState.Open:
        if (Date.now() - state.openedAt < state.backoff.duration) {
          throw new BrokenCircuitError();
        }

        const halfOpenState: InnerState = {
          value: CircuitState.HalfOpen,
          backoff: state.backoff,
          attemptNo: state.attemptNo + 1,
          decision: defer(),
          inFlight: 0,
          successes: 0,
          failures: 0,
        };
        this.innerState = halfOpenState;
        this.halfOpenEmitter.emit();
        this.stateChangeEmitter.emit(CircuitState.HalfOpen);
        return this.executeHalfOpen(fn, signal, halfOpenState);

      case CircuitState.Isolated:
        throw new IsolatedCircuitError();

      default:
        throw new Error(`Unexpected circuit state ${state}`);
    }
  }

  private async executeHalfOpen<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal: AbortSignal,
    state: Extract<InnerState, { value: CircuitState.HalfOpen }>,
  ): Promise<T> {
    if (this.innerState !== state) {
      return this.execute(fn, signal);
    }

    if (state.successes + state.failures + state.inFlight >= this.halfOpenSampling.calls) {
      await state.decision.promise;
      if (this.state === CircuitState.Closed && signal.aborted) {
        throw new TaskCancelledError();
      }

      return this.execute(fn, signal);
    }

    state.inFlight++;

    let result;
    try {
      result = await this.executor.invoke(fn, { signal });
    } catch (err) {
      // It's an error, but not one the circuit is meant to retry, so
      // for our purposes it's a success. Task failed successfully!
      this.recordHalfOpenSuccess(state);
      throw err;
    }

    if ('success' in result) {
      this.recordHalfOpenSuccess(state);
    } else {
      this.innerLastFailure = result;
      this.recordHalfOpenFailure(state, result, signal);
    }

    return returnOrThrow(result);
  }

  /**
   * Captures circuit breaker state that can later be used to recreate the
   * breaker by passing `state` to the `circuitBreaker` function. This is
   * useful in cases like serverless functions where you may want to keep
   * the breaker state across multiple executions.
   */
  public toJSON(): unknown {
    const state = this.innerState;
    let ownState: Partial<InnerState>;
    if (state.value === CircuitState.HalfOpen) {
      ownState = {
        value: CircuitState.Open,
        openedAt: 0,
        attemptNo: state.attemptNo,
      };
    } else if (state.value === CircuitState.Open) {
      ownState = {
        value: CircuitState.Open,
        openedAt: state.openedAt,
        attemptNo: state.attemptNo,
      };
    } else {
      ownState = state;
    }

    return { ownState, breakerState: this.options.breaker.state } satisfies ISerializedState;
  }

  private recordHalfOpenSuccess(state: Extract<InnerState, { value: CircuitState.HalfOpen }>) {
    if (this.innerState !== state) {
      return;
    }

    state.inFlight--;
    state.successes++;
    this.maybeCompleteHalfOpen(state);
  }

  private recordHalfOpenFailure(
    state: Extract<InnerState, { value: CircuitState.HalfOpen }>,
    reason: FailureReason<unknown>,
    signal: AbortSignal,
  ) {
    if (this.innerState !== state) {
      return;
    }

    state.inFlight--;
    state.failures++;

    if (state.failures > this.halfOpenSampling.threshold * this.halfOpenSampling.calls) {
      this.options.breaker.failure(CircuitState.HalfOpen);
      this.open(reason, signal);
      return;
    }

    this.maybeCompleteHalfOpen(state);
  }

  private maybeCompleteHalfOpen(state: Extract<InnerState, { value: CircuitState.HalfOpen }>) {
    if (state.successes + state.failures < this.halfOpenSampling.calls || state.inFlight) {
      return;
    }

    this.close();
  }

  private open(reason: FailureReason<unknown>, signal: AbortSignal) {
    if (this.state === CircuitState.Isolated || this.state === CircuitState.Open) {
      return;
    }

    const previousState = this.innerState;
    const attemptNo =
      this.innerState.value === CircuitState.HalfOpen ? this.innerState.attemptNo : 1;
    const context = { attempt: attemptNo, result: reason, signal };
    const backoff =
      this.innerState.value === CircuitState.HalfOpen
        ? this.innerState.backoff.next(context)
        : this.halfOpenAfterBackoffFactory.next(context);

    this.innerState = { value: CircuitState.Open, openedAt: Date.now(), backoff, attemptNo };
    if (previousState.value === CircuitState.HalfOpen) {
      previousState.decision.resolve();
    }

    this.breakEmitter.emit(reason);
    this.stateChangeEmitter.emit(CircuitState.Open);
  }

  private close() {
    if (this.innerState.value === CircuitState.HalfOpen) {
      const state = this.innerState;
      this.options.breaker.success(CircuitState.HalfOpen);
      this.innerState = { value: CircuitState.Closed };
      state.decision.resolve();
      this.resetEmitter.emit();
      this.stateChangeEmitter.emit(CircuitState.Closed);
    }
  }

  private createHalfOpenSamplingOptions(options?: IHalfOpenSamplingOptions) {
    const halfOpenSampling = options ?? { calls: 1, threshold: 0 };

    if (!Number.isSafeInteger(halfOpenSampling.calls) || halfOpenSampling.calls < 1) {
      throw new RangeError(
        `CircuitBreaker halfOpenSampling.calls should be a positive integer, got ${halfOpenSampling.calls}`,
      );
    }

    if (
      !Number.isFinite(halfOpenSampling.threshold) ||
      halfOpenSampling.threshold < 0 ||
      halfOpenSampling.threshold >= 1
    ) {
      throw new RangeError(
        `CircuitBreaker halfOpenSampling.threshold should be between [0, 1), got ${halfOpenSampling.threshold}`,
      );
    }

    return { calls: halfOpenSampling.calls, threshold: halfOpenSampling.threshold };
  }
}
