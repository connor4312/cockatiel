import { expectDurations } from './Backoff.test';
import { ConstantBackoff } from './ConstantBackoff';

describe('ConstantBackoff', () => {
  it('returns its duration', () => {
    expectDurations(new ConstantBackoff(42), [42, 42, 42]);
  });
});
