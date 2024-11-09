import { expect } from 'chai';
import { BrokenCircuitError } from './BrokenCircuitError';
import { BulkheadRejectedError } from './BulkheadRejectedError';
import {
  isBrokenCircuitError,
  isBulkheadRejectedError,
  isHydratingCircuitError,
  isIsolatedCircuitError,
  isTaskCancelledError,
} from './Errors';
import { HydratingCircuitError } from './HydratingCircuitError';
import { IsolatedCircuitError } from './IsolatedCircuitError';
import { TaskCancelledError } from './TaskCancelledError';

describe('Errors', () => {
  describe('isBrokenCircuitError', () => {
    const error = new BrokenCircuitError();

    it('returns true for an instance of BrokenCircuitError', () => {
      expect(isBrokenCircuitError(error)).to.be.true;
    });

    it('returns true for an instance of IsolatedCircuitError', () => {
      expect(isBrokenCircuitError(new IsolatedCircuitError())).to.be.true;
    });

    it('returns false for an instance of BulkheadRejectedError', () => {
      expect(isBrokenCircuitError(new BulkheadRejectedError(0, 0))).to.be.false;
    });

    it('returns false for an instance of TaskCancelledError', () => {
      expect(isBrokenCircuitError(new TaskCancelledError())).to.be.false;
    });

    it('returns false for an instance of HydratingCircuitError', () => {
      expect(isBrokenCircuitError(new HydratingCircuitError())).to.be.false;
    });
  });

  describe('BulkheadRejectedError', () => {
    const error = new BulkheadRejectedError(0, 0);

    it('returns true for an instance of BulkheadRejectedError', () => {
      expect(isBulkheadRejectedError(error)).to.be.true;
    });

    it('returns false for an instance of BrokenCircuitError', () => {
      expect(isBulkheadRejectedError(new BrokenCircuitError())).to.be.false;
    });

    it('returns false for an instance of IsolatedCircuitError', () => {
      expect(isBulkheadRejectedError(new IsolatedCircuitError())).to.be.false;
    });

    it('returns false for an instance of TaskCancelledError', () => {
      expect(isBulkheadRejectedError(new TaskCancelledError())).to.be.false;
    });

    it('returns false for an instance of HydratingCircuitError', () => {
      expect(isBulkheadRejectedError(new HydratingCircuitError())).to.be.false;
    });
  });

  describe('IsolatedCircuitError', () => {
    const error = new IsolatedCircuitError();

    it('returns true for an instance of IsolatedCircuitError', () => {
      expect(isIsolatedCircuitError(error)).to.be.true;
    });

    it('returns false for an instance of BrokenCircuitError', () => {
      expect(isIsolatedCircuitError(new BrokenCircuitError())).to.be.false;
    });

    it('returns false for an instance of BulkheadRejectedError', () => {
      expect(isIsolatedCircuitError(new BulkheadRejectedError(0, 0))).to.be.false;
    });

    it('returns false for an instance of TaskCancelledError', () => {
      expect(isIsolatedCircuitError(new TaskCancelledError())).to.be.false;
    });

    it('returns false for an instance of HydratingCircuitError', () => {
      expect(isIsolatedCircuitError(new HydratingCircuitError())).to.be.false;
    });
  });

  describe('TaskCancelledError', () => {
    const error = new TaskCancelledError();

    it('returns true for an instance of TaskCancelledError', () => {
      expect(isTaskCancelledError(error)).to.be.true;
    });

    it('returns false for an instance of BrokenCircuitError', () => {
      expect(isTaskCancelledError(new BrokenCircuitError())).to.be.false;
    });

    it('returns false for an instance of BulkheadRejectedError', () => {
      expect(isTaskCancelledError(new BulkheadRejectedError(0, 0))).to.be.false;
    });

    it('returns false for an instance of IsolatedCircuitError', () => {
      expect(isTaskCancelledError(new IsolatedCircuitError())).to.be.false;
    });

    it('returns false for an instance of HydratingCircuitError', () => {
      expect(isTaskCancelledError(new HydratingCircuitError())).to.be.false;
    });
  });

  describe('HydratingCircuitError', () => {
    const error = new HydratingCircuitError();

    it('returns true for an instance of HydratingCircuitError', () => {
      expect(isHydratingCircuitError(error)).to.be.true;
    });

    it('returns false for an instance of BrokenCircuitError', () => {
      expect(isHydratingCircuitError(new BrokenCircuitError())).to.be.false;
    });

    it('returns false for an instance of BulkheadRejectedError', () => {
      expect(isHydratingCircuitError(new BulkheadRejectedError(0, 0))).to.be.false;
    });

    it('returns false for an instance of IsolatedCircuitError', () => {
      expect(isHydratingCircuitError(new IsolatedCircuitError())).to.be.false;
    });

    it('returns false for an instance of TaskCancelledError', () => {
      expect(isHydratingCircuitError(new TaskCancelledError())).to.be.false;
    });
  });
});
