import { CancellationToken, CancellationTokenSource } from './CancellationToken';
import { EventEmitter } from './common/Event';
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
  cancellation: CancellationToken;
}

export class TimeoutPolicy implements IPolicy<ICancellationContext> {
  private readonly timeoutEmitter = new EventEmitter<void>();

  /**
   * Event that fires when a function times out.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onTimeout = this.timeoutEmitter.addListener;

  constructor(
    private readonly duration: number,
    private readonly strategy: TimeoutStrategy,
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
    const t = new TimeoutPolicy(this.duration, this.strategy, true);
    t.onTimeout(() => this.timeoutEmitter.emit());
    return t;
  }

  /**
   * Executes the given function.
   * @param fn -- Function to execute. Takes in a nested cancellation token.
   * @throws a {@link TaskCancelledError} if a timeout occurs
   */
  public async execute<T>(fn: (context: ICancellationContext) => PromiseLike<T> | T): Promise<T> {
    const cts = new CancellationTokenSource();
    const timer = setTimeout(() => cts.cancel(), this.duration);
    if (this.unref) {
      timer.unref();
    }

    try {
      if (this.strategy === TimeoutStrategy.Cooperative) {
        return await fn({ cancellation: cts.token });
      }

      return await Promise.race<T>([
        fn({ cancellation: cts.token }),
        cts.token.cancellation(cts.token).then(() => {
          throw new TaskCancelledError(`Operation timed out after ${this.duration}ms`);
        }),
      ]);
    } finally {
      cts.cancel();
      clearTimeout(timer);
    }
  }
}
