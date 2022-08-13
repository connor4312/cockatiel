import { IBackoff, IBackoffFactory } from './Backoff';

export class ConstantBackoff implements IBackoffFactory<unknown> {
  /**
   * Backoff that returns a constant interval.
   */
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
