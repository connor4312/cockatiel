import { IBackoff, IBackoffFactory } from './Backoff';

/**
 * Backoff that returns a number from an iterable.
 */
export class IterableBackoff implements IBackoffFactory<unknown> {
  constructor(private readonly durations: ReadonlyArray<number>) {}

  /**
   * @inheritdoc
   */
  public next() {
    return instance(this.durations, 0);
  }
}

const instance = (durations: ReadonlyArray<number>, index: number): IBackoff<unknown> => ({
  duration: durations[index],
  next() {
    return index === durations.length - 1 ? this : instance(durations, index + 1);
  },
});
