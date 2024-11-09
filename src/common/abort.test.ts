import { expect } from 'chai';
import { deriveAbortController } from './abort';

describe('deriveAbortController', () => {
  it('should return an aborted AbortController when the provided signal is already aborted', () => {
    const parentCtrl = new AbortController();
    parentCtrl.abort(new Error('asdf'));
    const { ctrl } = deriveAbortController(parentCtrl.signal);
    expect(ctrl.signal.aborted).to.be.true;
    expect(ctrl.signal.reason).to.equal(parentCtrl.signal.reason);
  });

  it('should abort the new AbortController when the provided signal aborts', () => {
    const parentCtrl = new AbortController();
    const { ctrl } = deriveAbortController(parentCtrl.signal);
    expect(ctrl.signal.aborted).to.be.false;
    parentCtrl.abort(new Error('asdf'));
    expect(ctrl.signal.aborted).to.be.true;
    expect(ctrl.signal.reason).to.equal(parentCtrl.signal.reason);
  });
});
