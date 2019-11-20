import { expect } from 'chai';
import { stub } from 'sinon';
import { CancellationToken, CancellationTokenSource } from '../CancellationToken';
import { TaskCancelledError } from '../errors/TaskCancelledError';
import { Event, EventEmitter, MemorizingEventEmitter } from './Event';

describe('Event', () => {
  it('emits events', () => {
    const s = stub();
    const emitter = new EventEmitter<number>();

    const l = emitter.addListener(s);
    emitter.emit(42);
    l.dispose();
    emitter.emit(43);

    expect(s).to.have.been.calledOnceWith(42);
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

    expect((emitter as any).listeners.size).to.equal(0);
  });

  it('cancels conversion to promise', async () => {
    const emitter = new EventEmitter<number>();
    const cts = new CancellationTokenSource();
    setTimeout(() => cts.cancel(), 1);
    const v = Event.toPromise(emitter.addListener, cts.token);
    await expect(v).to.eventually.be.rejectedWith(TaskCancelledError);
    expect((emitter as any).listeners.size).to.equal(0);
  });

  it('cancels conversion to promise sync', async () => {
    const emitter = new EventEmitter<number>();
    const v = Event.toPromise(emitter.addListener, CancellationToken.Cancelled);
    await expect(v).to.eventually.be.rejectedWith(TaskCancelledError);
    expect((emitter as any).listeners.size).to.equal(0);
  });
});
