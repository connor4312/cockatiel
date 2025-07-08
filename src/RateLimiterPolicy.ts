import { neverAbortedSignal } from './common/abort';
import { EventEmitter } from './common/Event';
import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { TaskCancelledError } from './errors/Errors';
import { IDefaultPolicyContext, IPolicy } from './Policy';

export interface IRateLimiterOptions {
  /**
   * Maximum number of executions allowed within the interval.
   */
  bucketSize: number;

  /**
   * The time window in milliseconds for the rate limit.
   */
  interval: number;

  /**
   * Initial number of tokens available. Defaults to bucketSize.
   */
  initialTokens?: number;

  /**
   * Whether to queue executions when rate limit is exceeded.
   * If false, executions will be rejected immediately.
   * @default false
   */
  queueEnabled?: boolean;

  /**
   * Maximum number of queued executions. Only used if queueEnabled is true.
   * @default Infinity
   */
  maxQueueSize?: number;
}

export class RateLimitExceededError extends Error {
  constructor(
    public readonly retryAfter: number,
    public readonly queueSize?: number,
  ) {
    super('Rate limit exceeded');
    // For ES5 compatibility
    Object.setPrototypeOf(this, RateLimitExceededError.prototype);
  }
}

interface IQueueItem<T> {
  signal: AbortSignal;
  fn(context: IDefaultPolicyContext): Promise<T> | T;
  resolve(value: T): void;
  reject(error: Error): void;
}

/**
 * @example
 * ```ts
 * import { rateLimiter } from 'cockatiel';
 *
 * // Allow 10 requests per second
 * const limiter = rateLimiter({
 *   bucketSize: 10,
 *   interval: 1000
 * });
 *
 * await limiter.execute(() => fetch('/api/data'));
 * ```
 */
export class RateLimiterPolicy implements IPolicy {
  declare readonly _altReturn: never;

  private tokens: number;
  private lastRefill: number = Date.now();
  private readonly queue: Array<IQueueItem<unknown>> = [];
  private dequeueTimer: NodeJS.Timeout | undefined;

  private readonly executor = new ExecuteWrapper();
  private readonly onRejectEmitter = new EventEmitter<{ queueSize: number }>();

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  /**
   * Fires when a request is rejected due to rate limiting.
   */
  public readonly onReject = this.onRejectEmitter.addListener;

  constructor(private readonly options: IRateLimiterOptions) {
    this.tokens = options.initialTokens ?? options.bucketSize;
  }

  /**
   * Executes the function if tokens are available, otherwise rejects or queues.
   */
  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal = neverAbortedSignal,
  ): Promise<T> {
    if (signal.aborted) {
      throw new TaskCancelledError();
    }

    this.refillTokens();

    if (this.tokens >= 1) {
      this.tokens--;
      const result = await this.executor.invoke(fn, { signal });
      return returnOrThrow(result);
    }

    // If queueing is disabled, reject immediately
    if (!this.options.queueEnabled) {
      const retryAfter = this.getRetryAfter();
      const error = new RateLimitExceededError(retryAfter);
      this.onRejectEmitter.emit({ queueSize: 0 });
      throw error;
    }

    // Check queue size limit
    const maxQueueSize = this.options.maxQueueSize ?? Infinity;
    if (this.queue.length >= maxQueueSize) {
      const retryAfter = this.getRetryAfter();
      const error = new RateLimitExceededError(retryAfter, this.queue.length);
      this.onRejectEmitter.emit({ queueSize: this.queue.length });
      throw error;
    }

    // Queue the execution
    return new Promise<T>((resolve, reject) => {
      const queueItem: IQueueItem<T> = {
        signal,
        fn: fn as any,
        resolve,
        reject,
      };

      this.queue.push(queueItem);
      this.scheduleDequeue();

      // Handle abort signal
      if (signal !== neverAbortedSignal) {
        const abortHandler = () => {
          const index = this.queue.indexOf(queueItem);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(signal.reason ?? new TaskCancelledError());
          }
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = (timePassed / this.options.interval) * this.options.bucketSize;

    if (tokensToAdd >= 1) {
      this.tokens = Math.min(this.options.bucketSize, this.tokens + Math.floor(tokensToAdd));
      this.lastRefill = now;
    }
  }

  private scheduleDequeue(): void {
    if (this.queue.length === 0 || this.dequeueTimer) {
      return;
    }

    const retryAfter = this.getRetryAfter();
    this.dequeueTimer = setTimeout(() => {
      this.dequeueTimer = undefined;
      this.processQueue();
    }, retryAfter);
  }

  private async processQueue(): Promise<void> {
    this.refillTokens();

    while (this.queue.length > 0 && this.tokens >= 1) {
      const item = this.queue.shift();
      if (item) {
        this.tokens--;
        try {
          const result = await this.executor.invoke(item.fn, { signal: item.signal });
          const value = returnOrThrow(result);
          item.resolve(value);
        } catch (error) {
          item.reject(error as Error);
        }
      }
    }

    if (this.queue.length > 0) {
      this.scheduleDequeue();
    }
  }

  private getRetryAfter(): number {
    const tokensNeeded = 1 - this.tokens;
    const timeToWait = (tokensNeeded / this.options.bucketSize) * this.options.interval;
    return Math.ceil(Math.max(0, timeToWait));
  }

  /**
   * Returns the current state of the rate limiter.
   */
  public getState(): {
    availableTokens: number;
    queueSize: number;
    bucketSize: number;
  } {
    this.refillTokens();
    return {
      availableTokens: Math.floor(this.tokens),
      queueSize: this.queue.length,
      bucketSize: this.options.bucketSize,
    };
  }

  /**
   * Clears the queue and resets tokens to initial state.
   */
  public reset(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.reject(new Error('Rate limiter reset'));
      }
    }

    if (this.dequeueTimer) {
      clearTimeout(this.dequeueTimer);
      this.dequeueTimer = undefined;
    }

    this.tokens = this.options.initialTokens ?? this.options.bucketSize;
    this.lastRefill = Date.now();
  }
}

/**
 * Creates a rate limiter policy that limits the number of executions within a time window.
 *
 * @param options - Rate limiter configuration
 * @returns A rate limiter policy
 *
 * @example
 * ```ts
 * import { rateLimiter } from 'cockatiel';
 *
 * // Allow 100 requests per minute
 * const limiter = rateLimiter({
 *   bucketSize: 100,
 *   interval: 60000
 * });
 *
 * // With queueing enabled
 * const queuedLimiter = rateLimiter({
 *   bucketSize: 10,
 *   interval: 1000,
 *   queueEnabled: true,
 *   maxQueueSize: 50
 * });
 * ```
 */
export function rateLimiter(options: IRateLimiterOptions): RateLimiterPolicy {
  return new RateLimiterPolicy(options);
}

/**
 * Determines if the error is a rate limit exceeded error.
 */
export function isRateLimitError(error: unknown): error is RateLimitExceededError {
  return error instanceof RateLimitExceededError;
}
