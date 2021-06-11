import { expect } from 'chai';
import { stub } from 'sinon';
import { CancellationToken, CancellationTokenSource } from '../CancellationToken';
import { TaskCancelledError } from '../errors/TaskCancelledError';
import { Event, EventEmitter, MemorizingEventEmitter } from './Event';

describe('Event', () => {
  it('emits events', () => {
    const s1 = stub();
    const s2 = stub();
    const s3 = stub();
    const emitter = new EventEmitter<number>();

    const l1 = emitter.addListener(s1);
    emitter.emit(1);
    const l2 = emitter.addListener(s2);
    emitter.emit(2);
    const l3 = emitter.addListener(s3);
    emitter.emit(3);

    l1.dispose();
    emitter.emit(4);
    l2.dispose();
    emitter.emit(5);
    l3.dispose();
    emitter.emit(6);

    expect(s1.args).to.deep.equal([[1], [2], [3]]);
    expect(s2.args).to.deep.equal([[2], [3], [4]]);
    expect(s3.args).to.deep.equal([[3], [4], [5]]);
  });

  it('memorizes event emissions', () => {
    const s1 = stub();
    const s2 = stub();
    const emitter = new MemorizingEventEmitter<number>();
    expect(emitter.hasEmitted).to.be.false;
    emitter.addListener(s1);
    emitter.emit(42);

    expect(emitter.hasEmitted).to.be.true;
    emitter.addListener(s2);

    expect(s1).to.have.been.calledOnceWith(42);
    expect(s2).to.have.been.calledOnceWith(42);
  });

  it('emits events once', () => {
    const s = stub();
    const emitter = new EventEmitter<number>();

    Event.once(emitter.addListener, s);
    emitter.emit(42);
    emitter.emit(42);

    expect(s).to.have.been.calledOnceWith(42);
  });

  it('emits events once with sync call', () => {
    const s = stub();
    const emitter = new MemorizingEventEmitter<number>();

    emitter.emit(42);
    Event.once(emitter.addListener, s);
    emitter.emit(42);

    expect(s).to.have.been.calledOnceWith(42);
  });

  it('converts to promise', async () => {
    const emitter = new EventEmitter<number>();
    const v = Event.toPromise(emitter.addListener);
    emitter.emit(42);
    expect(await v).to.equal(42);

    expect(emitter.size).to.equal(0);
  });

  it('cancels conversion to promise', async () => {
    const emitter = new EventEmitter<number>();
    const cts = new CancellationTokenSource();
    setTimeout(() => cts.cancel(), 1);
    const v = Event.toPromise(emitter.addListener, cts.token);
    await expect(v).to.eventually.be.rejectedWith(TaskCancelledError);
    expect(emitter.size).to.equal(0);
  });

  it('cancels conversion to promise sync', async () => {
    const emitter = new EventEmitter<number>();
    const v = Event.toPromise(emitter.addListener, CancellationToken.Cancelled);
    await expect(v).to.eventually.be.rejectedWith(TaskCancelledError);
    expect(emitter.size).to.equal(0);
  });
});
