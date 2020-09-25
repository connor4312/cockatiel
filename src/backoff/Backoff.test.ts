import { expect } from 'chai';
import { IBackoffFactory } from './Backoff';

export const expectDurations = <T>(
  backoffFactory: IBackoffFactory<T> | undefined,
  expected: ReadonlyArray<number | undefined>,
  context?: T,
) => {
  const actual: Array<number | undefined> = [];
  let backoff = backoffFactory?.next(context as T);
  // tslint:disable-next-line: prefer-for-of
  for (let i = 0; i < expected.length; i++) {
    if (!backoff) {
      actual.push(undefined);
      continue;
    }

    actual.push(backoff?.duration);
    backoff = backoff.next(context as T);
  }

  expect(actual).to.deep.equal(expected);
};
