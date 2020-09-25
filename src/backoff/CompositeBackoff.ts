import { IBackoff, IBackoffFactory } from './Backoff';

export type CompositeBias = 'a' | 'b' | 'max' | 'min';

/**
 * A backoff that combines two other backoffs. The delay will be the "bias"
 * (max or min) of the two other backoffs, and next() will return as along as
 * both backoffs continue to have next values as well.
 */
export class CompositeBackoff<T> implements IBackoffFactory<T> {
  constructor(
    private readonly bias: CompositeBias,
    private readonly backoffA: IBackoffFactory<T>,
    private readonly backoffB: IBackoffFactory<T>,
  ) {}

  /**
   * @inheritdoc
   */
  public next(context: T) {
    const nextA = this.backoffA.next(context);
    const nextB = this.backoffB.next(context);
    return nextA && nextB && instance(this.bias, nextA, nextB);
  }
}

const instance = <T>(
  bias: CompositeBias,
  backoffA: IBackoff<T>,
  backoffB: IBackoff<T>,
): IBackoff<T> => ({
  /**
   * @inheritdoc
   */
  get duration() {
    switch (bias) {
      case 'a':
        return backoffA.duration;
      case 'b':
        return backoffB.duration;
      case 'max':
        return Math.max(backoffB.duration, backoffA.duration);
      case 'min':
        return Math.min(backoffB.duration, backoffA.duration);
      default:
        throw new Error(`Unknown bias "${bias}" given to CompositeBackoff`);
    }
  },

  /**
   * @inheritdoc
   */
  next(context: T) {
    const nextA = backoffA.next(context);
    const nextB = backoffB.next(context);
    return nextA && nextB && instance(bias, nextA, nextB);
  },
});
