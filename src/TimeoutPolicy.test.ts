import { expect } from 'chai';
import { SinonStub, stub } from 'sinon';
import { promisify } from 'util';
import { ExponentialBackoff } from './backoff/ExponentialBackoff';
import { runInChild } from './common/util.test';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { handleAll, retry, timeout, wrap } from './Policy';
import { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy';

const delay = promisify(setTimeout);

describe('TimeoutPolicy', () => {
  it('works when no timeout happens', async () => {
    const policy = timeout(1000, TimeoutStrategy.Cooperative);
    expect(await policy.execute(() => 42)).to.equal(42);
  });

  it('properly cooperatively cancels', async () => {
    const policy = timeout(2, TimeoutStrategy.Cooperative);
    expect(
      await policy.execute(async ({ signal }) => {
        expect(signal.aborted).to.be.false;
        await delay(3);
        expect(signal.aborted).to.be.true;
        return 42;
      }),
    ).to.equal(42);
  });

  it('properly aggressively cancels', async () => {
    const policy = timeout(5, TimeoutStrategy.Aggressive);
    let verified: Promise<void>;
    await expect(
      policy.execute(
        async ({ signal }) =>
          (verified = (async () => {
            await delay(0);
            expect(signal.aborted).to.be.false;
            await delay(5);
            expect(signal.aborted).to.be.true;
          })()),
      ),
    ).to.eventually.be.rejectedWith(TaskCancelledError);

    await verified!;
  });

  it('does not unref by default', async () => {
    // this would timeout if the timers were referenced
    const output = await runInChild(`
      c.timeout(100, 'aggressive')
        .execute(() => new Promise(() => {}));
    `);

    expect(output).to.contain('Operation timed out');
  });

  it('unrefs as requested', async () => {
    // this would timeout if the timers were referenced
    const output = await runInChild(`
      c.timeout(60 * 1000, 'aggressive')
        .dangerouslyUnref()
        .execute(() => new Promise(() => {}));
    `);

    expect(output).to.be.empty;
  });

  it('links parent cancellation token', async () => {
    const parent = new AbortController();
    await timeout(1000, TimeoutStrategy.Cooperative).execute((_, signal) => {
      expect(signal.aborted).to.be.false;
      parent.abort();
      expect(signal.aborted).to.be.true;
    }, parent.signal);
  });

  it('still has own timeout if given parent', async () => {
    const parent = new AbortController();
    await timeout(1, TimeoutStrategy.Cooperative).execute(async (_, signal) => {
      expect(signal.aborted).to.be.false;
      await delay(3);
      expect(signal.aborted).to.be.true;
    }, parent.signal);
  });

  it('aborts on return by default', async () => {
    let signal: AbortSignal;
    await timeout(1, TimeoutStrategy.Cooperative).execute(async (_, s) => {
      signal = s;
    });
    expect(signal!.aborted).to.be.true;
  });

  it('does not aborts on return if requested', async () => {
    let signal: AbortSignal;
    await timeout(1, { strategy: TimeoutStrategy.Aggressive, abortOnReturn: false }).execute(
      async (_, s) => {
        signal = s;
      },
    );
    expect(signal!.aborted).to.be.false;
  });

  describe('events', () => {
    let onSuccess: SinonStub;
    let onFailure: SinonStub;
    let onTimeout: SinonStub;
    let agg: TimeoutPolicy;
    let coop: TimeoutPolicy;

    beforeEach(() => {
      onSuccess = stub();
      onFailure = stub();
      onTimeout = stub();
      coop = timeout(2, TimeoutStrategy.Cooperative);
      agg = timeout(2, TimeoutStrategy.Aggressive);
      for (const p of [coop, agg]) {
        p.onFailure(onFailure);
        p.onSuccess(onSuccess);
        p.onTimeout(onTimeout);
      }
    });

    it('emits a success event (cooperative)', async () => {
      await coop.execute(() => 42);
      await delay(3);
      expect(onSuccess).to.have.been.called;
      expect(onFailure).to.not.have.been.called;
      expect(onTimeout).to.not.have.been.called;
    });

    it('emits a success event (aggressive)', async () => {
      await agg.execute(() => 42);
      await delay(3);
      expect(onSuccess).to.have.been.called;
      expect(onFailure).to.not.have.been.called;
      expect(onTimeout).to.not.have.been.called;
    });

    it('emits a timeout event (cooperative)', async () => {
      coop.onTimeout(onTimeout);
      await coop.execute(() => delay(3));
      expect(onSuccess).to.have.been.called; // still returned a good value
      expect(onTimeout).to.have.been.called;
      expect(onFailure).to.not.have.been.called;
    });

    it('emits a timeout event (aggressive)', async () => {
      await expect(agg.execute(() => delay(3))).to.be.rejectedWith(TaskCancelledError);
      expect(onSuccess).to.not.have.been.called;
      expect(onTimeout).to.have.been.called;
      expect(onFailure).to.have.been.called;
    });

    it('emits a failure event (cooperative)', async () => {
      await expect(
        coop.execute(() => {
          throw new Error('oh no!');
        }),
      ).to.be.rejected;
      await delay(3);

      expect(onSuccess).to.not.have.been.called;
      expect(onTimeout).to.not.have.been.called;
      expect(onFailure).to.have.been.called;
    });

    it('emits a failure event (aggressive)', async () => {
      await expect(
        agg.execute(() => {
          throw new Error('oh no!');
        }),
      ).to.be.rejected;
      await delay(3);

      expect(onSuccess).to.not.have.been.called;
      expect(onTimeout).to.not.have.been.called;
      expect(onFailure).to.have.been.called;
    });
  });

  it('does not leak abort listeners (#81)', async () => {
    const fail = (times: number) => {
      let c = times;
      return async () => {
        if (c-- > 0) {
          throw Error('fail');
        }
      };
    };

    const timeoutPolicy = timeout(1, TimeoutStrategy.Cooperative);
    const retryPolicy = retry(handleAll, {
      backoff: new ExponentialBackoff({
        initialDelay: 1,
        exponent: 2,
        maxDelay: 1,
      }),
    });
    const policy = wrap(retryPolicy, timeoutPolicy);

    const ac = new AbortController();

    let listenerCount = 0;

    const sig = new Proxy(ac.signal, {
      get: (signal, key, receiver) => {
        const val = Reflect.get(signal, key, receiver);
        if (key === 'addEventListener') {
          return (...args: any[]) => {
            listenerCount++;
            return Reflect.apply(val, signal, args);
          };
        }
        if (key === 'removeEventListener') {
          return (...args: any[]) => {
            listenerCount--;
            return Reflect.apply(val, signal, args);
          };
        }
        return val;
      },
    });

    const func = fail(15);

    await policy.execute(() => func(), sig);

    expect(listenerCount).to.eq(0);
  });
});
