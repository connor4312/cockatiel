import { IBackoff, IBackoffFactory } from './Backoff';

/**
 * Backoff that returns a constant interval.
 */
export class ConstantBackoff implements IBackoffFactory<unknown> {
  constructor(private readonly interval: number) {}

  /**
   * @inheritdoc
   */
  public next() {
    return instance(this.interval);
  }
}

const instance = (interval: number): IBackoff<unknown> => ({
  duration: interval,
  next() {
    return this;
  },
});
