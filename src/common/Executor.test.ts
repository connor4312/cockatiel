import { expect } from 'chai';
import { SinonStub, stub } from 'sinon';
import { ExecuteWrapper } from './Executor';

class HandledError extends Error {}

describe('executor', () => {
  let executor: ExecuteWrapper;
  let onSuccess: SinonStub;
  let onFailure: SinonStub;

  beforeEach(() => {
    executor = new ExecuteWrapper(
      error => error instanceof HandledError,
      r => typeof r === 'number' && r % 2 === 0,
    );
    onSuccess = stub();
    onFailure = stub();
    executor.onFailure(onFailure);
    executor.onSuccess(onSuccess);
  });

  it('handles successful calls', async () => {
    const r = await executor.invoke(x => x * 3, 5);
    expect(r).to.deep.equal({ success: 15 });
    expect(onSuccess).to.been.calledOnce;
    expect(onSuccess.args[0][0].duration).to.be.greaterThan(0);
  });

  it('deals with handled errors', async () => {
    const error = new HandledError();
    const r = await executor.invoke(() => {
      throw error;
    });
    expect(r).to.deep.equal({ error });
    expect(onFailure).to.been.calledOnce;
    expect(onFailure.args[0][0].duration).to.be.greaterThan(0);
    expect(onFailure.args[0][0].handled).to.be.true;
    expect(onFailure.args[0][0].reason).to.deep.equal({ error });
  });

  it('deals with unhandled errors', async () => {
    const error = new Error();
    await expect(
      executor.invoke(() => {
        throw error;
      }),
    ).to.eventually.be.rejectedWith(error);

    expect(onFailure).to.been.calledOnce;
    expect(onFailure.args[0][0].duration).to.be.greaterThan(0);
    expect(onFailure.args[0][0].handled).to.be.false;
    expect(onFailure.args[0][0].reason).to.deep.equal({ error });
  });
});
