import { IBreaker } from './breaker/Breaker';
import { CancellationToken } from './CancellationToken';
import { EventEmitter } from './common/Event';
import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { BrokenCircuitError, TaskCancelledError } from './errors/Errors';
import { IsolatedCircuitError } from './errors/IsolatedCircuitError';
import { FailureReason, IDefaultPolicyContext, IPolicy } from './Policy';

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

export interface ICircuitBreakerOptions {
  breaker: IBreaker;
  halfOpenAfter: number;
}

type InnerState =
  | { value: CircuitState.Closed }
  | { value: CircuitState.Isolated; counters: number }
  | { value: CircuitState.Open; openedAt: number }
  | { value: CircuitState.HalfOpen; test: Promise<any> };

export class CircuitBreakerPolicy implements IPolicy {
  private readonly breakEmitter = new EventEmitter<FailureReason<unknown> | { isolated: true }>();
  private readonly resetEmitter = new EventEmitter<void>();
  private readonly halfOpenEmitter = new EventEmitter<void>();
  private readonly stateChangeEmitter = new EventEmitter<CircuitState>();
  private innerLastFailure?: FailureReason<unknown>;
  private innerState: InnerState = { value: CircuitState.Closed };

  /**
   * Event emitted when the circuit breaker opens.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onBreak = this.breakEmitter.addListener;

  /**
   * Event emitted when the circuit breaker resets.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onReset = this.resetEmitter.addListener;

  /**
   * Event emitted when the circuit breaker is half open (running a test call).
   * Either `onBreak` on `onReset` will subsequently fire.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onHalfOpen = this.halfOpenEmitter.addListener;

  /**
   * Fired whenever the circuit breaker state changes.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onStateChange = this.stateChangeEmitter.addListener;

  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onFailure = this.executor.onFailure;

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
  ) {}

  /**
   * Manually holds open the circuit breaker.
   * @returns A handle that keeps the breaker open until `.dispose()` is called.
   */
  public isolate() {
    if (this.innerState.value !== CircuitState.Isolated) {
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
    cancellationToken = CancellationToken.None,
  ): Promise<T> {
    const state = this.innerState;
    switch (state.value) {
      case CircuitState.Closed:
        const result = await this.executor.invoke(fn, { cancellationToken });
        if ('success' in result) {
          this.options.breaker.success(state.value);
        } else {
          this.innerLastFailure = result;
          if (this.options.breaker.failure(state.value)) {
            this.open(result);
          }
        }

        return returnOrThrow(result);

      case CircuitState.HalfOpen:
        await state.test.catch(() => undefined);
        if (this.state === CircuitState.Closed && cancellationToken.isCancellationRequested) {
          throw new TaskCancelledError();
        }

        return this.execute(fn);

      case CircuitState.Open:
        if (Date.now() - state.openedAt < this.options.halfOpenAfter) {
          throw new BrokenCircuitError();
        }
        const test = this.halfOpen(fn, cancellationToken);
        this.innerState = { value: CircuitState.HalfOpen, test };
        this.stateChangeEmitter.emit(CircuitState.HalfOpen);
        return test;

      case CircuitState.Isolated:
        throw new IsolatedCircuitError();

      default:
        throw new Error(`Unexpected circuit state ${state}`);
    }
  }

  private async halfOpen<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    cancellationToken: CancellationToken,
  ): Promise<T> {
    this.halfOpenEmitter.emit();

    try {
      const result = await this.executor.invoke(fn, { cancellationToken });
      if ('success' in result) {
        this.options.breaker.success(CircuitState.HalfOpen);
        this.close();
      } else {
        this.innerLastFailure = result;
        this.options.breaker.failure(CircuitState.HalfOpen);
        this.open(result);
      }

      return returnOrThrow(result);
    } catch (err) {
      // It's an error, but not one the circuit is meant to retry, so
      // for our purposes it's a success. Task failed successfully!
      this.close();
      throw err;
    }
  }

  private open(reason: FailureReason<unknown>) {
    if (this.state === CircuitState.Isolated || this.state === CircuitState.Open) {
      return;
    }

    this.innerState = { value: CircuitState.Open, openedAt: Date.now() };
    this.breakEmitter.emit(reason);
    this.stateChangeEmitter.emit(CircuitState.Open);
  }

  private close() {
    if (this.state === CircuitState.HalfOpen) {
      this.innerState = { value: CircuitState.Closed };
      this.resetEmitter.emit();
      this.stateChangeEmitter.emit(CircuitState.Closed);
    }
  }
}
