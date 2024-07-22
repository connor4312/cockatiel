import { expect } from 'chai';
import { ConsecutiveBreaker } from './ConsecutiveBreaker';

describe('ConsecutiveBreaker', () => {
  it('works', () => {
    const c = new ConsecutiveBreaker(3);
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.true;
    expect(c.failure()).to.be.true;

    c.success();
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.true;
  });

  it('serializes and deserializes', () => {
    const c = new ConsecutiveBreaker(3);
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.true;

    const c2 = new ConsecutiveBreaker(3);
    c2.state = c.state;
    expect(c.failure()).to.be.true;

    c.success();
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.false;
    expect(c.failure()).to.be.true;
  });
});
