import { expect, use } from 'chai';
import { SinonFakeTimers, useFakeTimers } from 'sinon';
import { CircuitState } from '../CircuitBreakerPolicy';
import { SamplingBreaker } from './SamplingBreaker';

use(require('chai-subset'));

describe('SamplingBreaker', () => {
  describe('parameter creation', () => {
    it('creates good initial params', () => {
      const b = new SamplingBreaker({ threshold: 0.2, duration: 10 * 1000, minimumRps: 5 });
      expect(b.state).to.containSubset({
        threshold: 0.2,
        duration: 10 * 1000,
        minimumRpms: 5 / 1000,
        windowSize: 1000,
      });

      expect(b.state.windows).to.have.lengthOf(10);
    });

    it('creates initial params for small durations', () => {
      const b = new SamplingBreaker({ threshold: 0.2, duration: 103, minimumRps: 5 });
      expect(b.state).to.containSubset({
        threshold: 0.2,
        duration: 105,
        minimumRpms: 5 / 1000,
        windowSize: 21,
      });
      expect(b.state.windows).to.have.lengthOf(5);
    });

    it('creates guess for rpms', () => {
      const b1 = new SamplingBreaker({ threshold: 0.2, duration: 103 });
      // needs at least 5 failures/sec, threshold of 0.2 means 5 * 5 total req/s
      expect(b1.state.minimumRpms).to.equal(25 / 1000);

      const b2 = new SamplingBreaker({ threshold: 0.25, duration: 103 });
      // 5 * 4 here
      expect(b2.state.minimumRpms).to.equal(20 / 1000);
    });
  });

  describe('windowing', () => {
    let b: SamplingBreaker;
    let clock: SinonFakeTimers;

    beforeEach(() => {
      b = new SamplingBreaker({ threshold: 0.5, duration: 5 * 1000, minimumRps: 3 });
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

      expect(b.state).to.containSubset({
        currentFailures: 20,
        currentSuccesses: 40,
        currentWindow: 1,
      });
      expect(b.state.windows).to.deep.equal([
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
      (b = new SamplingBreaker({ threshold: 0.5, duration: 5 * 1000, minimumRps: 3 }));

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
      expect(b.state.currentFailures).to.equal(0);
      expect(b.failure(CircuitState.Closed)).to.be.false;
    });
  });
});
