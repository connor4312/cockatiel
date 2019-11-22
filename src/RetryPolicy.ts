import { ExponentialBackoff, IBackoff, IExponentialBackoffOptions } from './backoff/Backoff';
import { CompositeBackoff, CompositeBias } from './backoff/CompositeBackoff';
import { ConstantBackoff } from './backoff/ConstantBackoff';
import { DelegateBackoff, DelegateBackoffFn } from './backoff/DelegateBackoff';
import { IterableBackoff } from './backoff/IterableBackoff';
import { EventEmitter } from './common/Event';
import { execute } from './common/execute';
import { FailureReason, IBasePolicyOptions, IPolicy } from './Policy';

const delay = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));

/**
 * Context passed into the execute method of the builder.
 */
export interface IRetryContext {
  /**
   * The retry attempt, starting at 1 for calls into backoffs.
   */
  attempt: number;
}

/**
 * Context passed into backoff delegated.
 */
export interface IRetryBackoffContext<R> extends IRetryContext {
  /**
   * The result of the last method call. Either a thrown error, or a value
   * that we determined should be retried upon.
   */
  result: FailureReason<R>;
}

export interface IRetryPolicyConfig extends IBasePolicyOptions {
  backoff?: IBackoff<IRetryBackoffContext<unknown>>;
}

export class RetryPolicy implements IPolicy<IRetryContext> {
  private onRetryEmitter = new EventEmitter<FailureReason<unknown> & { delay: number }>();
  private onGiveUpEmitter = new EventEmitter<FailureReason<unknown>>();

  /**
   * Emitter that fires when we retry a call, before any backoff.
   *
   */
  // tslint:disable-next-line: member-ordering
  public readonly onRetry = this.onRetryEmitter.addListener;

  /**
   * Emitter that fires when we retry a call.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onGiveUp = this.onGiveUpEmitter.addListener;

  constructor(private options: IRetryPolicyConfig) {}

  /**
   * Sets the number of retry attempts for the function.
   * @param count -- Retry attempts to make
   */
  public attempts(count: number) {
    return this.composeBackoff('a', new ConstantBackoff(1, count));
  }

  /**
   * Sets the delay between retries. Can be a single duration, of a list of
   * durations. If it's a list, it will also determine the number of backoffs.
   */
  public delay(amount: number | ReadonlyArray<number>) {
    return this.composeBackoff(
      'b',
      typeof amount === 'number' ? new ConstantBackoff(amount) : new IterableBackoff(amount),
    );
  }

  /**
   * Sets the baackoff to use for retries.
   */
  public delegate<S>(backoff: DelegateBackoffFn<IRetryBackoffContext<unknown>, S>) {
    return this.composeBackoff('b', new DelegateBackoff(backoff));
  }

  /**
   * Uses an exponential backoff for retries.
   */
  public exponential(options: IExponentialBackoffOptions<IRetryBackoffContext<unknown>>) {
    return this.composeBackoff('b', new ExponentialBackoff(options));
  }

  /**
   * Sets the baackoff to use for retries.
   */
  public backoff(backoff: IBackoff<IRetryBackoffContext<unknown>>) {
    return this.composeBackoff('b', backoff);
  }

  /**
   * Executes the given function with retries.
   * @param fn -- Function to run
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T>(fn: (context: IRetryContext) => PromiseLike<T> | T): Promise<T> {
    let backoff: IBackoff<IRetryBackoffContext<unknown>> | undefined =
      this.options.backoff || new ConstantBackoff(0, 1);
    for (let retries = 0; ; retries++) {
      const result = await execute(this.options, fn, { attempt: retries });
      if ('success' in result) {
        return result.success;
      }

      if (backoff) {
        const delayDuration = backoff.duration();
        const delayPromise = delay(delayDuration);
        // A little sneaky reordering here lets us use Sinon's fake timers
        // when we get an emission in our tests.
        this.onRetryEmitter.emit({ ...result, delay: delayDuration });
        await delayPromise;
        backoff = backoff.next({ attempt: retries + 1, result });
        continue;
      }

      this.onGiveUpEmitter.emit(result);
      if ('error' in result) {
        throw result.error;
      }

      return result.value;
    }
  }

  private composeBackoff(bias: CompositeBias, backoff: IBackoff<IRetryBackoffContext<unknown>>) {
    if (this.options.backoff) {
      backoff = new CompositeBackoff(bias, this.options.backoff, backoff);
    }

    this.options = { ...this.options, backoff };
    return this;
  }
}
