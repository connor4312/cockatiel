import { expect } from 'chai';
import { stub } from 'sinon';
import { CancellationTokenSource } from './CancellationToken';

describe('CancellationToken', () => {
  it('emits a cancellation event', () => {
    const cts = new CancellationTokenSource();

    const didCancel = stub();
    cts.token.onCancellationRequested(didCancel);

    expect(didCancel).to.not.have.been.called;
    cts.cancel();
    expect(didCancel).to.have.been.called;
  });

  it('marks the cancellation boolean', () => {
    const cts = new CancellationTokenSource();

    expect(cts.token.isCancellationRequested).to.be.false;
    cts.cancel();
    expect(cts.token.isCancellationRequested).to.be.true;
  });

  it('resolves the cancellation promise', async () => {
    const cts = new CancellationTokenSource();
    const prom = cts.token.cancellation();
    cts.cancel();
    await prom;
  });

  it('propagates cancellation down', async () => {
    const parent = new CancellationTokenSource();
    const child = new CancellationTokenSource(parent.token);

    expect(child.token.isCancellationRequested).to.be.false;
    parent.cancel();
    expect(parent.token.isCancellationRequested).to.be.true;
    expect(child.token.isCancellationRequested).to.be.true;
  });

  it('does not propagate cancellation up', async () => {
    const parent = new CancellationTokenSource();
    const child = new CancellationTokenSource(parent.token);

    child.cancel();
    expect(parent.token.isCancellationRequested).to.be.false;
    expect(child.token.isCancellationRequested).to.be.true;

    parent.cancel();
    expect(parent.token.isCancellationRequested).to.be.true;
  });
});
