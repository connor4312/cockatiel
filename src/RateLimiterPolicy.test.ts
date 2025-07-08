import { describe, it, beforeEach, afterEach } from 'vitest';
import * as sinon from 'sinon';
import { rateLimiter, RateLimitExceededError, isRateLimitError } from './RateLimiterPolicy';
import { TaskCancelledError } from './errors/Errors';

describe('RateLimiterPolicy', () => {
  let clock: sinon.SinonFakeTimers;
  
  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('basic functionality', () => {
    it('should allow executions within rate limit', async () => {
      const policy = rateLimiter({ bucketSize: 3, interval: 1000 });
      const fn = sinon.stub().resolves('success');

      const results = await Promise.all([
        policy.execute(fn),
        policy.execute(fn),
        policy.execute(fn)
      ]);

      expect(results).to.deep.equal(['success', 'success', 'success']);
      expect(fn.callCount).to.equal(3);
    });

    it('should reject executions exceeding rate limit', async () => {
      const policy = rateLimiter({ bucketSize: 2, interval: 1000 });
      const fn = sinon.stub().resolves('success');

      await policy.execute(fn);
      await policy.execute(fn);

      await expect(policy.execute(fn)).to.be.rejectedWith(RateLimitExceededError);
      expect(fn.callCount).to.equal(2);
    });

    it('should refill tokens over time', async () => {
      const policy = rateLimiter({ bucketSize: 2, interval: 1000 });
      const fn = sinon.stub().resolves('success');

      // Use all tokens
      await policy.execute(fn);
      await policy.execute(fn);

      // Should fail immediately
      await expect(policy.execute(fn)).to.be.rejectedWith(RateLimitExceededError);

      // Wait for half interval - should get 1 token back
      clock.tick(500);
      await policy.execute(fn);

      // Should fail again
      await expect(policy.execute(fn)).to.be.rejectedWith(RateLimitExceededError);

      // Wait for another half interval - should get 1 more token
      clock.tick(500);
      await policy.execute(fn);

      expect(fn.callCount).to.equal(4);
    });

    it('should respect initial tokens configuration', async () => {
      const policy = rateLimiter({ 
        bucketSize: 5, 
        interval: 1000,
        initialTokens: 2 
      });
      const fn = sinon.stub().resolves('success');

      // Should only allow 2 executions initially
      await policy.execute(fn);
      await policy.execute(fn);
      await expect(policy.execute(fn)).to.be.rejectedWith(RateLimitExceededError);

      expect(fn.callCount).to.equal(2);
    });

    it('should cap tokens at bucket size', async () => {
      const policy = rateLimiter({ bucketSize: 3, interval: 1000 });
      const fn = sinon.stub().resolves('success');

      // Wait a long time
      clock.tick(10000);

      // Should still only allow bucketSize executions
      await policy.execute(fn);
      await policy.execute(fn);
      await policy.execute(fn);
      await expect(policy.execute(fn)).to.be.rejectedWith(RateLimitExceededError);

      expect(fn.callCount).to.equal(3);
    });
  });

  describe('queueing', () => {
    it('should queue executions when enabled', async () => {
      const policy = rateLimiter({ 
        bucketSize: 2, 
        interval: 1000,
        queueEnabled: true 
      });
      const fn = sinon.stub().callsFake((_, index) => Promise.resolve(index));

      const promises = [
        policy.execute(c => fn(c, 1)),
        policy.execute(c => fn(c, 2)),
        policy.execute(c => fn(c, 3)),
        policy.execute(c => fn(c, 4))
      ];

      // First 2 should execute immediately
      expect(fn.callCount).to.equal(2);

      // Advance time to process queue
      await clock.tickAsync(500);
      expect(fn.callCount).to.equal(3);

      await clock.tickAsync(500);
      expect(fn.callCount).to.equal(4);

      const results = await Promise.all(promises);
      expect(results).to.deep.equal([1, 2, 3, 4]);
    });

    it('should respect max queue size', async () => {
      const policy = rateLimiter({ 
        bucketSize: 1, 
        interval: 1000,
        queueEnabled: true,
        maxQueueSize: 2
      });
      const fn = sinon.stub().resolves('success');

      // First executes immediately
      const p1 = policy.execute(fn);
      
      // Next 2 are queued
      const p2 = policy.execute(fn);
      const p3 = policy.execute(fn);
      
      // 4th should be rejected
      await expect(policy.execute(fn)).to.be.rejectedWith(RateLimitExceededError);

      // Process the queue
      await clock.tickAsync(1000);
      await clock.tickAsync(1000);
      
      await Promise.all([p1, p2, p3]);
      expect(fn.callCount).to.equal(3);
    });

    it('should handle abort signals in queue', async () => {
      const policy = rateLimiter({ 
        bucketSize: 1, 
        interval: 1000,
        queueEnabled: true 
      });
      const fn = sinon.stub().resolves('success');

      // First executes immediately
      await policy.execute(fn);

      // Queue another with abort controller
      const controller = new AbortController();
      const promise = policy.execute(fn, controller.signal);

      // Abort before it can execute
      controller.abort(new Error('Aborted'));

      await expect(promise).to.be.rejectedWith('Aborted');
      expect(fn.callCount).to.equal(1);
    });
  });

  describe('state and reset', () => {
    it('should report current state', () => {
      const policy = rateLimiter({ bucketSize: 5, interval: 1000 });
      
      let state = policy.getState();
      expect(state).to.deep.equal({
        availableTokens: 5,
        queueSize: 0,
        bucketSize: 5
      });

      policy.execute(() => {});
      policy.execute(() => {});

      state = policy.getState();
      expect(state).to.deep.equal({
        availableTokens: 3,
        queueSize: 0,
        bucketSize: 5
      });
    });

    it('should reset state and clear queue', async () => {
      const policy = rateLimiter({ 
        bucketSize: 1, 
        interval: 1000,
        queueEnabled: true 
      });
      const fn = sinon.stub().resolves('success');

      // Fill up the queue
      policy.execute(fn);
      const p1 = policy.execute(fn);
      const p2 = policy.execute(fn);

      expect(policy.getState().queueSize).to.equal(2);

      // Reset should reject queued items
      policy.reset();

      await expect(p1).to.be.rejectedWith('Rate limiter reset');
      await expect(p2).to.be.rejectedWith('Rate limiter reset');

      expect(policy.getState()).to.deep.equal({
        availableTokens: 1,
        queueSize: 0,
        bucketSize: 1
      });
    });
  });

  describe('error handling', () => {
    it('should include retry after in error', async () => {
      const policy = rateLimiter({ bucketSize: 2, interval: 1000 });
      const fn = sinon.stub().resolves('success');

      await policy.execute(fn);
      await policy.execute(fn);

      try {
        await policy.execute(fn);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isRateLimitError(error)).to.be.true;
        if (isRateLimitError(error)) {
          expect(error.retryAfter).to.be.greaterThan(0);
          expect(error.retryAfter).to.be.lessThanOrEqual(500);
        }
      }
    });

    it('should include queue size in error when using queue', async () => {
      const policy = rateLimiter({ 
        bucketSize: 1, 
        interval: 1000,
        queueEnabled: true,
        maxQueueSize: 1
      });
      const fn = sinon.stub().resolves('success');

      policy.execute(fn); // Executes
      policy.execute(fn); // Queued

      try {
        await policy.execute(fn); // Should fail
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isRateLimitError(error)).to.be.true;
        if (isRateLimitError(error)) {
          expect(error.queueSize).to.equal(1);
        }
      }
    });
  });

  describe('events', () => {
    it('should emit success events', async () => {
      const policy = rateLimiter({ bucketSize: 2, interval: 1000 });
      const successSpy = sinon.spy();
      policy.onSuccess(successSpy);

      await policy.execute(() => 'result');

      expect(successSpy.calledOnce).to.be.true;
      expect(successSpy.firstCall.args[0]).to.have.property('duration').that.is.a('number');
    });

    it('should emit failure events', async () => {
      const policy = rateLimiter({ bucketSize: 2, interval: 1000 });
      const failureSpy = sinon.spy();
      policy.onFailure(failureSpy);

      const error = new Error('Test error');
      await expect(policy.execute(() => { throw error; })).to.be.rejectedWith(error);

      expect(failureSpy.calledOnce).to.be.true;
      const args = failureSpy.firstCall.args[0];
      expect(args).to.have.property('duration').that.is.a('number');
      expect(args).to.have.property('handled').that.is.a('boolean');
      expect(args).to.have.property('reason').that.is.an('object');
    });

    it('should emit reject events', async () => {
      const policy = rateLimiter({ bucketSize: 1, interval: 1000 });
      const rejectSpy = sinon.spy();
      policy.onReject(rejectSpy);

      await policy.execute(() => {});
      await expect(policy.execute(() => {})).to.be.rejectedWith(RateLimitExceededError);

      expect(rejectSpy.calledOnce).to.be.true;
      expect(rejectSpy.firstCall.args[0]).to.deep.equal({
        queueSize: 0
      });
    });
  });

  describe('integration with other policies', () => {
    it('should work with retry policy', async () => {
      // This would require importing retry policy
      // Keeping as a placeholder for integration testing
      expect(true).to.be.true;
    });
  });
});