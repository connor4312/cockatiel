import { expect } from 'chai';
import { SinonFakeTimers, useFakeTimers } from 'sinon';
import { promisify } from 'util';
import { abortedSignal } from './common/abort.js';
import { defer } from './common/defer.js';
import { BulkheadRejectedError } from './errors/BulkheadRejectedError.js';
import { TaskCancelledError } from './errors/Errors.js';
import { bulkhead, IFailureEvent, ISuccessEvent } from './Policy.js';

const delay = promisify(setTimeout);

describe('Bulkhead', () => {
  describe('execution events', () => {
    let clock: SinonFakeTimers;
    let successes: ISuccessEvent[];
    let failures: IFailureEvent[];
    let b: ReturnType<typeof bulkhead>;

    beforeEach(() => {
      clock = useFakeTimers();
      successes = [];
      failures = [];
      b = bulkhead(1, 2);
      b.onSuccess(event => successes.push(event));
      b.onFailure(event => failures.push(event));
    });

    afterEach(() => clock.restore());

    it('emits success for a synchronous return value', async () => {
      const value = { result: 42 };
      expect(await b.execute(() => value)).to.equal(value);
      expect(successes).to.deep.equal([{ duration: 0 }]);
      expect(failures).to.deep.equal([]);
    });

    it('emits success only when an asynchronous call finishes', async () => {
      const result = defer<number>();
      const output = b.execute(() => result.promise);
      clock.tick(17);
      expect(successes).to.deep.equal([]);
      result.resolve(42);
      expect(await output).to.equal(42);
      expect(successes).to.deep.equal([{ duration: 17 }]);
      expect(failures).to.deep.equal([]);
    });

    it('emits an unhandled failure without replacing a synchronous error', async () => {
      const error = new Error('synchronous failure');
      const result = await b
        .execute(() => {
          throw error;
        })
        .catch(error => error);
      expect(result).to.equal(error);
      expect(failures).to.deep.equal([{ duration: 0, handled: false, reason: { error } }]);
      expect(successes).to.deep.equal([]);
    });

    it('emits an unhandled failure when an asynchronous call rejects', async () => {
      const error = new Error('asynchronous failure');
      const result = defer<never>();
      const output = b.execute(() => result.promise).catch(error => error);
      clock.tick(29);
      expect(failures).to.deep.equal([]);
      result.reject(error);
      expect(await output).to.equal(error);
      expect(failures).to.deep.equal([{ duration: 29, handled: false, reason: { error } }]);
      expect(successes).to.deep.equal([]);
    });

    it('emits once for a queued call and excludes its queue wait from the duration', async () => {
      const first = defer<number>();
      const second = defer<number>();
      const admitted = defer<void>();
      const signal = new AbortController().signal;
      const firstOutput = b.execute(() => first.promise);
      const secondOutput = b.execute(context => {
        expect(context.signal).to.equal(signal);
        admitted.resolve(undefined);
        return second.promise;
      }, signal);
      clock.tick(50);
      first.resolve(1);
      await admitted.promise;
      clock.tick(13);
      second.resolve(2);
      expect(await firstOutput).to.equal(1);
      expect(await secondOutput).to.equal(2);
      expect(successes).to.deep.equal([{ duration: 50 }, { duration: 13 }]);
      expect(failures).to.deep.equal([]);
    });

    it('emits once for a queued failure and continues draining the queue', async () => {
      const first = defer<void>();
      const error = new Error('queued failure');
      const firstOutput = b.execute(() => first.promise);
      const failedOutput = b
        .execute(() => {
          throw error;
        })
        .catch(error => error);
      const lastOutput = b.execute(() => 3);
      first.resolve(undefined);
      await firstOutput;
      expect(await failedOutput).to.equal(error);
      expect(await lastOutput).to.equal(3);
      expect(failures).to.deep.equal([{ duration: 0, handled: false, reason: { error } }]);
      expect(successes).to.deep.equal([{ duration: 0 }, { duration: 0 }]);
      expect(b.executionSlots).to.equal(1);
      expect(b.queueSlots).to.equal(2);
    });

    it('does not emit execution events when the bulkhead rejects a call', async () => {
      const policy = bulkhead(1);
      policy.onSuccess(event => successes.push(event));
      policy.onFailure(event => failures.push(event));
      let rejections = 0;
      policy.onReject(() => rejections++);
      const active = defer<void>();
      const output = policy.execute(() => active.promise);
      await expect(policy.execute(() => 42)).to.be.rejectedWith(BulkheadRejectedError);
      expect(rejections).to.equal(1);
      expect(successes).to.deep.equal([]);
      expect(failures).to.deep.equal([]);
      active.resolve(undefined);
      await output;
    });

    it('does not emit execution events for an already aborted call', async () => {
      await expect(b.execute(() => 42, abortedSignal)).to.be.rejectedWith(TaskCancelledError);
      expect(successes).to.deep.equal([]);
      expect(failures).to.deep.equal([]);
    });

    it('does not emit a failure for a queued call cancelled before execution', async () => {
      const active = defer<void>();
      const signal = new AbortController();
      const output = b.execute(() => active.promise);
      let calls = 0;
      const cancelled = b.execute(() => calls++, signal.signal).catch(error => error);
      signal.abort();
      expect(successes).to.deep.equal([]);
      expect(failures).to.deep.equal([]);
      active.resolve(undefined);
      await output;
      expect(await cancelled).to.be.instanceOf(TaskCancelledError);
      expect(calls).to.equal(0);
      expect(failures).to.deep.equal([]);
      expect(b.executionSlots).to.equal(1);
      expect(b.queueSlots).to.equal(2);
    });
  });

  let order: string[] = [];
  let fnIndex = 0;
  beforeEach(() => {
    order = [];
    fnIndex = 0;
  });

  const makeFn = () => {
    const index = fnIndex++;
    return async () => {
      order.push(`${index}: enter`);
      await delay(index * 2);
      order.push(`${index}: exit`);
      return index;
    };
  };

  const makeFns = (count: number) => {
    const out: Array<() => void> = [];
    for (let i = 0; i < count; i++) {
      out.push(makeFn());
    }
    return out;
  };

  it('rejects calls after limit is hit', async () => {
    const b = bulkhead(2);
    const funcs = makeFns(3);
    const output = funcs.map(fn => b.execute(fn));

    await Promise.all([
      expect(output[0]).to.eventually.equal(0),
      expect(output[1]).to.eventually.equal(1),
      expect(output[2]).to.be.rejectedWith(BulkheadRejectedError),
    ]);

    expect(order).to.deep.equal(['0: enter', '1: enter', '0: exit', '1: exit']);
  });

  it('queues requests, and rejects after queue limit', async () => {
    const b = bulkhead(2, 2);
    const funcs = makeFns(5);
    const output = funcs.map(fn => b.execute(fn));

    await Promise.all([
      expect(output[0]).to.eventually.equal(0),
      expect(output[1]).to.eventually.equal(1),
      expect(output[2]).to.eventually.equal(2),
      expect(output[3]).to.eventually.equal(3),
      expect(output[4]).to.be.rejectedWith(BulkheadRejectedError),
    ]);

    expect(order).to.deep.equal([
      '0: enter',
      '1: enter',
      '0: exit',
      '2: enter',
      '1: exit',
      '3: enter',
      '2: exit',
      '3: exit',
    ]);
  });

  it('maintains proper state', async () => {
    const b = bulkhead(2, 2);
    const defer1 = defer();
    const defer2 = defer();
    const defer3 = defer();
    const defer4 = defer();

    expect(b.queueSlots).to.equal(2);
    expect(b.executionSlots).to.equal(2);

    const out1 = b.execute(() => defer1.promise);
    expect(b.queueSlots).to.equal(2);
    expect(b.executionSlots).to.equal(1);

    const out2 = b.execute(() => defer2.promise);
    expect(b.queueSlots).to.equal(2);
    expect(b.executionSlots).to.equal(0);

    const out3 = b.execute(() => defer3.promise);
    expect(b.queueSlots).to.equal(1);
    expect(b.executionSlots).to.equal(0);

    const out4 = b.execute(() => defer4.promise);
    expect(b.queueSlots).to.equal(0);
    expect(b.executionSlots).to.equal(0);

    defer1.resolve(undefined);
    await out1;
    expect(b.executionSlots).to.equal(0);
    expect(b.queueSlots).to.equal(1);

    defer2.resolve(undefined);
    await out2;
    expect(b.executionSlots).to.equal(0);
    expect(b.queueSlots).to.equal(2);

    defer3.resolve(undefined);
    await out3;
    expect(b.executionSlots).to.equal(1);
    expect(b.queueSlots).to.equal(2);

    defer4.resolve(undefined);
    await out4;
    expect(b.executionSlots).to.equal(2);
    expect(b.queueSlots).to.equal(2);
  });

  it('links parent cancellation token', async () => {
    const b = bulkhead(1, Infinity);
    const todo: Array<PromiseLike<void>> = [];
    for (let i = 0; i < 3; i++) {
      const parent = new AbortController();
      todo.push(
        b.execute(async ({ signal }) => {
          await delay(1);
          expect(signal.aborted).to.be.false;
          parent.abort();
          expect(signal.aborted).to.be.true;
        }, parent.signal),
      );
    }

    // initially cancelled
    todo.push(
      expect(
        b.execute(() => {
          throw new Error('expected not to call');
        }, abortedSignal),
      ).to.be.rejectedWith(TaskCancelledError),
    );

    // cancelled by the time it gets executed
    const cancelledCts = new AbortController();
    setTimeout(() => cancelledCts.abort(), 2);
    todo.push(
      expect(
        b.execute(() => {
          throw new Error('expected not to call');
        }, cancelledCts.signal),
      ).to.be.rejectedWith(TaskCancelledError),
    );

    await Promise.all(todo);
  });

  it('should process next queued item when previous item was aborted', async () => {
    const b = bulkhead(1, 10);
    const defer1 = defer<number>();
    const abortController = new AbortController();

    const promise1 = b.execute(() => defer1.promise);

    const promise2 = b.execute(() => 2, abortController.signal);
    const promise3 = b.execute(() => 3);

    abortController.abort();
    defer1.resolve(1);
    await promise1;

    await expect(promise2).to.be.rejectedWith(TaskCancelledError);
    expect(await promise3).to.equal(3);

    expect(b.executionSlots).to.equal(1);
    expect(b.queueSlots).to.equal(10);
  });
});
