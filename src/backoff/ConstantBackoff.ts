import { IBackoff } from './Backoff';

/**
 * Backoff that returns a constant interval.
 */
export class ConstantBackoff implements IBackoff<void> {
  private index = -1;

  constructor(private readonly interval: number, private readonly limit?: number) {}

  /**
   * @inheritdoc
   */
  public duration() {
    if (this.index === -1) {
      throw new Error(`duration is avaiable until the first next call`);
    }
    return this.interval;
  }

  /**
   * @inheritdoc
   */
  public next() {
    if (this.limit && this.index >= this.limit - 1) {
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
