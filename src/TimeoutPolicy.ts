import { deriveAbortController } from './common/abort';
import { Event, EventEmitter, onAbort } from './common/Event';
import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { IPolicy } from './Policy';

export enum TimeoutStrategy {
  /**
   * Cooperative timeouts will simply abort the inner abort signal,
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

export interface ITimeoutOptions {
  /** Strategy for timeouts, "Cooperative", or "Accessive" */
  strategy: TimeoutStrategy;
  /**
   * Whether the AbortSignal should be aborted when the
   * function returns. Defaults to true.
   */
  abortOnReturn?: boolean;
}

export class TimeoutPolicy implements IPolicy<ICancellationContext> {
  declare readonly _altReturn: never;

  private readonly timeoutEmitter = new EventEmitter<void>();

  /**
   * @inheritdoc
   */
  public readonly onTimeout = this.timeoutEmitter.addListener;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  constructor(
    private readonly duration: number,
    private readonly options: ITimeoutOptions,
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
    const t = new TimeoutPolicy(this.duration, this.options, this.executor, true);
    return t;
  }

  /**
   * Executes the given function.
   * @param fn Function to execute. Takes in a nested abort signal.
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

    const onceAborted = onAbort(aborter.signal);
    const onCancelledListener = onceAborted(() => this.timeoutEmitter.emit());

    try {
      if (this.options.strategy === TimeoutStrategy.Cooperative) {
        return returnOrThrow(await this.executor.invoke(fn, context, aborter.signal));
      }

      return await this.executor
        .invoke(async () =>
          Promise.race<T>([
            Promise.resolve(fn(context, aborter.signal)),
            Event.toPromise(onceAborted).then(() => {
              throw new TaskCancelledError(`Operation timed out after ${this.duration}ms`);
            }),
          ]),
        )
        .then(returnOrThrow);
    } finally {
      onCancelledListener.dispose();
      if (this.options.abortOnReturn !== false) {
        aborter.abort();
      }
      clearTimeout(timer);
    }
  }
}
