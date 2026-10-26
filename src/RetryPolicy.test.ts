import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getEventListeners } from 'events';
import { SinonFakeTimers, SinonStub, spy, stub, useFakeTimers } from 'sinon';
import sinonChai from 'sinon-chai';
import {
  ConstantBackoff,
  DelegateBackoff,
  ExponentialBackoff,
  IterableBackoff,
  noJitterGenerator,
} from './backoff/Backoff.js';
import { runInChild } from './common/util.test.js';
import { handleAll, handleType, handleWhenResult, retry } from './Policy.js';

use(sinonChai);
use(chaiAsPromised);

class MyErrorA extends Error {
  constructor() {
    super('Error A');
  }
}
class MyErrorB extends Error {
  constructor() {
    super('Error B');
  }
}

describe('RetryPolicy', () => {
  it('types return data correctly in all cases', async () => {
    const policy = retry(handleAll, { maxAttempts: 1 });
    const multiply = (n: number) => n * 2;
    multiply(await policy.execute(() => 42));
    multiply(await policy.execute(async () => 42));
  });

  describe('setting backoffs', () => {
    let s: SinonStub;
    let clock: SinonFakeTimers;
    let delays: number[];
    beforeEach(() => {
      clock = useFakeTimers();
      delays = [];
      s = stub().throws(new MyErrorA());
    });

    afterEach(() => clock.restore());

    const makePolicy = (durations: number[]) => {
      const p = retry(handleAll, {
        maxAttempts: durations.length,
        backoff: new IterableBackoff(durations),
      });
      p.onRetry(({ delay }: any) => {
        delays.push(delay);
        clock.tick(delay);
      });
      return p;
    };

    it('sets the retry delay', async () => {
      await expect(makePolicy([50]).execute(s)).to.eventually.be.rejectedWith(MyErrorA);
      expect(delays).to.deep.equal([50]);
      expect(s).to.have.been.calledTwice;
    });

    it('sets the retry sequence', async () => {
      await expect(makePolicy([10, 20, 20]).execute(s)).to.eventually.be.rejectedWith(MyErrorA);
      expect(delays).to.deep.equal([10, 20, 20]);
      expect(s).to.have.callCount(4);
    });
  });

  it('retries all errors', async () => {
    const s = stub().onFirstCall().throws(new MyErrorA()).onSecondCall().returns('ok');

    expect(await retry(handleAll, {}).execute(s)).to.equal('ok');

    expect(s).to.have.been.calledTwice;
  });

  it('filters error types', async () => {
    const s = stub().onFirstCall().throws(new MyErrorA()).onSecondCall().throws(new MyErrorB());

    await expect(
      retry(handleType(MyErrorA), { maxAttempts: 5 }).execute(s),
    ).to.eventually.be.rejectedWith(MyErrorB);

    expect(s).to.have.been.calledTwice;
  });

  it('filters returns', async () => {
    const s = stub().onFirstCall().returns(1).onSecondCall().returns(2);

    expect(
      await retry(
        handleWhenResult(r => typeof r === 'number' && r < 2),
        { maxAttempts: 5 },
      ).execute(s),
    ).to.equal(2);

    expect(s).to.have.been.calledTwice;
  });

  it('permits specifying exponential backoffs', async () => {
    const s = stub().returns(1);

    expect(
      await retry(
        handleWhenResult((r: any) => typeof r === 'number'),
        { backoff: new ExponentialBackoff({ generator: noJitterGenerator }), maxAttempts: 2 },
      ).execute(s),
    ).to.equal(1);

    expect(s).to.have.callCount(3);
  });

  it('bubbles returns when retry attempts exceeded', async () => {
    const s = stub().returns(1);

    expect(
      await retry(
        handleWhenResult(r => typeof r === 'number' && r < 2),
        { maxAttempts: 5 },
      ).execute(s),
    ).to.equal(1);

    expect(s).to.have.callCount(6);
  });

  it('bubbles errors when retry attempts exceeded', async () => {
    const s = stub().throws(new MyErrorB());

    await expect(retry(handleAll, { maxAttempts: 5 }).execute(s)).to.eventually.be.rejectedWith(
      MyErrorB,
    );

    expect(s).to.have.callCount(6);
  });

  it('does not unref by default', async () => {
    const output = await runInChild(`
      c.retry(c.handleAll, { maxAttempts: 1 }).execute(() => {
        console.log('attempt');
        throw new Error('oh no!');
      });
    `);

    expect(output).to.contain('oh no!');
  });

  it('unrefs as requested', async () => {
    const output = await runInChild(`
    c.retry(c.handleAll, { maxAttempts: 1 }).dangerouslyUnref().execute(() => {
      console.log('attempt');
      throw new Error('oh no!');
    });
    `);

    expect(output).to.equal('attempt');
  });

  it('stops retries if cancellation is requested', async () => {
    const parent = new AbortController();
    const err = new Error();
    let calls = 0;
    await expect(
      retry(handleAll, { maxAttempts: 3 }).execute(({ signal }: any) => {
        calls++;
        expect(signal.aborted).to.be.false;
        parent.abort();
        expect(signal.aborted).to.be.true;
        throw err;
      }, parent.signal),
    ).to.eventually.be.rejectedWith(err);
    expect(calls).to.equal(1);
  });

  describe('cancellation during the backoff', () => {
    let clock: SinonFakeTimers;
    let s: SinonStub;
    let ctrl: AbortController;
    let errA: MyErrorA;
    let errB: MyErrorB;

    beforeEach(() => {
      clock = useFakeTimers();
      ctrl = new AbortController();
      errA = new MyErrorA();
      errB = new MyErrorB();
      s = stub();
      s.onFirstCall().throws(errA);
      s.onSecondCall().throws(errB);
    });

    afterEach(() => clock.restore());

    const makePolicy = () =>
      retry(handleAll, { maxAttempts: 3, backoff: new ConstantBackoff(500) });

    it('gives up as soon as the signal is aborted', async () => {
      const policy = makePolicy();
      const onGiveUp = stub();
      policy.onGiveUp(onGiveUp);

      const result = expect(policy.execute(s, ctrl.signal)).to.eventually.be.rejectedWith(errA);
      await clock.tickAsync(100);
      expect(clock.countTimers()).to.equal(1);

      ctrl.abort();
      await result;
      expect(clock.countTimers()).to.equal(0);
      expect(onGiveUp).to.have.been.calledOnceWith({ error: errA });

      // the function is never called again, even after the delay would have passed
      await clock.tickAsync(10_000);
      expect(s).to.have.been.calledOnce;
    });

    it('does not retry when the signal is already aborted', async () => {
      ctrl.abort();
      await expect(makePolicy().execute(s, ctrl.signal)).to.eventually.be.rejectedWith(errA);
      expect(clock.countTimers()).to.equal(0);
      await clock.tickAsync(10_000);
      expect(s).to.have.been.calledOnce;
    });

    for (const unref of [false, true]) {
      it(`does not create a timer or listener if the backoff aborts (unref=${unref})`, async () => {
        const policy = retry(handleAll, {
          maxAttempts: 3,
          backoff: new DelegateBackoff(() => {
            ctrl.abort();
            return 500;
          }),
        });
        const activePolicy = unref ? policy.dangerouslyUnref() : policy;
        const onGiveUp = stub();
        activePolicy.onGiveUp(onGiveUp);

        const setTimer = spy(globalThis, 'setTimeout');
        const addListener = spy(ctrl.signal, 'addEventListener');
        try {
          await expect(activePolicy.execute(s, ctrl.signal)).to.eventually.be.rejectedWith(errA);
          expect(setTimer).not.called;
          expect(addListener).not.called;
          expect(clock.countTimers()).to.equal(0);
          expect(s).calledOnce;
          expect(onGiveUp).calledOnceWith({ error: errA });
        } finally {
          setTimer.restore();
          addListener.restore();
        }
      });
    }

    it('returns the last handled result when the backoff is aborted', async () => {
      const policy = retry(
        handleWhenResult(value => value === 0),
        {
          maxAttempts: 3,
          backoff: new ConstantBackoff(500),
        },
      );
      const fn = stub().returns(0);
      const onGiveUp = stub();
      policy.onGiveUp(onGiveUp);

      const result = policy.execute(fn, ctrl.signal);
      await clock.tickAsync(100);
      ctrl.abort();

      expect(await result).to.equal(0);
      expect(fn).calledOnce;
      expect(onGiveUp).calledOnceWith({ value: 0 });
      expect(clock.countTimers()).to.equal(0);
      expect(getEventListeners(ctrl.signal, 'abort')).to.be.empty;
    });

    it('gives up if the signal is aborted from onRetry', async () => {
      const policy = makePolicy();
      policy.onRetry(() => ctrl.abort());

      const result = expect(policy.execute(s, ctrl.signal)).to.eventually.be.rejectedWith(errA);
      await clock.tickAsync(10_000);
      await result;
      expect(clock.countTimers()).to.equal(0);
      expect(s).to.have.been.calledOnce;
    });

    it('gives up if the signal is aborted just before the delay elapses', async () => {
      const result = expect(makePolicy().execute(s, ctrl.signal)).to.eventually.be.rejectedWith(
        errA,
      );
      await clock.tickAsync(499);
      ctrl.abort();
      await clock.tickAsync(1);
      await result;
      expect(s).to.have.been.calledOnce;
    });

    it('gives up if the signal is aborted at the same instant the delay elapses', async () => {
      // registered before the policy's own timer, so it fires first
      clock.setTimeout(() => ctrl.abort(), 500);
      const result = expect(makePolicy().execute(s, ctrl.signal)).to.eventually.be.rejectedWith(
        errA,
      );
      await clock.tickAsync(500);
      await result;
      await clock.tickAsync(10_000);
      expect(s).to.have.been.calledOnce;
    });

    it('does not undo an attempt that already started when the delay elapsed', async () => {
      const result = expect(makePolicy().execute(s, ctrl.signal)).to.eventually.be.rejectedWith(
        errB,
      );
      await clock.tickAsync(500);
      expect(s).to.have.been.calledTwice;

      ctrl.abort();
      await result;
      expect(clock.countTimers()).to.equal(0);
      await clock.tickAsync(10_000);
      expect(s).to.have.been.calledTwice;
    });

    it('does not leak abort listeners on a long-lived signal', async () => {
      const policy = makePolicy();
      const listeners = () => getEventListeners(ctrl.signal, 'abort').length;
      expect(listeners()).to.equal(0);

      // completes normally after retrying
      const done = policy.execute(
        stub().onFirstCall().throws(errA).onSecondCall().returns(42),
        ctrl.signal,
      );
      await clock.tickAsync(100);
      expect(listeners()).to.equal(1);
      await clock.tickAsync(400);
      expect(await done).to.equal(42);
      expect(listeners()).to.equal(0);

      // exhausts its attempts
      const exhausted = expect(
        policy.execute(stub().throws(errA), ctrl.signal),
      ).to.eventually.be.rejectedWith(errA);
      await clock.tickAsync(10_000);
      await exhausted;
      expect(listeners()).to.equal(0);

      // is aborted while waiting
      const aborted = expect(policy.execute(stub().throws(errA), ctrl.signal)).to.eventually.be
        .rejected;
      await clock.tickAsync(100);
      expect(listeners()).to.equal(1);
      ctrl.abort();
      await aborted;
      expect(listeners()).to.equal(0);
    });
  });

  it('fires onGiveUp', async () => {
    const err = new MyErrorA();
    const s = stub().throws(err);
    const policy = retry(handleType(MyErrorA), { maxAttempts: 5 });
    const onGiveUp = stub();
    policy.onGiveUp(onGiveUp);

    await expect(policy.execute(s)).to.eventually.be.rejectedWith(MyErrorA);
    expect(onGiveUp).to.have.been.calledWith({ error: err });
  });

  it('provides the attempt to the onRetry callback', async () => {
    const s = stub().throws(new MyErrorA());
    const attempts: number[] = [];
    const policy = retry(handleAll, { maxAttempts: 3 });
    policy.onRetry(({ attempt }: any) => {
      attempts.push(attempt);
    });

    await expect(policy.execute(s)).to.eventually.be.rejectedWith(MyErrorA);
    expect(attempts).to.deep.equal([1, 2, 3]);
  });
});
