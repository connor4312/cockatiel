import { expect } from 'chai';
import { IBackoff } from './Backoff';

export const expectDurations = <T>(
  backoff: IBackoff<T> | undefined,
  expected: ReadonlyArray<number | undefined>,
  context?: T,
) => {
  const actual: Array<number | undefined> = [];
  // tslint:disable-next-line: prefer-for-of
  for (let i = 0; i < expected.length; i++) {
    if (!backoff) {
      actual.push(undefined);
      continue;
    }

    actual.push(backoff.duration());
    backoff = backoff.next(context as T);
  }

  expect(actual).to.deep.equal(expected);
};
