import { expect, use } from 'chai';
import * as subset from 'chai-subset';
import { SinonFakeTimers, useFakeTimers } from 'sinon';
import { CircuitState } from '../CircuitBreakerPolicy';
import { SamplingBreaker } from './SamplingBreaker';

use(subset);

const getState = (b: SamplingBreaker) => {
  const untyped: any = b;
  return {
    threshold: untyped.threshold,
    minimumRpms: untyped.minimumRpms,
    duration: untyped.duration,
    windowSize: untyped.windowSize,
    windows: untyped.windows.map((w: object) => ({ ...w })),
    currentWindow: untyped.currentWindow,
    currentFailures: untyped.currentFailures,
    currentSuccesses: untyped.currentSuccesses,
  };
};

describe('SamplingBreaker', () => {
  describe('parameter creation', () => {
    it('rejects if threshold out of range', () => {
      expect(() => new SamplingBreaker({ threshold: -1, duration: 10 })).to.throw(RangeError);
      expect(() => new SamplingBreaker({ threshold: 0, duration: 10 })).to.throw(RangeError);
      expect(() => new SamplingBreaker({ threshold: 1, duration: 10 })).to.throw(RangeError);
      expect(() => new SamplingBreaker({ threshold: 10, duration: 10 })).to.throw(RangeError);
    });

    it('creates good initial params', () => {
      const b = new SamplingBreaker({ threshold: 0.2, duration: 10_000, minimumRps: 5 });
      expect(getState(b)).to.containSubset({
        threshold: 0.2,
        duration: 10_000,
        minimumRpms: 5 / 1000,
        windowSize: 1000,
      });

      expect(getState(b).windows).to.have.lengthOf(10);
    });

    it('creates initial params for small durations', () => {
      const b = new SamplingBreaker({ threshold: 0.2, duration: 103, minimumRps: 5 });
      expect(getState(b)).to.containSubset({
        threshold: 0.2,
        duration: 105,
        minimumRpms: 5 / 1000,
        windowSize: 21,
      });
      expect(getState(b).windows).to.have.lengthOf(5);
    });

    it('creates guess for rpms', () => {
      const b1 = new SamplingBreaker({ threshold: 0.2, duration: 103 });
      // needs at least 5 failures/sec, threshold of 0.2 means 5 * 5 total req/s
      expect(getState(b1).minimumRpms).to.equal(25 / 1000);

      const b2 = new SamplingBreaker({ threshold: 0.25, duration: 103 });
      // 5 * 4 here
      expect(getState(b2).minimumRpms).to.equal(20 / 1000);
    });
  });

  describe('windowing', () => {
    let b: SamplingBreaker;
    let clock: SinonFakeTimers;

    beforeEach(() => {
      b = new SamplingBreaker({ threshold: 0.5, duration: 5_000, minimumRps: 3 });
      clock = useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('increments and wraps buckets correctly', () => {
      for (let i = 0; i < 7; i++) {
        for (let k = 0; k < i; k++) {
          b.failure(CircuitState.Closed);
          b.success(CircuitState.Closed);
          b.success(CircuitState.Closed);
        }

        clock.tick(1000);
      }

      expect(getState(b)).to.containSubset({
        currentFailures: 20,
        currentSuccesses: 40,
        currentWindow: 1,
      });
      expect(getState(b).windows).to.deep.equal([
        { failures: 5, successes: 10, startedAt: 5000 },
        { failures: 6, successes: 12, startedAt: 6000 },
        { failures: 2, successes: 4, startedAt: 2000 },
        { failures: 3, successes: 6, startedAt: 3000 },
        { failures: 4, successes: 8, startedAt: 4000 },
      ]);
    });

    it('serializes and deserializes', () => {
      for (let i = 0; i < 7; i++) {
        for (let k = 0; k < i; k++) {
          b.failure(CircuitState.Closed);
          b.success(CircuitState.Closed);
          b.success(CircuitState.Closed);
        }

        clock.tick(1000);
        const b2 = new SamplingBreaker({ threshold: 0.5, duration: 5_000, minimumRps: 3 });
        b2.state = b.state;
        b = b2;
      }

      expect(getState(b)).to.containSubset({
        currentFailures: 20,
        currentSuccesses: 40,
        currentWindow: 1,
      });
      expect(getState(b).windows).to.deep.equal([
        { failures: 5, successes: 10, startedAt: 5000 },
        { failures: 6, successes: 12, startedAt: 6000 },
        { failures: 2, successes: 4, startedAt: 2000 },
        { failures: 3, successes: 6, startedAt: 3000 },
        { failures: 4, successes: 8, startedAt: 4000 },
      ]);
    });
  });




  describe('functionality', () => {
    let b: SamplingBreaker;
    let clock: SinonFakeTimers;

    const createTestBreaker = () =>
      (b = new SamplingBreaker({ threshold: 0.5, duration: 5_000, minimumRps: 3 }));

    beforeEach(() => {
      createTestBreaker();
      clock = useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('does not start failing if below threshold rps', () => {
      for (let i = 0; i < 10; i++) {
        expect(b.failure(CircuitState.Closed)).to.be.false;
        clock.tick(500); // advancing 0.5s each, never hits 3rps
      }
    });

    it('fails once above rps', () => {
      for (let i = 0; i < 3 * 5; i++) {
        clock.tick(334);
        expect(b.failure(CircuitState.Closed)).to.be.false;
      }

      b.failure(CircuitState.Closed);
      // need one extra due to bucket approximation:
      expect(b.failure(CircuitState.Closed)).to.be.true;
    });

    it('calculates rps correctly over time', () => {
      // keep us right on the edge of closing (50% failure rate) for amounts of
      // time, and verify that adding another failure
      // right after each opens the circuit
      for (let runLength = 10; runLength < 20; runLength++) {
        createTestBreaker();

        for (let i = 0; i < runLength; i++) {
          b.success(CircuitState.Closed);
          expect(b.failure(CircuitState.Closed)).to.be.false;
          clock.tick(250);
        }

        expect(b.failure(CircuitState.Closed)).to.be.true;
      }
    });

    it('resets when recoving from a half-open', () => {
      for (let i = 0; i < 10; i++) {
        b.failure(CircuitState.Closed);
      }

      b.success(CircuitState.HalfOpen);
      expect(getState(b).currentFailures).to.equal(0);
      expect(b.failure(CircuitState.Closed)).to.be.false;
    });
  });
});
