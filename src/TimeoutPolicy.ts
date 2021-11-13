import { deriveAbortController, waitForAbort } from './common/abort';
import { EventEmitter } from './common/Event';
import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { IPolicy } from './Policy';

export enum TimeoutStrategy {
  /**
   * Cooperative timeouts will simply revoke the inner cancellation token,
   * assuming the caller handles cancellation and throws or returns appropriately.
   */
  Cooperative = 'optimistic',

  /**
   * Aggressive cancellation immediately throws
   */
  Aggressive = 'aggressive',
}

export interface ICancellationContext {
  signal: AbortSignal;
}

export class TimeoutPolicy implements IPolicy<ICancellationContext> {
  private readonly timeoutEmitter = new EventEmitter<void>();

  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onTimeout = this.timeoutEmitter.addListener;

  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onFailure = this.executor.onFailure;

  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onSuccess = this.executor.onSuccess;

  constructor(
    private readonly duration: number,
    private readonly strategy: TimeoutStrategy,
    private readonly executor = new ExecuteWrapper(),
    private readonly unref = false,
  ) {}

  /**
   * When timing out, a referenced timer is created. This means the Node.js
   * event loop is kept active while we're waiting for the timeout, as long as
   * the function hasn't returned. Calling this method on the timeout builder
   * will unreference the timer, allowing the process to exit even if a
   * timeout might still be happening.
   */
  public dangerouslyUnref() {
    const t = new TimeoutPolicy(this.duration, this.strategy, this.executor, true);
    return t;
  }

  /**
   * Executes the given function.
   * @param fn Function to execute. Takes in a nested cancellation token.
   * @throws a {@link TaskCancelledError} if a timeout occurs
   */
  public async execute<T>(
    fn: (context: ICancellationContext, signal: AbortSignal) => PromiseLike<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const aborter = deriveAbortController(signal);
    const timer = setTimeout(() => aborter.abort(), this.duration);
    if (this.unref) {
      timer.unref();
    }

    const context = { signal: aborter.signal };

    const onCancelledListener = () => this.timeoutEmitter.emit();
    aborter.signal.addEventListener('abort', onCancelledListener);

    try {
      if (this.strategy === TimeoutStrategy.Cooperative) {
        return returnOrThrow(await this.executor.invoke(fn, context, aborter.signal));
      }

      return await this.executor
        .invoke(async () =>
          Promise.race<T>([
            Promise.resolve(fn(context, aborter.signal)),
            waitForAbort(aborter.signal).then(() => {
              throw new TaskCancelledError(`Operation timed out after ${this.duration}ms`);
            }),
          ]),
        )
        .then(returnOrThrow);
    } finally {
      aborter.signal.removeEventListener('abort', onCancelledListener);
      aborter.abort();
      clearTimeout(timer);
    }
  }
}
