import { expect } from 'chai';
import { SinonStub, stub } from 'sinon';
import { promisify } from 'util';
import { CancellationTokenSource } from './CancellationToken';
import { runInChild } from './common/util.test';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { Policy } from './Policy';
import { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy';

const delay = promisify(setTimeout);

describe('TimeoutPolicy', () => {
  it('works when no timeout happens', async () => {
    const policy = Policy.timeout(1000, TimeoutStrategy.Cooperative);
    expect(await policy.execute(() => 42)).to.equal(42);
  });

  it('properly cooperatively cancels', async () => {
    const policy = Policy.timeout(2, TimeoutStrategy.Cooperative);
    expect(
      await policy.execute(async ({ cancellation }) => {
        expect(cancellation.isCancellationRequested).to.be.false;
        await delay(3);
        expect(cancellation.isCancellationRequested).to.be.true;
        return 42;
      }),
    ).to.equal(42);
  });

  it('properly aggressively cancels', async () => {
    const policy = Policy.timeout(5, TimeoutStrategy.Aggressive);
    let verified: Promise<void>;
    await expect(
      policy.execute(
        async ({ cancellation }) =>
          (verified = (async () => {
            await delay(0);
            expect(cancellation.isCancellationRequested).to.be.false;
            await delay(5);
            expect(cancellation.isCancellationRequested).to.be.true;
          })()),
      ),
    ).to.eventually.be.rejectedWith(TaskCancelledError);

    await verified!;
  });

  it('does not unref by default', async () => {
    // this would timeout if the timers were referenced
    const output = await runInChild(`
      Policy.timeout(100, 'aggressive')
        .execute(() => new Promise(() => {}));
    `);

    expect(output).to.contain('Operation timed out');
  });

  it('unrefs as requested', async () => {
    // this would timeout if the timers were referenced
    const output = await runInChild(`
      Policy.timeout(60 * 1000, 'aggressive')
        .dangerouslyUnref()
        .execute(() => new Promise(() => {}));
    `);

    expect(output).to.be.empty;
  });

  it('links parent cancellation token', async () => {
    const parent = new CancellationTokenSource();
    await Policy.timeout(1000, TimeoutStrategy.Cooperative).execute((_, ct) => {
      expect(ct.isCancellationRequested).to.be.false;
      parent.cancel();
      expect(ct.isCancellationRequested).to.be.true;
    }, parent.token);
  });

  it('still has own timeout if given parent', async () => {
    const parent = new CancellationTokenSource();
    await Policy.timeout(1, TimeoutStrategy.Cooperative).execute(async (_, ct) => {
      expect(ct.isCancellationRequested).to.be.false;
      await delay(3);
      expect(ct.isCancellationRequested).to.be.true;
    }, parent.token);
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
      coop = Policy.timeout(2, TimeoutStrategy.Cooperative);
      agg = Policy.timeout(2, TimeoutStrategy.Aggressive);
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
});
