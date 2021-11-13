import { expect } from 'chai';
import { SinonFakeTimers, SinonStub, stub, useFakeTimers } from 'sinon';
import { promisify } from 'util';
import { ConsecutiveBreaker } from './breaker/Breaker';
import { CircuitBreakerPolicy, CircuitState } from './CircuitBreakerPolicy';
import { abortedSignal } from './common/abort';
import { BrokenCircuitError, TaskCancelledError } from './errors/Errors';
import { IsolatedCircuitError } from './errors/IsolatedCircuitError';
import { Policy } from './Policy';

class MyException extends Error {}

const delay = promisify(setTimeout);

describe('CircuitBreakerPolicy', () => {
  let p: CircuitBreakerPolicy;
  let clock: SinonFakeTimers;
  let onBreak: SinonStub;
  let onReset: SinonStub;
  let onHalfOpen: SinonStub;

  beforeEach(() => {
    p = Policy.handleType(MyException).circuitBreaker(1000, new ConsecutiveBreaker(2));
    clock = useFakeTimers();
    onBreak = stub();
    onReset = stub();
    onHalfOpen = stub();
    p.onBreak(onBreak);
    p.onReset(onReset);
    p.onHalfOpen(onHalfOpen);
  });

  afterEach(() => {
    clock.restore();
  });

  const openBreaker = async () => {
    const s = stub().throws(new MyException());
    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    await expect(p.execute(s)).to.be.rejectedWith(MyException);
  };

  it('allows calls when open', async () => {
    expect(await p.execute(() => 42)).to.equal(42);
  });

  it('opens after failing calls', async () => {
    const s = stub().throws(new MyException());

    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onBreak).not.called;

    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Open);
    expect(onBreak).called;

    await expect(p.execute(s)).to.be.rejectedWith(BrokenCircuitError);
    expect(p.state).to.equal(CircuitState.Open);

    expect((p.lastFailure as any).error).to.be.an.instanceOf(MyException);
    expect(onBreak).calledOnce;
    expect(s).calledTwice;
  });

  it('closes if the half open test succeeds', async () => {
    await openBreaker();

    clock.tick(1000);

    const result = p.execute(stub().resolves(42));
    expect(p.state).to.equal(CircuitState.HalfOpen);
    expect(onHalfOpen).calledOnce;
    expect(await result).to.equal(42);
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;
  });

  it('dedupes half-open tests', async () => {
    await openBreaker();
    clock.tick(1000);

    // Two functinos, a and b. We execute with "a" first, and then make sure
    // it returns before "b" gets called.
    let aReturned = false;
    const a = async () => {
      await delay(10);
      aReturned = true;
      return 1;
    };

    const b = async () => {
      expect(aReturned).to.be.true;
      return 2;
    };

    const todo = [
      expect(p.execute(a)).to.eventually.equal(1),
      expect(p.execute(b)).to.eventually.equal(2),
    ];

    clock.tick(10);

    await Promise.all(todo);
  });

  it('stops deduped half-open tests if the circuit reopens', async () => {
    await openBreaker();
    clock.tick(1000);

    // Two functinos, a and b. We execute with "a" first, and then make sure
    // it returns before "b" gets called.
    const a = async () => {
      await delay(10);
      throw new MyException();
    };

    const b = async () => {
      throw new Error('expected to not be called');
    };

    const todo = [
      expect(p.execute(a)).to.be.rejectedWith(MyException),
      expect(p.execute(b)).to.be.rejectedWith(BrokenCircuitError),
    ];

    clock.tick(10);

    await Promise.all(todo);
  });

  it('re-opens if the half open fails', async () => {
    await openBreaker();

    clock.tick(1000);

    const s = stub().throws(new MyException());
    await expect(p.execute(s)).to.be.rejectedWith(MyException);
    expect(p.state).to.equal(CircuitState.Open);
  });

  it('handles isolation correctly', async () => {
    const handle1 = p.isolate();
    expect(onBreak).calledOnceWith({ isolated: true });

    const handle2 = p.isolate();
    expect(onBreak).calledOnce;

    expect(p.state).to.equal(CircuitState.Isolated);
    await expect(p.execute(() => 42)).to.be.rejectedWith(IsolatedCircuitError);

    handle1.dispose();
    expect(p.state).to.equal(CircuitState.Isolated);
    expect(onReset).not.called;

    handle2.dispose();
    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;

    expect(await p.execute(() => 42)).to.equal(42);
  });

  it('links parent cancellation token', async () => {
    const parent = new AbortController();
    await Policy.handleAll()
      .circuitBreaker(1000, new ConsecutiveBreaker(3))
      .execute(({ signal }) => {
        expect(signal.aborted).to.be.false;
        parent.abort();
        expect(signal.aborted).to.be.true;
      }, parent.signal);
  });

  it('aborts function execution if half open test succeeds', async () => {
    await openBreaker();

    clock.tick(1000);

    // half open test:
    p.execute(stub().resolves(42));

    // queued timeout:
    await expect(p.execute(stub(), abortedSignal)).to.be.rejectedWith(TaskCancelledError);

    expect(p.state).to.equal(CircuitState.Closed);
    expect(onReset).calledOnce;
  });
});
