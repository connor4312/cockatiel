import { IBackoff, IBackoffFactory } from './Backoff';

/**
 * Backoff that returns a constant interval.
 */
export class ConstantBackoff implements IBackoffFactory<unknown> {
  constructor(private readonly interval: number, private readonly limit?: number) {}

  /**
   * @inheritdoc
   */
  public next() {
    return instance(this.interval, this.limit);
  }
}

/**
 * Backoff that never retries.
 */
export const NeverRetryBackoff = new ConstantBackoff(0, 0);

const instance = (interval: number, limit: number | undefined, index = 0): IBackoff<unknown> => ({
  duration: interval,
  next() {
    if (limit === undefined) {
      return this;
    }

    if (index >= limit - 1) {
      return undefined;
    }

    return instance(interval, limit, index + 1);
  },
});
