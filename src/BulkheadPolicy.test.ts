import { expect } from 'chai';
import { promisify } from 'util';
import { CancellationToken, CancellationTokenSource } from './CancellationToken';
import { defer } from './common/defer';
import { BulkheadRejectedError } from './errors/BulkheadRejectedError';
import { TaskCancelledError } from './errors/Errors';
import { Policy } from './Policy';

const delay = promisify(setTimeout);

describe('Bulkhead', () => {
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
    const b = Policy.bulkhead(2);
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
    const b = Policy.bulkhead(2, 2);
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
    const b = Policy.bulkhead(2, 2);
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
    const bulkhead = Policy.bulkhead(1, Infinity);
    const todo: Array<PromiseLike<void>> = [];
    for (let i = 0; i < 3; i++) {
      const parent = new CancellationTokenSource();
      todo.push(
        bulkhead.execute(async ({ cancellationToken }) => {
          await delay(1);
          expect(cancellationToken.isCancellationRequested).to.be.false;
          parent.cancel();
          expect(cancellationToken.isCancellationRequested).to.be.true;
        }, parent.token),
      );
    }

    // initially cancelled
    todo.push(
      expect(
        bulkhead.execute(() => {
          throw new Error('expected not to call');
        }, CancellationToken.Cancelled),
      ).to.be.rejectedWith(TaskCancelledError),
    );

    // cancelled by the time it gets executed
    const cancelledCts = new CancellationTokenSource();
    setTimeout(() => cancelledCts.cancel(), 2);
    todo.push(
      expect(
        bulkhead.execute(() => {
          throw new Error('expected not to call');
        }, cancelledCts.token),
      ).to.be.rejectedWith(TaskCancelledError),
    );

    await Promise.all(todo);
  });
});
