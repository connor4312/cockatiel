import { IBackoff, IBackoffFactory } from './backoff/Backoff';
import { ConstantBackoff } from './backoff/ConstantBackoff';
import { neverAbortedSignal } from './common/abort';
import { EventEmitter } from './common/Event';
import { ExecuteWrapper } from './common/Executor';
import { FailureReason, IDefaultPolicyContext, IPolicy } from './Policy';

const delay = (duration: number, unref: boolean) =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, duration);
    if (unref) {
      timer.unref();
    }
  });

/**
 * Context passed into the execute method of the builder.
 */
export interface IRetryContext extends IDefaultPolicyContext {
  /**
   * The retry attempt, starting at 1 for calls into backoffs.
   */
  attempt: number;
}

/**
 * Context passed into backoff delegate.
 */
export interface IRetryBackoffContext<R> extends IRetryContext {
  /**
   * The result of the last method call. Either a thrown error, or a value
   * that we determined should be retried upon.
   */
  result: FailureReason<R>;
}

export interface IRetryPolicyConfig {
  backoff: IBackoffFactory<IRetryBackoffContext<unknown>>;
  maxAttempts: number;

  /**
   * Whether to unreference the internal timer. This means the policy will not
   * keep the Node.js even loop active. Defaults to `false`.
   */
  unref?: boolean;
}

export class RetryPolicy implements IPolicy<IRetryContext> {
  declare readonly _altReturn: never;

  private readonly onGiveUpEmitter = new EventEmitter<FailureReason<unknown>>();
  private readonly onRetryEmitter = new EventEmitter<FailureReason<unknown> & { delay: number }>();

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  /**
   * Emitter that fires when we retry a call, before any backoff.
   *
   */
  public readonly onRetry = this.onRetryEmitter.addListener;

  /**
   * Emitter that fires when we're no longer retrying a call and are giving up.
   */
  public readonly onGiveUp = this.onGiveUpEmitter.addListener;

  constructor(
    private options: Readonly<IRetryPolicyConfig>,
    private readonly executor: ExecuteWrapper,
  ) {}

  /**
   * When retrying, a referenced timer is created. This means the Node.js event
   * loop is kept active while we're delaying a retried call. Calling this
   * method on the retry builder will unreference the timer, allowing the
   * process to exit even if a retry might still be pending.
   */
  public dangerouslyUnref() {
    return new RetryPolicy({ ...this.options, unref: true }, this.executor.clone());
  }

  /**
   * Executes the given function with retries.
   * @param fn Function to run
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T>(
    fn: (context: IRetryContext) => PromiseLike<T> | T,
    signal = neverAbortedSignal,
  ): Promise<T> {
    const factory: IBackoffFactory<IRetryBackoffContext<unknown>> =
      this.options.backoff || new ConstantBackoff(0);
    let backoff: IBackoff<IRetryBackoffContext<unknown>> | undefined;
    for (let retries = 0; ; retries++) {
      const result = await this.executor.invoke(fn, { attempt: retries, signal });
      if ('success' in result) {
        return result.success;
      }

      if (!signal.aborted && retries < this.options.maxAttempts) {
        const context = { attempt: retries + 1, signal, result };
        backoff = backoff ? backoff.next(context) : factory.next(context);
        const delayDuration = backoff.duration;
        const delayPromise = delay(delayDuration, !!this.options.unref);
        // A little sneaky reordering here lets us use Sinon's fake timers
        // when we get an emission in our tests.
        this.onRetryEmitter.emit({ ...result, delay: delayDuration });
        await delayPromise;
        continue;
      }

      this.onGiveUpEmitter.emit(result);
      if ('error' in result) {
        throw result.error;
      }

      return result.value;
    }
  }
}
