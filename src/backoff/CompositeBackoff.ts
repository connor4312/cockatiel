import { IBackoff } from './Backoff';

export type CompositeBias = 'a' | 'b' | 'max' | 'min';

/**
 * A backoff that combines two other backoffs. The delay will be the "bias"
 * (max or min) of the two other backoffs, and next() will return as along as
 * both backoffs continue to have next values as well.
 */
export class CompositeBackoff<T> implements IBackoff<T> {
  constructor(
    private readonly bias: CompositeBias,
    private readonly backoffA: IBackoff<T>,
    private readonly backoffB: IBackoff<T>,
  ) {}

  /**
   * @inheritdoc
   */
  public duration() {
    switch (this.bias) {
      case 'a':
        return this.backoffA.duration();
      case 'b':
        return this.backoffB.duration();
      case 'max':
        return Math.max(this.backoffB.duration(), this.backoffA.duration());
      case 'min':
        return Math.min(this.backoffB.duration(), this.backoffA.duration());
      default:
        throw new Error(`Unknown bias "${this.bias}" given to CompositeBackoff`);
    }
  }

  /**
   * @inheritdoc
   */
  public next(context: T) {
    const nextA = this.backoffA.next(context);
    const nextB = this.backoffB.next(context);
    return nextA && nextB && new CompositeBackoff(this.bias, nextA, nextB);
  }
}
