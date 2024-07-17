import { expect, use } from 'chai';
import * as subset from 'chai-subset';
import { CircuitState } from '../CircuitBreakerPolicy';
import { CountBreaker } from './CountBreaker';

use(subset);

const getState = (b: CountBreaker) => {
  const untyped: any = b;
  return {
    threshold: untyped.threshold,
    minimumNumberOfCalls: untyped.minimumNumberOfCalls,
    samples: [...untyped.samples],
    successes: untyped.successes,
    failures: untyped.failures,
    currentSample: untyped.currentSample,
  };
};

describe('CountBreaker', () => {
  describe('parameter creation', () => {
    it('rejects if threshold is out of range', () => {
      expect(() => new CountBreaker({ threshold: -1, size: 100 })).to.throw(RangeError);
      expect(() => new CountBreaker({ threshold: 0, size: 100 })).to.throw(RangeError);
      expect(() => new CountBreaker({ threshold: 1, size: 100 })).to.throw(RangeError);
      expect(() => new CountBreaker({ threshold: 10, size: 100 })).to.throw(RangeError);
    });

    it('rejects if size is invalid', () => {
      expect(() => new CountBreaker({ threshold: 0.5, size: -1 })).to.throw(RangeError);
      expect(() => new CountBreaker({ threshold: 0.5, size: 0 })).to.throw(RangeError);
      expect(() => new CountBreaker({ threshold: 0.5, size: 0.5 })).to.throw(RangeError);
    });

    it('rejects if minimumNumberOfCalls is invalid', () => {
      expect(
        () => new CountBreaker({ threshold: 0.5, size: 100, minimumNumberOfCalls: -1 }),
      ).to.throw(RangeError);
      expect(
        () => new CountBreaker({ threshold: 0.5, size: 100, minimumNumberOfCalls: 0 }),
      ).to.throw(RangeError);
      expect(
        () => new CountBreaker({ threshold: 0.5, size: 100, minimumNumberOfCalls: 0.5 }),
      ).to.throw(RangeError);
      expect(
        () => new CountBreaker({ threshold: 0.5, size: 100, minimumNumberOfCalls: 101 }),
      ).to.throw(RangeError);
    });

    it('creates good initial params', () => {
      const b = new CountBreaker({ threshold: 0.5, size: 100, minimumNumberOfCalls: 50 });
      expect(getState(b)).to.containSubset({
        threshold: 0.5,
        minimumNumberOfCalls: 50,
      });

      expect(getState(b).samples).to.have.lengthOf(100);
    });
  });

  describe('window', () => {
    it('correctly wraps around when reaching the end of the window', () => {
      const b = new CountBreaker({ threshold: 0.5, size: 5 });
      for (let i = 0; i < 9; i++) {
        if (i % 3 === 0) {
          b.failure(CircuitState.Closed);
        } else {
          b.success(CircuitState.Closed);
        }
      }

      const state = getState(b);
      expect(state.currentSample).to.equal(4);
      expect(state.samples).to.deep.equal([true, false, true, true, true]);
    });
  });

  describe('functionality', () => {
    let b: CountBreaker;

    beforeEach(() => {
      b = new CountBreaker({ threshold: 0.5, size: 100, minimumNumberOfCalls: 50 });
    });

    it('does not open as long as the minimum number of calls has not been reached', () => {
      for (let i = 0; i < 49; i++) {
        expect(b.failure(CircuitState.Closed)).to.be.false;
      }
    });

    it('does not open when the minimum number of calls has been reached but the threshold has not been surpassed', () => {
      for (let i = 0; i < 25; i++) {
        b.success(CircuitState.Closed);
      }
      for (let i = 0; i < 24; i++) {
        expect(b.failure(CircuitState.Closed)).to.be.false;
      }
      expect(b.failure(CircuitState.Closed)).to.be.false;
    });

    it('opens when the minimum number of calls has been reached and threshold has been surpassed', () => {
      for (let i = 0; i < 24; i++) {
        b.success(CircuitState.Closed);
      }
      for (let i = 0; i < 25; i++) {
        expect(b.failure(CircuitState.Closed)).to.be.false;
      }
      expect(b.failure(CircuitState.Closed)).to.be.true;
    });

    it('resets when recoving from a half-open', () => {
      for (let i = 0; i < 100; i++) {
        b.failure(CircuitState.Closed);
      }

      b.success(CircuitState.HalfOpen);

      const state = getState(b);
      expect(state.failures).to.equal(0);
      expect(state.successes).to.equal(1);
      expect(b.failure(CircuitState.Closed)).to.be.false;
    });
  });
});
