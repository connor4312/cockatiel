import { expect } from 'chai';
import { expectDurations } from './Backoff.test';
import { CompositeBackoff, CompositeBias } from './CompositeBackoff';
import { ConstantBackoff } from './ConstantBackoff';

describe('CompositeBackoff', () => {
  const withBias = (bias: CompositeBias) =>
    new CompositeBackoff(bias, new ConstantBackoff(10, 4), new ConstantBackoff(20, 2));

  it('biases correctly', () => {
    expect(withBias('a').duration()).to.equal(10);
    expect(withBias('b').duration()).to.equal(20);
    expect(withBias('min').duration()).to.equal(10);
    expect(withBias('max').duration()).to.equal(20);
  });

  it('limits the number of retries', () => {
    expectDurations(withBias('max'), [20, 20, undefined]);
  });
});
