import { IBreaker } from './breaker/Breaker';
import { EventEmitter } from './common/Event';
import { execute, returnOrThrow } from './common/execute';
import { BrokenCircuitError } from './errors/Errors';
import { IsolatedCircuitError } from './errors/IsolatedCircuitError';
import { FailureReason, IBasePolicyOptions } from './Policy';

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

export interface ICircuitBreakerOptions<R> extends IBasePolicyOptions<R> {
  breaker: IBreaker;
  halfOpenAfter: number;
}

type InnerState =
  | { value: CircuitState.Closed }
  | { value: CircuitState.Isolated; counters: number }
  | { value: CircuitState.Open; openedAt: number }
  | { value: CircuitState.HalfOpen; test: Promise<any> };

export class CircuitBreakerPolicy<R> {
  private readonly breakEmitter = new EventEmitter<FailureReason<R> | { isolated: true }>();
  private readonly resetEmitter = new EventEmitter<void>();
  private innerLastFailure?: FailureReason<R>;
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

  constructor(private readonly options: ICircuitBreakerOptions<R>) {}

  /**
   * Manually holds open the circuit breaker.
   * @returns A handle that keeps the breaker open until `.dispose()` is called.
   */
  public isolate() {
    if (this.innerState.value !== CircuitState.Isolated) {
      this.innerState = { value: CircuitState.Isolated, counters: 0 };
      this.breakEmitter.emit({ isolated: true });
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
        }
      },
    };
  }

  /**
   * Executes the given function.
   * @param fn -- Function to run
   * @throws a {@link BrokenCircuitError} if the circuit is open
   * @throws a {@link IsolatedCircuitError} if the circuit is held
   * open via {@link CircuitBreakerPolicy.isolate}
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T extends R>(fn: () => Promise<T> | T): Promise<T> {
    const state = this.innerState;
    switch (state.value) {
      case CircuitState.Closed:
        const result = await execute(this.options, fn);
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
        return this.execute(fn);

      case CircuitState.Open:
        if (Date.now() - state.openedAt < this.options.halfOpenAfter) {
          throw new BrokenCircuitError();
        }
        const test = this.halfOpen(fn);
        this.innerState = { value: CircuitState.HalfOpen, test };
        return test;

      case CircuitState.Isolated:
        throw new IsolatedCircuitError();

      default:
        throw new Error(`Unexpected circuit state ${state}`);
    }
  }

  private async halfOpen<T extends R>(fn: () => Promise<T> | T): Promise<T> {
    try {
      const result = await execute(this.options, fn);
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

  private open(reason: FailureReason<R>) {
    if (this.state === CircuitState.Isolated || this.state === CircuitState.Open) {
      return;
    }

    this.innerState = { value: CircuitState.Open, openedAt: Date.now() };
    this.breakEmitter.emit(reason);
  }

  private close() {
    if (this.state === CircuitState.HalfOpen) {
      this.innerState = { value: CircuitState.Closed };
      this.resetEmitter.emit();
    }
  }
}
