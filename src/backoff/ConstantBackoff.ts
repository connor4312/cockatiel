import { IBackoff } from './Backoff';

/**
 * Backoff that returns a constant interval.
 */
export class ConstantBackoff implements IBackoff<void> {
  private index = 0;

  constructor(private readonly interval: number, private readonly limit?: number) {}

  /**
   * @inheritdoc
   */
  public duration() {
    return this.interval;
  }

  /**
   * @inheritdoc
   */
  public next() {
    if (this.limit === undefined) {
      return this;
    }

    if (this.index >= this.limit - 1) {
      return undefined;
    }

    const b = new ConstantBackoff(this.interval, this.limit);
    b.index = this.index + 1;
    return b;
  }
}

/**
 * Backoff that never retries.
 */
export const NeverRetryBackoff = new ConstantBackoff(0, 0);
