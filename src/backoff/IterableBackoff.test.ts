import { expect } from 'chai';
import { expectDurations } from './Backoff.test';
import { IterableBackoff } from './IterableBackoff';

describe('IterableBackoff', () => {
  it('works', () => {
    const b = new IterableBackoff([3, 6, 9]);
    expectDurations(b, [3, 6, 9, undefined]);
  });

  it('throws a range error if empty', () => {
    expect(() => new IterableBackoff([])).to.throw(RangeError);
  });
});
