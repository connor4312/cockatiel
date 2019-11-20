import { CancellationToken, CancellationTokenSource } from './CancellationToken';
import { EventEmitter } from './common/Event';
import { TaskCancelledError } from './errors/TaskCancelledError';

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

export class TimeoutPolicy {
  private readonly timeoutEmitter = new EventEmitter<void>();

  /**
   * Event that fires when a function times out.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onTimeout = this.timeoutEmitter.addListener;

  constructor(private readonly duration: number, private readonly strategy: TimeoutStrategy) {}

  /**
   * Executes the given function.
   * @param fn -- Function to execute. Takes in a nested cancellation token.
   * @throws a {@link TaskCancelledError} if a timeout occurs
   */
  public async execute<T>(
    fn: (cancellationToken: CancellationToken) => PromiseLike<T> | T,
  ): Promise<T> {
    const cts = new CancellationTokenSource();
    const timer = setTimeout(() => cts.cancel(), this.duration);

    try {
      if (this.strategy === TimeoutStrategy.Cooperative) {
        return await fn(cts.token);
      }

      return Promise.race<T>([
        fn(cts.token),
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
