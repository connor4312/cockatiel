import { IBackoff } from './Backoff';

export type DelegateBackoffFn<T, S = void> = (
  context: T,
  state?: S,
) => { delay: number; state: S } | number | undefined;

/**
 * Backoff that delegates to a user-provided function. The function takes
 * the backoff context, and can optionally take (and return) a state value
 * that will be passed into subsequent backoff requests.
 */
export class DelegateBackoff<T, S = void> implements IBackoff<T> {
  private current: number = 0;
  private attempts: number = -1;

  constructor(private readonly fn: DelegateBackoffFn<T, S>, private readonly state?: S) {}

  /**
   * @inheritdoc
   */
  public duration() {
    if (this.attempts === -1) {
      throw new Error(`duration is avaiable until the first next call`);
    }
    return this.current;
  }

  /**
   * @inheritdoc
   */
  public next(context: T) {
    const result = this.fn(context, this.state);
    if (result === undefined) {
      return undefined;
    }

    let b: DelegateBackoff<T, S>;
    if (typeof result === 'number') {
      b = new DelegateBackoff(this.fn, this.state);
      b.current = result;
    } else {
      b = new DelegateBackoff(this.fn, result.state);
      b.current = result.delay;
    }
    b.attempts = this.attempts + 1;

    return b;
  }
}
