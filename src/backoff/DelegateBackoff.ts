import { IBackoff, IBackoffFactory } from './Backoff';

export type DelegateBackoffFn<T, S = void> = (
  context: T,
  state?: S,
) => { delay: number; state: S } | number;

/**
 * Backoff that delegates to a user-provided function. The function takes
 * the backoff context, and can optionally take (and return) a state value
 * that will be passed into subsequent backoff requests.
 */
export class DelegateBackoff<T, S = void> implements IBackoffFactory<T> {
  constructor(private readonly fn: DelegateBackoffFn<T, S>) {}

  /**
   * @inheritdoc
   */
  public next(context: T) {
    return instance(this.fn).next(context);
  }
}

const instance = <T, S>(fn: DelegateBackoffFn<T, S>, state?: S, current = 0): IBackoff<T> => ({
  duration: current,
  next(context: T) {
    const result = fn(context, state);
    return typeof result === 'number'
      ? instance(fn, state, result)
      : instance(fn, result.state, result.delay);
  },
});
