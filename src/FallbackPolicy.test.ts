import { expect } from 'chai';
import { stub } from 'sinon';
import { fallback, handleAll } from './Policy';

describe('FallbackPolicy', () => {
  it('does not fall back when not necessary', async () => {
    const result = await fallback(handleAll, 'error').execute(() => 'ok');
    expect(result).to.equal('ok');
  });

  it('returns a fallback and emits an error if necessary', async () => {
    const policy = fallback(handleAll, 'error');
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
    const parent = new AbortController();
    await fallback(handleAll, 'error').execute(({ signal }) => {
      expect(signal.aborted).to.be.false;
      parent.abort();
      expect(signal.aborted).to.be.true;
    }, parent.signal);
  });
});
