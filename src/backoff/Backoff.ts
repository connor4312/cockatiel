/**
 * A generic type that returns backoff intervals.
 */
export interface IBackoff<T> {
  /**
   * Returns the number of milliseconds to wait for this backoff attempt.
   */
  duration(): number;

  /**
   * Returns the next backoff duration. Can return "undefined" to signal
   * that we should stop backing off.
   */
  next(context: T): IBackoff<T> | undefined;
}

export * from './CompositeBackoff';
export * from './ConstantBackoff';
export * from './DelegateBackoff';
export * from './ExponentialBackoff';
export * from './ExponentialBackoffGenerators';
export * from './IterableBackoff';
