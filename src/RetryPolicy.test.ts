import { expect, use } from 'chai';
import { SinonFakeTimers, SinonStub, stub, useFakeTimers } from 'sinon';
import { ExponentialBackoff, IterableBackoff, noJitterGenerator } from './backoff/Backoff';
import { runInChild } from './common/util.test';
import { handleAll, handleType, handleWhenResult, retry } from './Policy';

use(require('sinon-chai'));
use(require('chai-as-promised'));

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
      p.onRetry(({ delay }) => {
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
        handleWhenResult(r => typeof r === 'number'),
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
      retry(handleAll, { maxAttempts: 3 }).execute(({ signal }) => {
        calls++;
        expect(signal.aborted).to.be.false;
        parent.abort();
        expect(signal.aborted).to.be.true;
        throw err;
      }, parent.signal),
    ).to.eventually.be.rejectedWith(err);
    expect(calls).to.equal(1);
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
    policy.onRetry(({ attempt }) => {
      attempts.push(attempt);
    });

    await expect(policy.execute(s)).to.eventually.be.rejectedWith(MyErrorA);
    expect(attempts).to.deep.equal([1, 2, 3]);
  });
});
