import { expect } from 'chai';
import { stub } from 'sinon';
import { CacheObject, CachePolicy } from './CachePolicy';

describe('CachePolicy', () => {
  it('should work as expected', async () => {
    const fn = stub().resolves(30);

    const cacheMock = {
      get: stub().onFirstCall().resolves(undefined).resolves(30),
      set: stub(),
    };
    const policy = new CachePolicy(cacheMock as CacheObject);

    await policy.execute(fn, undefined, {
      key: 'CacheKey',
    });
    expect(cacheMock.get.callCount).to.equal(1);
    expect(cacheMock.get.getCall(0).args[0]).to.equal('CacheKey');
    expect(await cacheMock.get.getCall(0).returnValue).to.equal(undefined);
    expect(fn.callCount).to.equal(1);
    expect(cacheMock.set.callCount).to.equal(1);
    expect(cacheMock.set.getCall(0).args[0]).to.equal('CacheKey');
    expect(cacheMock.set.getCall(0).args[1]).to.equal(30);

    await policy.execute(fn, undefined, {
      key: 'CacheKey',
    });
    expect(cacheMock.get.getCall(1).args[0]).to.equal('CacheKey');
    expect(await cacheMock.get.getCall(1).returnValue).to.equal(30);

    await policy.execute(fn, undefined, {
      key: 'CacheKey',
    });
    expect(cacheMock.get.getCall(2).args[0]).to.equal('CacheKey');
    expect(await cacheMock.get.getCall(2).returnValue).to.equal(30);

    expect(fn.callCount).to.equal(1);
    expect(cacheMock.get.callCount).to.equal(3);
    expect(cacheMock.set.callCount).to.equal(1);
  });
});
