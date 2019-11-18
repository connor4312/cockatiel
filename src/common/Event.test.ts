import { expect } from 'chai';
import { stub } from 'sinon';
import { EventEmitter } from './Event';

describe('Event', () => {
  it('works', () => {
    const s = stub();
    const emitter = new EventEmitter<number>();

    const l = emitter.addListener(s);
    emitter.emit(42);
    l.dispose();

    expect(s).to.have.been.calledOnceWith(42);
  });
});
