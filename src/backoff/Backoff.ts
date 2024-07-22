/**
 * A generic type that returns backoff intervals.
 */
export interface IBackoffFactory<T> {
  /**
   * Returns the first backoff duration.
   */
  next(context: T): IBackoff<T>;
}

/**
 * A generic type that returns backoff intervals.
 */
export interface IBackoff<T> extends IBackoffFactory<T> {
  /**
   * Returns the number of milliseconds to wait for this backoff attempt.
   */
  readonly duration: number;
}

export * from './ConstantBackoff';
export * from './DelegateBackoff';
export * from './ExponentialBackoff';
export * from './ExponentialBackoffGenerators';
export * from './IterableBackoff';
