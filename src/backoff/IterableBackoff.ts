import { IBackoff } from './Backoff';

/**
 * Backoff that returns a number from an iterable.
 */
export class IterableBackoff implements IBackoff<void> {
  constructor(
    private readonly durations: ReadonlyArray<number>,
    private readonly index: number = -1,
  ) {}

  /**
   * @inheritdoc
   */
  public duration() {
    if (this.index === -1) {
      throw new Error(`duration is avaiable until the first next call`);
    }
    return this.durations[this.index];
  }

  /**
   * @inheritdoc
   */
  public next() {
    return this.index < this.durations.length - 1
      ? new IterableBackoff(this.durations, this.index + 1)
      : undefined;
  }
}
