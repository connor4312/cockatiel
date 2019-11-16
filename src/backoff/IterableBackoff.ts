import { IBackoff } from './Backoff';

/**
 * Backoff that returns a number from an iterable.
 */
export class IterableBackoff implements IBackoff<void> {
  constructor(
    private readonly durations: ReadonlyArray<number>,
    private readonly index: number = 0,
  ) {
    if (index >= durations.length) {
      throw new RangeError(
        `IterableBackoff index ${0} >= number of durations (${durations.length})`,
      );
    }
  }

  /**
   * @inheritdoc
   */
  public duration() {
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
