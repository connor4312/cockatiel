import { expect } from 'chai';
import { promisify } from 'util';
import { defer } from './common/defer';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { Policy } from './Policy';
import { TimeoutStrategy } from './TimeoutPolicy';

const delay = promisify(setTimeout);

describe('TimeoutPolicy', () => {
  it('works when no timeout happens', async () => {
    const policy = Policy.timeout(1000, TimeoutStrategy.Cooperative);
    expect(await policy.execute(() => 42)).to.equal(42);
  });

  it('properly cooperatively cancels', async () => {
    const policy = Policy.timeout(2, TimeoutStrategy.Cooperative);
    expect(
      await policy.execute(async ct => {
        expect(ct.isCancellationRequested).to.be.false;
        await delay(3);
        expect(ct.isCancellationRequested).to.be.true;
        return 42;
      }),
    ).to.equal(42);
  });

  it('properly aggressively cancels', async () => {
    const policy = Policy.timeout(2, TimeoutStrategy.Aggressive);
    const verified = defer();
    await expect(
      policy.execute(async ct => {
        expect(ct.isCancellationRequested).to.be.false;
        await delay(3);
        expect(ct.isCancellationRequested).to.be.true;
        verified.resolve(undefined);
        return 42;
      }),
    ).to.eventually.be.rejectedWith(TaskCancelledError);

    await verified.promise;
  });
});
