import { expect } from 'chai';
import { SinonFakeTimers, useFakeTimers } from 'sinon';
import { CircuitState } from '../CircuitBreakerPolicy.js';
import { circuitBreaker, handleAll } from '../Policy.js';
import { SamplingBreaker } from './SamplingBreaker.js';

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

  describe('idle periods', () => {
    // 5 windows of 1s, and at least 5 samples are needed to open
    const duration = 5_000;
    let b: SamplingBreaker;
    let clock: SinonFakeTimers;

    beforeEach(() => {
      b = new SamplingBreaker({ threshold: 0.5, duration, minimumRps: 1 });
      clock = useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    const expectConsistent = () => {
      const s = getState(b);
      expect(s.currentFailures).to.equal(
        s.windows.reduce((n: number, w: any) => n + w.failures, 0),
      );
      expect(s.currentSuccesses).to.equal(
        s.windows.reduce((n: number, w: any) => n + w.successes, 0),
      );
    };

    const failures = (n: number) => {
      for (let i = 0; i < n; i++) {
        b.failure(CircuitState.Closed);
      }
    };

    it('does not count stale samples after a long idle period', () => {
      failures(4);
      clock.tick(100_000);

      // a single call in the last 100s is below the minimum rps
      expect(b.failure(CircuitState.Closed)).to.be.false;
      expect(getState(b)).to.containSubset({ currentFailures: 1, currentSuccesses: 0 });
      expectConsistent();
    });

    it('does not count stale samples when idle for more than the duration', () => {
      failures(4);
      clock.tick(duration + 1);
      expect(b.failure(CircuitState.Closed)).to.be.false;
      expect(getState(b).currentFailures).to.equal(1);
      expectConsistent();
    });

    it('drops samples that are exactly the full duration old', () => {
      failures(4);
      clock.tick(duration);
      expect(b.failure(CircuitState.Closed)).to.be.false;
      expect(getState(b).currentFailures).to.equal(1);
      expectConsistent();
    });

    it('keeps samples that are just under the full duration old', () => {
      failures(4);
      clock.tick(duration - 1);
      expect(b.failure(CircuitState.Closed)).to.be.true;
      expect(getState(b).currentFailures).to.equal(5);
      expectConsistent();
    });

    it('keeps the previous window when exactly one window elapses', () => {
      failures(4);
      clock.tick(1000);
      expect(b.failure(CircuitState.Closed)).to.be.true;
      expect(getState(b)).to.containSubset({ currentFailures: 5, currentWindow: 1 });
      expectConsistent();
    });

    it('advances by the number of windows that elapsed', () => {
      failures(1);
      clock.tick(3000);
      failures(1);

      expect(getState(b)).to.containSubset({ currentFailures: 2, currentWindow: 3 });
      expect(getState(b).windows).to.deep.equal([
        { failures: 1, successes: 0, startedAt: 0 },
        { failures: 0, successes: 0, startedAt: 0 },
        { failures: 0, successes: 0, startedAt: 0 },
        { failures: 1, successes: 0, startedAt: 3000 },
        { failures: 0, successes: 0, startedAt: 0 },
      ]);

      // the ring order is preserved, so the first sample expires on time
      clock.tick(1000);
      failures(1);
      expect(getState(b)).to.containSubset({ currentFailures: 3, currentWindow: 4 });

      clock.tick(1000);
      failures(1);
      expect(getState(b)).to.containSubset({ currentFailures: 3, currentWindow: 0 });
      expectConsistent();
    });

    it('only expires the windows that are older than the duration', () => {
      // one sample per second in windows 0, 1, 2 (at t=0, 1s, 2s)
      for (let i = 0; i < 3; i++) {
        b.success(CircuitState.Closed);
        failures(1);
        clock.tick(1000);
      }

      expect(getState(b)).to.containSubset({ currentFailures: 3, currentSuccesses: 3 });

      // at t=6s, the samples from t=0 and t=1s are older than 5s
      clock.tick(3000);
      failures(1);
      expect(getState(b)).to.containSubset({ currentFailures: 2, currentSuccesses: 1 });
      expectConsistent();

      // at t=8s the samples from t=2s are older than 5s too
      clock.tick(2000);
      failures(1);
      expect(getState(b)).to.containSubset({ currentFailures: 2, currentSuccesses: 0 });
      expectConsistent();
    });

    it('starts afresh when a burst follows an idle period', () => {
      failures(4);
      clock.tick(60_000);

      failures(4);
      expect(getState(b)).to.containSubset({ currentFailures: 4 });
      expect(b.failure(CircuitState.Closed)).to.be.true;
      expect(getState(b)).to.containSubset({ currentFailures: 5 });
      expectConsistent();
    });

    it('does not open the circuit on one failure after a long idle period', async () => {
      const policy = circuitBreaker(handleAll, {
        halfOpenAfter: 1000,
        breaker: new SamplingBreaker({ threshold: 0.5, duration: 10_000, minimumRps: 1 }),
      });

      const fail = () => policy.execute(() => Promise.reject(new Error('oops'))).catch(() => {});

      for (let i = 0; i < 9; i++) {
        await fail();
      }
      expect(policy.state).to.equal(CircuitState.Closed);

      clock.tick(100_000);
      await fail();
      expect(policy.state).to.equal(CircuitState.Closed);
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
