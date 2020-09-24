import { expect, use } from 'chai';
import { SinonFakeTimers, SinonStub, stub, useFakeTimers } from 'sinon';
import { noJitterGenerator } from './backoff/Backoff';
import { CancellationTokenSource } from './CancellationToken';
import { runInChild } from './common/util.test';
import { Policy } from './Policy';
import { RetryPolicy } from './RetryPolicy';

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
    const policy = Policy.handleAll().retry();
    const multiply = (n: number) => n * 2;
    multiply(await policy.execute(() => 42));
    multiply(await policy.execute(async () => 42));

    // Uncomment the following, it should have type errors
    // const somePolicy = Policy.handleWhenResult<'foo' | 'bar'>(() => false).retry();
    // somePolicy.execute(() => 'baz'); // baz is not assignable to 'foo' | 'bar'
  });

  describe('setting backoffs', () => {
    let p: RetryPolicy;
    let s: SinonStub;
    let clock: SinonFakeTimers;
    let delays: number[];
    beforeEach(() => {
      clock = useFakeTimers();
      p = Policy.handleAll().retry();
      delays = [];
      p.onRetry(({ delay }) => {
        delays.push(delay);
        clock.tick(delay);
      });
      s = stub().throws(new MyErrorA());
    });

    afterEach(() => clock.restore());

    it('sets the retry delay', async () => {
      await expect(p.delay(50).attempts(1).execute(s)).to.eventually.be.rejectedWith(MyErrorA);
      expect(delays).to.deep.equal([50]);
      expect(s).to.have.been.calledTwice;
    });

    it('sets the retry sequence', async () => {
      await expect(p.delay([10, 20, 20]).execute(s)).to.eventually.be.rejectedWith(MyErrorA);
      expect(delays).to.deep.equal([10, 20, 20]);
      expect(s).to.have.callCount(4);
    });

    it('sets the retry attempts', async () => {
      await expect(p.delay([10, 20, 20]).attempts(1).execute(s)).to.eventually.be.rejectedWith(
        MyErrorA,
      );
      expect(delays).to.deep.equal([10]);
      expect(s).to.have.been.calledTwice;
    });
  });

  it('retries all errors', async () => {
    const s = stub().onFirstCall().throws(new MyErrorA()).onSecondCall().returns('ok');

    expect(await Policy.handleAll().retry().execute(s)).to.equal('ok');

    expect(s).to.have.been.calledTwice;
  });

  it('filters error types', async () => {
    const s = stub().onFirstCall().throws(new MyErrorA()).onSecondCall().throws(new MyErrorB());

    await expect(
      Policy.handleType(MyErrorA).retry().attempts(5).execute(s),
    ).to.eventually.be.rejectedWith(MyErrorB);

    expect(s).to.have.been.calledTwice;
  });

  it('filters returns', async () => {
    const s = stub().onFirstCall().returns(1).onSecondCall().returns(2);

    expect(
      await Policy.handleWhenResult(r => typeof r === 'number' && r < 2)
        .retry()
        .attempts(5)
        .execute(s),
    ).to.equal(2);

    expect(s).to.have.been.calledTwice;
  });

  it('permits specifying exponential backoffs', async () => {
    const s = stub().returns(1);

    expect(
      await Policy.handleWhenResult(r => typeof r === 'number')
        .retry()
        .exponential({ generator: noJitterGenerator, maxAttempts: 2 })
        .execute(s),
    ).to.equal(1);

    expect(s).to.have.callCount(3);
  });

  it('bubbles returns when retry attempts exceeded', async () => {
    const s = stub().returns(1);

    expect(
      await Policy.handleWhenResult(r => typeof r === 'number' && r < 2)
        .retry()
        .attempts(5)
        .execute(s),
    ).to.equal(1);

    expect(s).to.have.callCount(6);
  });

  it('bubbles errors when retry attempts exceeded', async () => {
    const s = stub().throws(new MyErrorB());

    await expect(Policy.handleAll().retry().attempts(5).execute(s)).to.eventually.be.rejectedWith(
      MyErrorB,
    );

    expect(s).to.have.callCount(6);
  });

  it('does not unref by default', async () => {
    const output = await runInChild(`
      Policy.handleAll()
        .retry()
        .attempts(1)
        .delay(1)
        .execute(() => {
          console.log('attempt');
          throw new Error('oh no!');
        });
    `);

    expect(output).to.contain('oh no!');
  });

  it('unrefs as requested', async () => {
    const output = await runInChild(`
      Policy.handleAll()
        .retry()
        .dangerouslyUnref()
        .attempts(1)
        .delay(1)
        .execute(() => {
          console.log('attempt');
          throw new Error('oh no!');
        });
    `);

    expect(output).to.equal('attempt');
  });

  it('stops retries if cancellation is requested', async () => {
    const parent = new CancellationTokenSource();
    const err = new Error();
    let calls = 0;
    await expect(
      Policy.handleAll()
        .retry()
        .attempts(3)
        .execute(({ cancellationToken }) => {
          calls++;
          expect(cancellationToken.isCancellationRequested).to.be.false;
          parent.cancel();
          expect(cancellationToken.isCancellationRequested).to.be.true;
          throw err;
        }, parent.token),
    ).to.eventually.be.rejectedWith(err);
    expect(calls).to.equal(1);
  });
});
