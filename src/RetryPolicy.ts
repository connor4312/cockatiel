import {
  ExponentialBackoff,
  IBackoff,
  IBackoffFactory,
  IExponentialBackoffOptions,
} from './backoff/Backoff';
import { CompositeBackoff, CompositeBias } from './backoff/CompositeBackoff';
import { ConstantBackoff } from './backoff/ConstantBackoff';
import { DelegateBackoff, DelegateBackoffFn } from './backoff/DelegateBackoff';
import { IterableBackoff } from './backoff/IterableBackoff';
import { CancellationToken } from './CancellationToken';
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
 * Context passed into backoff delegated.
 */
export interface IRetryBackoffContext<R> extends IRetryContext {
  /**
   * The result of the last method call. Either a thrown error, or a value
   * that we determined should be retried upon.
   */
  result: FailureReason<R>;
}

export interface IRetryPolicyConfig {
  backoff?: IBackoffFactory<IRetryBackoffContext<unknown>>;

  /**
   * Whether to unreference the internal timer. This means the policy will not
   * keep the Node.js even loop active. Defaults to `false`.
   */
  unref?: boolean;
}

export class RetryPolicy implements IPolicy<IRetryContext> {
  private readonly onGiveUpEmitter = new EventEmitter<FailureReason<unknown>>();
  private readonly onRetryEmitter = new EventEmitter<FailureReason<unknown> & { delay: number }>();

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
   * Emitter that fires when we retry a call, before any backoff.
   *
   */
  // tslint:disable-next-line: member-ordering
  public readonly onRetry = this.onRetryEmitter.addListener;

  /**
   * Emitter that fires when we're no longer retrying a call and are giving up.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onGiveUp = this.onGiveUpEmitter.addListener;

  constructor(
    private options: Readonly<IRetryPolicyConfig>,
    private readonly executor: ExecuteWrapper,
  ) {}

  /**
   * Sets the number of retry attempts for the function.
   * @param count Retry attempts to make
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
  public exponential<S>(options: Partial<IExponentialBackoffOptions<S>> = {}) {
    return this.composeBackoff('b', new ExponentialBackoff(options));
  }

  /**
   * Sets the baackoff to use for retries.
   */
  public backoff(backoff: IBackoffFactory<IRetryBackoffContext<unknown>>) {
    return this.composeBackoff('b', backoff);
  }

  /**
   * When retrying, a referenced timer is created. This means the Node.js event
   * loop is kept active while we're delaying a retried call. Calling this
   * method on the retry builder will unreference the timer, allowing the
   * process to exit even if a retry might still be pending.
   */
  public dangerouslyUnref() {
    return this.derivePolicy({ ...this.options, unref: true });
  }

  /**
   * Executes the given function with retries.
   * @param fn Function to run
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T>(
    fn: (context: IRetryContext) => PromiseLike<T> | T,
    cancellationToken = CancellationToken.None,
  ): Promise<T> {
    const factory: IBackoffFactory<IRetryBackoffContext<unknown>> =
      this.options.backoff || new ConstantBackoff(0, 1);
    let backoff: IBackoff<IRetryBackoffContext<unknown>> | undefined;
    for (let retries = 0; ; retries++) {
      const result = await this.executor.invoke(fn, { attempt: retries, cancellationToken });
      if ('success' in result) {
        return result.success;
      }

      if (!cancellationToken.isCancellationRequested) {
        const context = { attempt: retries + 1, cancellationToken, result };
        if (retries === 0) {
          backoff = factory.next(context);
        } else if (backoff) {
          backoff = backoff.next(context);
        }

        if (backoff) {
          const delayDuration = backoff.duration;
          const delayPromise = delay(delayDuration, !!this.options.unref);
          // A little sneaky reordering here lets us use Sinon's fake timers
          // when we get an emission in our tests.
          this.onRetryEmitter.emit({ ...result, delay: delayDuration });
          await delayPromise;
          continue;
        }
      }

      this.onGiveUpEmitter.emit(result);
      if ('error' in result) {
        throw result.error;
      }

      return result.value;
    }
  }

  private composeBackoff(
    bias: CompositeBias,
    backoff: IBackoffFactory<IRetryBackoffContext<unknown>>,
  ) {
    if (this.options.backoff) {
      backoff = new CompositeBackoff(bias, this.options.backoff, backoff);
    }

    return this.derivePolicy({ ...this.options, backoff });
  }

  private derivePolicy(newOptions: Readonly<IRetryPolicyConfig>) {
    const p = new RetryPolicy(newOptions, this.executor.derive());
    p.onRetry(evt => this.onRetryEmitter.emit(evt));
    return p;
  }
}
