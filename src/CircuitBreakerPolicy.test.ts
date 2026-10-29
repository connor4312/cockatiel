import { expect } from 'chai';
import { SinonFakeTimers, SinonStub, spy, stub, useFakeTimers } from 'sinon';
import { promisify } from 'util';
import { IBackoffFactory } from './backoff/Backoff.js';
import { IterableBackoff } from './backoff/IterableBackoff.js';
import { ConsecutiveBreaker } from './breaker/Breaker.js';
import {
  CircuitBreakerPolicy,
  CircuitState,
  IHalfOpenAfterBackoffContext,
} from './CircuitBreakerPolicy.js';
import { abortedSignal } from './common/abort.js';
import { defer } from './common/defer.js';
import { BrokenCircuitError, TaskCancelledError } from './errors/Errors.js';
import { IsolatedCircuitError } from './errors/IsolatedCircuitError.js';
import { circuitBreaker, handleAll, handleType } from './Policy.js';

class MyException extends Error {}

const delay = promisify(setTimeout);

describe('CircuitBreakerPolicy', () => {
  let p: CircuitBreakerPolicy;
  let clock: SinonFakeTimers;
  let onBreak: SinonStub;
  let onReset: SinonStub;
  let onHalfOpen: SinonStub;

  beforeEach(() => {
    p = circuitBreaker(handleType(MyException), {
      halfOpenAfter: 1000,
      breaker: new ConsecutiveBreaker(2),
    });
    clock = useFakeTimers();
    onBreak = stub();
    onReset = stub();
    onHalfOpen = stub();
    p.onBreak(onBreak);
    p.onReset(onReset);
    p.onHalfOpen(onHalfOpen);
  });

  afterEach(() => {
    clock.restore();
  });

  const openBreaker = async () => {
    const s = stub().throws(new MyException());
    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    await expect(p.execute(s)).to.be.rejectedWith(MyException);
  };

  it('allows calls when open', async () => {
    expect(await p.execute(() => 42)).to.equal(42);
  });

  it('opens after failing calls', async () => {
    const s = stub().throws(new MyException());

    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onBreak).not.called;

    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Open);
    expect(onBreak).called;

    await expect(p.execute(s)).to.be.rejectedWith(BrokenCircuitError);
    expect(p.state).to.equal(CircuitState.Open);

    expect((p.lastFailure as any).error).to.be.an.instanceOf(MyException);
    expect(onBreak).calledOnce;
    expect(s).calledTwice;
  });

  it('closes if the half open test succeeds', async () => {
    await openBreaker();

    clock.tick(1000);

    const result = p.execute(stub().resolves(42));
    expect(p.state).to.equal(CircuitState.HalfOpen);
    expect(onHalfOpen).calledOnce;
    expect(await result).to.equal(42);
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;
  });

  describe('stale closed calls', () => {
    for (const calls of [1, 2]) {
      it(`does not supersede ${calls} half-open trial(s) when a closed call fails`, async () => {
        p = circuitBreaker(handleType(MyException), {
          halfOpenAfter: new IterableBackoff([1000, 2000]),
          breaker: new ConsecutiveBreaker(1),
          halfOpenSampling: { calls, threshold: 0 },
        });
        p.onBreak(onBreak);
        p.onReset(onReset);
        p.onHalfOpen(onHalfOpen);

        const slowCall = defer<number>();
        const slowResult = p.execute(() => slowCall.promise);
        const openingError = new MyException('opening failure');
        await expect(p.execute(() => Promise.reject(openingError))).to.be.rejectedWith(
          openingError,
        );
        clock.tick(1000);

        const trial = defer<number>();
        const trials = Array.from({ length: calls }, () => p.execute(() => trial.promise));
        const queued = stub().resolves(43);
        const queuedResult = p.execute(queued).then(
          value => ({ value }),
          error => ({ error }),
        );
        const halfOpenState = p.toJSON();
        const slowError = new MyException('stale failure');
        const slowRejection = expect(slowResult).to.be.rejectedWith(slowError);
        slowCall.reject(slowError);
        await slowRejection;

        expect(p.state).to.equal(CircuitState.HalfOpen);
        expect(p.toJSON()).to.deep.equal(halfOpenState);
        expect(p.lastFailure).to.deep.equal({ error: openingError });
        expect(onBreak).calledOnce;
        expect(queued).not.called;

        clock.tick(3000);
        const later = stub().resolves(44);
        const laterResult = p.execute(later);
        expect(later).not.called;
        expect(onHalfOpen).calledOnce;

        trial.resolve(42);
        expect(await Promise.all(trials)).to.deep.equal(Array(calls).fill(42));
        expect(await queuedResult).to.deep.equal({ value: 43 });
        expect(await laterResult).to.equal(44);
        expect(p.state).to.equal(CircuitState.Closed);
        expect(onReset).calledOnce;
      });
    }

    for (const phase of ['open', 'half-open', 'recovered', 'isolated', 'released isolation']) {
      for (const outcome of ['success', 'error', 'handled value']) {
        it(`ignores a stale ${outcome} while ${phase}`, async () => {
          const breaker = new ConsecutiveBreaker(2);
          p = circuitBreaker(
            handleType(MyException).orWhenResult(value => value === 0),
            { halfOpenAfter: 1000, breaker },
          );
          const onResult = stub();
          if (outcome === 'success') {
            p.onSuccess(onResult);
          } else {
            p.onFailure(onResult);
          }

          const slowCall = defer<number>();
          const slowResult = p.execute(() => slowCall.promise);
          await openBreaker();

          const trial = defer<number>();
          let trialResult: Promise<number> | undefined;
          if (phase === 'half-open' || phase === 'recovered') {
            clock.tick(1000);
            trialResult = p.execute(() => trial.promise);
            if (phase === 'recovered') {
              trial.resolve(42);
              await trialResult;
            }
          } else if (phase === 'isolated' || phase === 'released isolation') {
            const isolation = p.isolate();
            if (phase === 'released isolation') {
              isolation.dispose();
            }
          }

          const state = p.toJSON();
          const lastFailure = p.lastFailure;
          const success = spy(breaker, 'success');
          const failure = spy(breaker, 'failure');
          const onStateChange = stub();
          p.onStateChange(onStateChange);
          onResult.resetHistory();

          if (outcome === 'error') {
            const error = new MyException('stale failure');
            const rejection = expect(slowResult).to.be.rejectedWith(error);
            slowCall.reject(error);
            await rejection;
          } else {
            const value = outcome === 'success' ? 42 : 0;
            slowCall.resolve(value);
            expect(await slowResult).to.equal(value);
          }

          expect(success).not.called;
          expect(failure).not.called;
          expect(p.toJSON()).to.deep.equal(state);
          expect(p.lastFailure).to.equal(lastFailure);
          expect(onStateChange).not.called;
          expect(onResult).calledOnce;

          if (phase === 'half-open') {
            trial.resolve(42);
            await trialResult;
            expect(p.state).to.equal(CircuitState.Closed);
          }
        });
      }
    }
  });

  describe('stale half-open calls', () => {
    for (const phase of ['reopened', 'isolated', 'released isolation']) {
      it(`ignores a stale half-open failure once ${phase}`, async () => {
        p = circuitBreaker(handleType(MyException), {
          halfOpenAfter: 1000,
          breaker: new ConsecutiveBreaker(2),
          halfOpenSampling: { calls: 2, threshold: 0 },
        });

        await openBreaker();
        clock.tick(1000);

        const trial = defer<number>();
        const trialResult = p.execute(() => trial.promise);
        if (phase === 'reopened') {
          const reopeningError = new MyException('reopening failure');
          await expect(p.execute(() => Promise.reject(reopeningError))).to.be.rejectedWith(
            reopeningError,
          );
          expect(p.state).to.equal(CircuitState.Open);
          expect(p.lastFailure).to.deep.equal({ error: reopeningError });
        } else {
          const isolation = p.isolate();
          if (phase === 'released isolation') {
            isolation.dispose();
          }
        }

        const state = p.toJSON();
        const lastFailure = p.lastFailure;
        const error = new MyException('stale failure');
        const rejection = expect(trialResult).to.be.rejectedWith(error);
        trial.reject(error);
        await rejection;

        expect(p.toJSON()).to.deep.equal(state);
        expect(p.lastFailure).to.equal(lastFailure);
      });
    }

    it('still records a current half-open failure below the threshold', async () => {
      p = circuitBreaker(handleType(MyException), {
        halfOpenAfter: 1000,
        breaker: new ConsecutiveBreaker(2),
        halfOpenSampling: { calls: 2, threshold: 0.5 },
      });

      await openBreaker();
      clock.tick(1000);

      const error = new MyException('half-open failure');
      await expect(p.execute(() => Promise.reject(error))).to.be.rejectedWith(error);
      expect(p.state).to.equal(CircuitState.HalfOpen);
      expect(p.lastFailure).to.deep.equal({ error });
    });
  });

  it('uses the given backof factory to decide whether to enter the half open state', async () => {
    p = circuitBreaker(handleType(MyException), {
      halfOpenAfter: new IterableBackoff([1000, 2000]),
      breaker: new ConsecutiveBreaker(2),
    });
    p.onReset(onReset);
    p.onHalfOpen(onHalfOpen);

    await openBreaker();

    clock.tick(1000);

    const failedAttempt = p.execute(stub().throws(new MyException()));
    expect(p.state).to.equal(CircuitState.HalfOpen);
    expect(onHalfOpen).calledOnce;
    await expect(failedAttempt).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Open);

    clock.tick(1000);

    await expect(p.execute(stub().throws(new MyException()))).to.be.rejectedWith(
      BrokenCircuitError,
    );

    clock.tick(1000);

    const result = p.execute(stub().resolves(42));
    expect(p.state).to.equal(CircuitState.HalfOpen);
    expect(onHalfOpen).calledTwice;
    expect(await result).to.equal(42);
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;
  });

  it('resets the backoff when closing the circuit', async () => {
    let args: { duration: number; attempt: number }[] = [];
    p = circuitBreaker(handleType(MyException), {
      halfOpenAfter: new (class MyBreaker implements IBackoffFactory<IHalfOpenAfterBackoffContext> {
        constructor(public readonly duration: number) {}

        next(context: IHalfOpenAfterBackoffContext) {
          args.push({ duration: this.duration + 1, attempt: context.attempt });
          expect('error' in context.result).to.be.true;
          return new MyBreaker(this.duration + 1);
        }
      })(0),
      breaker: new ConsecutiveBreaker(2),
    });
    p.onReset(onReset);
    p.onHalfOpen(onHalfOpen);

    await openBreaker();

    expect(args).to.deep.equal([{ duration: 1, attempt: 1 }]);
    clock.tick(args.pop()!.duration);

    await expect(p.execute(stub().throws(new MyException()))).to.be.rejectedWith(MyException);
    expect(args).to.deep.equal([{ duration: 2, attempt: 2 }]);
    clock.tick(args.pop()!.duration);

    await p.execute(stub().resolves(42));
    expect(args).to.be.empty;

    await openBreaker();

    expect(args).to.deep.equal([{ duration: 1, attempt: 1 }]);
    clock.tick(args.pop()!.duration);

    await p.execute(stub().resolves(42));
    expect(args).to.be.empty;
  });

  it('dedupes half-open tests', async () => {
    await openBreaker();
    clock.tick(1000);

    // Two functinos, a and b. We execute with "a" first, and then make sure
    // it returns before "b" gets called.
    let aReturned = false;
    const a = async () => {
      await delay(10);
      aReturned = true;
      return 1;
    };

    const b = async () => {
      expect(aReturned).to.be.true;
      return 2;
    };

    const todo = [
      expect(p.execute(a)).to.eventually.equal(1),
      expect(p.execute(b)).to.eventually.equal(2),
    ];

    clock.tick(10);

    await Promise.all(todo);
  });

  it('samples multiple half-open calls before closing', async () => {
    p = circuitBreaker(handleType(MyException), {
      halfOpenAfter: 1000,
      breaker: new ConsecutiveBreaker(2),
      halfOpenSampling: { calls: 10, threshold: 0.3 },
    });
    p.onReset(onReset);
    p.onHalfOpen(onHalfOpen);

    await openBreaker();
    clock.tick(1000);

    for (let i = 0; i < 3; i++) {
      await expect(p.execute(stub().throws(new MyException()))).to.be.rejectedWith(MyException);
      expect(p.state).to.equal(CircuitState.HalfOpen);
    }

    for (let i = 0; i < 6; i++) {
      await expect(p.execute(stub().resolves(42))).to.eventually.equal(42);
      expect(p.state).to.equal(CircuitState.HalfOpen);
    }

    await expect(p.execute(stub().resolves(42))).to.eventually.equal(42);
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onHalfOpen).calledOnce;
    expect(onReset).calledOnce;
  });

  it('re-opens when the half-open sample exceeds the failure threshold', async () => {
    p = circuitBreaker(handleType(MyException), {
      halfOpenAfter: 1000,
      breaker: new ConsecutiveBreaker(2),
      halfOpenSampling: { calls: 10, threshold: 0.3 },
    });
    p.onHalfOpen(onHalfOpen);

    await openBreaker();
    clock.tick(1000);

    for (let i = 0; i < 3; i++) {
      await expect(p.execute(stub().throws(new MyException()))).to.be.rejectedWith(MyException);
      expect(p.state).to.equal(CircuitState.HalfOpen);
    }

    await expect(p.execute(stub().throws(new MyException()))).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Open);
    expect(onHalfOpen).calledOnce;
  });

  it('queues calls once the half-open sample is full', async () => {
    p = circuitBreaker(handleType(MyException), {
      halfOpenAfter: 1000,
      breaker: new ConsecutiveBreaker(2),
      halfOpenSampling: { calls: 2, threshold: 0 },
    });

    await openBreaker();
    clock.tick(1000);

    const a = async () => {
      await delay(10);
      return 1;
    };
    const b = async () => {
      await delay(10);
      return 2;
    };
    const c = stub().resolves(3);

    const todo = [
      expect(p.execute(a)).to.eventually.equal(1),
      expect(p.execute(b)).to.eventually.equal(2),
      expect(p.execute(c)).to.eventually.equal(3),
    ];

    clock.tick(10);

    await Promise.all(todo);
    expect(c).calledOnce;
    expect(p.state).to.equal(CircuitState.Closed);
  });

  it('validates half-open sampling options', () => {
    expect(() =>
      circuitBreaker(handleType(MyException), {
        halfOpenAfter: 1000,
        breaker: new ConsecutiveBreaker(2),
        halfOpenSampling: { calls: 0, threshold: 0.3 },
      }),
    ).to.throw(RangeError);
    expect(() =>
      circuitBreaker(handleType(MyException), {
        halfOpenAfter: 1000,
        breaker: new ConsecutiveBreaker(2),
        halfOpenSampling: { calls: 10, threshold: -0.1 },
      }),
    ).to.throw(RangeError);
    expect(() =>
      circuitBreaker(handleType(MyException), {
        halfOpenAfter: 1000,
        breaker: new ConsecutiveBreaker(2),
        halfOpenSampling: { calls: 10, threshold: 1 },
      }),
    ).to.throw(RangeError);
    expect(() =>
      circuitBreaker(handleType(MyException), {
        halfOpenAfter: 1000,
        breaker: new ConsecutiveBreaker(2),
        halfOpenSampling: { calls: 10, threshold: Number.NaN },
      }),
    ).to.throw(RangeError);
    expect(() =>
      circuitBreaker(handleType(MyException), {
        halfOpenAfter: 1000,
        breaker: new ConsecutiveBreaker(2),
        halfOpenSampling: { calls: 10 } as any,
      }),
    ).to.throw(RangeError);
  });

  it('stops deduped half-open tests if the circuit reopens', async () => {
    await openBreaker();
    clock.tick(1000);

    // Two functinos, a and b. We execute with "a" first, and then make sure
    // it returns before "b" gets called.
    const a = async () => {
      await delay(10);
      throw new MyException();
    };

    const b = async () => {
      throw new Error('expected to not be called');
    };

    const todo = [
      expect(p.execute(a)).to.be.rejectedWith(MyException),
      expect(p.execute(b)).to.be.rejectedWith(BrokenCircuitError),
    ];

    clock.tick(10);

    await Promise.all(todo);
  });

  it('re-opens if the half open fails', async () => {
    await openBreaker();

    clock.tick(1000);

    const s = stub().throws(new MyException());
    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Open);
  });

  it('handles isolation correctly', async () => {
    const handle1 = p.isolate();
    expect(onBreak).calledOnceWith({ isolated: true });

    const handle2 = p.isolate();
    expect(onBreak).calledOnce;

    expect(p.state).to.equal(CircuitState.Isolated);
    await expect(p.execute(() => 42)).to.be.rejectedWith(IsolatedCircuitError);

    handle1.dispose();
    expect(p.state).to.equal(CircuitState.Isolated);
    expect(onReset).not.called;

    handle2.dispose();
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;

    expect(await p.execute(() => 42)).to.equal(42);
  });

  it('links parent cancellation token', async () => {
    const parent = new AbortController();
    await circuitBreaker(handleAll, {
      halfOpenAfter: 1000,
      breaker: new ConsecutiveBreaker(3),
    }).execute(({ signal }: { signal?: any }) => {
      expect(signal.aborted).to.be.false;
      parent.abort();
      expect(signal.aborted).to.be.true;
    }, parent.signal);
  });

  it('aborts function execution if half open test succeeds', async () => {
    await openBreaker();

    clock.tick(1000);

    // half open test:
    p.execute(stub().resolves(42));

    // queued timeout:
    await expect(p.execute(stub(), abortedSignal)).to.be.rejectedWith(TaskCancelledError);

    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;
  });

  it('respects signal cancellation when execute() is called during HalfOpen state', async () => {
    await openBreaker();

    clock.tick(1000);

    // half open test:
    p.execute(stub().resolves(42));

    // Queue an execution with a custom signal while circuit is HalfOpen
    const controller = new AbortController();
    let signalWasAborted = false;

    const promise = p.execute(({ signal }) => {
      // Abort the signal and check if it's detected
      controller.abort();
      signalWasAborted = signal.aborted;
      return 'result';
    }, controller.signal);

    await promise;

    // The signal should have been detected as aborted
    expect(signalWasAborted).to.be.true;
  });

  describe('state restoration', () => {
    let args: { duration: number; attempt: number }[] = [];
    class MyBreaker implements IBackoffFactory<IHalfOpenAfterBackoffContext> {
      constructor(public readonly duration: number) {}

      next(context: IHalfOpenAfterBackoffContext) {
        args.push({ duration: this.duration + 1, attempt: context.attempt });
        expect('error' in context.result).to.be.true;
        return new MyBreaker(this.duration + 1);
      }
    }

    beforeEach(() => {
      args = [];
    });

    it('restores closed state', async () => {
      p = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
      });

      const p2 = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
        initialState: p.toJSON(),
      });

      expect(p2.state).to.equal(CircuitState.Closed);
      await p2.execute(stub().resolves(42));
    });

    it('restores breaker state', async () => {
      p = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
      });

      const s = stub().throws(new MyException());
      await expect(p.execute(s)).to.be.rejectedWith(MyException);

      const p2 = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
        initialState: p.toJSON(),
      });

      expect(p2.state).to.equal(CircuitState.Closed);
      await expect(p2.execute(s)).to.be.rejectedWith(MyException);
      expect(p2.state).to.equal(CircuitState.Open);
    });

    it('restores open state', async () => {
      p = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
      });

      await openBreaker();
      clock.tick(args.pop()!.duration);
      await expect(p.execute(stub().throws(new MyException()))).to.be.rejectedWith(MyException);
      args.length = 0;

      const p2 = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
        initialState: p.toJSON(),
      });

      expect(p2.state).to.equal(CircuitState.Open);
      expect(args).to.deep.equal([
        { duration: 1, attempt: 1 },
        { duration: 2, attempt: 2 },
      ]);
      await expect(p.execute(stub().resolves(42))).to.be.rejectedWith(BrokenCircuitError);

      clock.tick(args.pop()!.duration);
      await p2.execute(stub().resolves(42));
      expect(p2.state).to.equal(CircuitState.Closed);
    });

    it('restores half-open state with immediate retry', async () => {
      // set time ahead because openedAt gets serialized to 0
      clock.tick(1000);

      p = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
      });

      await openBreaker();
      clock.tick(args.pop()!.duration);
      args.length = 0;

      p.execute(async () => {
        await delay(1);
        throw new MyException();
      }).catch(() => {});
      expect(p.state).to.equal(CircuitState.HalfOpen);

      const p2 = circuitBreaker(handleType(MyException), {
        halfOpenAfter: new MyBreaker(0),
        breaker: new ConsecutiveBreaker(2),
        initialState: p.toJSON(),
      });

      expect(p2.state).to.equal(CircuitState.Open);
      expect(args).to.deep.equal([
        { duration: 1, attempt: 1 },
        { duration: 2, attempt: 2 },
      ]);

      await p2.execute(stub().resolves(42));
    });
  });
});
