import { expectDurations } from './Backoff.test';
import { ConstantBackoff } from './ConstantBackoff';

describe('ConstantBackoff', () => {
  it('returns its duration', () => {
    expectDurations(new ConstantBackoff(42), [42, 42, 42]);
  });

  it('limits the number of retries', () => {
    expectDurations(new ConstantBackoff(42, 2), [42, 42, undefined]);
  });
});
