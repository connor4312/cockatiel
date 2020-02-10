import { CancellationToken, CancellationTokenSource } from './CancellationToken';
import { EventEmitter } from './common/Event';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { IPolicy } from './Policy';

export interface ITimeoutOptions {
  /**
   * Whether to unreference the internal timer. This means the policy will not
   * keep the Node.js even loop active. Defaults to `true`.
   */
  unref?: boolean;
}

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
  private readonly unref: boolean;

  /**
   * Event that fires when a function times out.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onTimeout = this.timeoutEmitter.addListener;

  constructor(
    private readonly duration: number,
    private readonly strategy: TimeoutStrategy,
    { unref = true }: ITimeoutOptions = {},
  ) {
    this.unref = unref;
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

      return Promise.race<T>([
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
