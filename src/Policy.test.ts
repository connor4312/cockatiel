import { expect } from 'chai';
import { stub } from 'sinon';
import { ConsecutiveBreaker } from './breaker/Breaker';
import { BrokenCircuitError } from './errors/Errors';
import {
  circuitBreaker,
  fallback,
  handleAll,
  handleResultType,
  handleType,
  noop,
  retry,
  timeout,
  usePolicy,
  wrap,
} from './Policy';
import { IRetryContext } from './RetryPolicy';
import { TimeoutStrategy } from './TimeoutPolicy';

class MyError1 extends Error {}
class MyError2 extends Error {}
class MyError3 extends Error {}

const assertNever = (_value: never) => {
  throw new Error('unreachable');
};

describe('Policy', () => {
  it('wraps', async () => {
    const policy = wrap(
      retry(handleType(MyError1), { maxAttempts: 3 }),
      circuitBreaker(handleAll, { halfOpenAfter: 100, breaker: new ConsecutiveBreaker(2) }),
    );

    // should retry and break the circuit
    await expect(policy.execute(stub().throws(new MyError1()))).to.be.rejectedWith(
      BrokenCircuitError,
    );
  });

  it('wraps and keeps correct types', async () => {
    const policies = [
      retry(handleAll, { maxAttempts: 2 }),
      circuitBreaker(handleAll, { halfOpenAfter: 100, breaker: new ConsecutiveBreaker(2) }),
      fallback(handleAll, 'foo'),
      timeout(1000, TimeoutStrategy.Aggressive),
      noop,
    ] as const;
    const policy = wrap(...policies);

    expect(policy.wrapped).to.deep.equal(policies);

    const result = await policy.execute(context => {
      expect(context.signal).to.be.an.instanceOf(AbortSignal);
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
      retry(
        handleType(MyError1)
          .orType(MyError2)
          .orType(MyError3, e => e.message === 'foo')
          .orWhen(e => e.message === 'potato'),
        { maxAttempts: 10 },
      ).execute(fn),
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
      await retry(
        handleResultType(MyError1)
          .orResultType(MyError2)
          .orResultType(MyError3, e => e.message === 'foo')
          .orWhenResult(e => e === 'potato'),
        { maxAttempts: 10 },
      ).execute(fn),
    ).to.equal('ok!');

    expect(fn).to.have.callCount(5);
  });

  it('applies use', async () => {
    class Calculator {
      @usePolicy(retry(handleAll, { maxAttempts: 5 }))
      public double(n: number, context: IRetryContext) {
        if (context!.attempt < 2) {
          throw new Error('failed');
        }

        return { n: n * 2, ...context! };
      }
    }

    const c = new Calculator();
    // @ts-ignore
    const r = await c.double(2);
    expect(r).to.deep.equal({
      n: 4,
      signal: r.signal,
      attempt: 2,
    });
  });

  it('uses abort signal in use', async () => {
    class Calculator {
      @usePolicy(retry(handleAll, { maxAttempts: 5 }))
      public double(n: number, context: IRetryContext) {
        expect(n).to.equal(2);
        expect(context.signal?.aborted).to.be.false;
        cts.abort();
        expect(context.signal?.aborted).to.be.true;
        return n * 2;
      }
    }

    const cts = new AbortController();
    const c = new Calculator();
    // @ts-ignore
    expect(await c.double(2, cts.signal)).to.equal(4);
  });
});
