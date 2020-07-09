import { expect } from 'chai';
import { stub } from 'sinon';
import { CancellationTokenSource } from './CancellationToken';
import { Policy } from './Policy';

describe('FallbackPolicy', () => {
  it('does not fall back when not necessary', async () => {
    const result = await Policy.handleAll()
      .fallback('error')
      .execute(() => 'ok');
    expect(result).to.equal('ok');
  });

  it('returns a fallback and emits an error if necessary', async () => {
    const policy = await Policy.handleAll().fallback('error');
    const onFallback = stub();
    policy.onFailure(onFallback);

    const error = new Error('oh no!');
    const result = await policy.execute(() => {
      throw error;
    });
    expect(result).to.equal('error');
    expect(onFallback).calledWith({
      reason: { error },
      handled: true,
      duration: onFallback.args[0]?.[0].duration,
    });
  });

  it('links parent cancellation token', async () => {
    const parent = new CancellationTokenSource();
    await Policy.handleAll()
      .fallback('error')
      .execute(({ cancellationToken }) => {
        expect(cancellationToken.isCancellationRequested).to.be.false;
        parent.cancel();
        expect(cancellationToken.isCancellationRequested).to.be.true;
      }, parent.token);
  });
});
