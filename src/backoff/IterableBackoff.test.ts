import { expectDurations } from './Backoff.test';
import { IterableBackoff } from './IterableBackoff';

describe('IterableBackoff', () => {
  it('works', () => {
    const b = new IterableBackoff([3, 6, 9]);
    expectDurations(b, [3, 6, 9, 9]);
  });
});
