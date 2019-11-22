import { expect } from 'chai';
import { stub } from 'sinon';
import { ConsecutiveBreaker } from './breaker/Breaker';
import { CancellationToken } from './CancellationToken';
import { BrokenCircuitError } from './errors/Errors';
import { Policy } from './Policy';
import { TimeoutStrategy } from './TimeoutPolicy';

class MyError1 extends Error {}
class MyError2 extends Error {}
class MyError3 extends Error {}

// tslint:disable-next-line: variable-name
const assertNever = (_value: never) => {
  throw new Error('unreachable');
};

describe('Policy', () => {
  it('wraps', async () => {
    const policy = Policy.wrap(
      Policy.handleType(MyError1)
        .retry()
        .attempts(3),
      Policy.handleAll().circuitBreaker(100, new ConsecutiveBreaker(2)),
    );

    // should retry and break the circuit
    await expect(policy.execute(stub().throws(new MyError1()))).to.be.rejectedWith(
      BrokenCircuitError,
    );
  });

  it('wraps and keeps correct types', async () => {
    const policy = Policy.wrap(
      Policy.handleAll().retry(),
      Policy.handleAll().circuitBreaker(100, new ConsecutiveBreaker(2)),
      Policy.handleAll().fallback('foo'),
      Policy.timeout(1000, TimeoutStrategy.Aggressive),
      Policy.noop,
    );

    const result = await policy.execute(context => {
      expect(context.cancellation).to.be.an.instanceOf(CancellationToken);
      expect(context.attempt).to.equal(0);
      return 1234;
    });

    switch (typeof result) {
      case 'string':
        result.toUpperCase();
        break;
      case 'number':
        Math.pow(result, 2);
        break;
      default:
        assertNever(result);
    }
  });

  it('applies error filters', async () => {
    const fn = stub()
      .onCall(0)
      .throws(new MyError1())
      .onCall(1)
      .throws(new MyError2())
      .onCall(2)
      .throws(new MyError3('foo'))
      .onCall(3)
      .throws(new Error('potato'))
      .onCall(4)
      .throws(new MyError3('bar'));

    await expect(
      Policy.handleType(MyError1)
        .orType(MyError2)
        .orType(MyError3, e => e.message === 'foo')
        .orWhen(e => e.message === 'potato')
        .retry()
        .attempts(10)
        .execute(fn),
    ).to.be.rejectedWith(MyError3, 'bar');

    expect(fn).to.have.callCount(5);
  });

  it('applies result filters', async () => {
    const fn = stub()
      .onCall(0)
      .returns(new MyError1())
      .onCall(1)
      .returns(new MyError2())
      .onCall(2)
      .returns(new MyError3('foo'))
      .onCall(3)
      .returns('potato')
      .onCall(4)
      .returns('ok!');

    expect(
      await Policy.handleResultType(MyError1)
        .orResultType(MyError2)
        .orResultType(MyError3, e => e.message === 'foo')
        .orWhenResult(e => e === 'potato')
        .retry()
        .attempts(10)
        .execute(fn),
    ).to.equal('ok!');

    expect(fn).to.have.callCount(5);
  });
});
