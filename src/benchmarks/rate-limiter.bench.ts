import { bench, describe } from 'vitest';
import { rateLimiter } from '../RateLimiterPolicy';

describe('RateLimiterPolicy', () => {
  bench('execute within limits', async () => {
    const policy = rateLimiter({ bucketSize: 1000, interval: 1000 });
    await policy.execute(() => Promise.resolve());
  });

  bench('execute with rejection', async () => {
    const policy = rateLimiter({ bucketSize: 1, interval: 10000 });
    // Use up the token
    await policy.execute(() => Promise.resolve());
    // This will be rejected
    try {
      await policy.execute(() => Promise.resolve());
    } catch {
      // Expected
    }
  });

  bench('execute with queue', async () => {
    const policy = rateLimiter({
      bucketSize: 10,
      interval: 100,
      queueEnabled: true,
    });

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(policy.execute(() => Promise.resolve(i)));
    }
    await Promise.all(promises);
  });

  bench('getState', () => {
    const policy = rateLimiter({ bucketSize: 100, interval: 1000 });
    policy.getState();
  });

  bench('concurrent executions within limit', async () => {
    const policy = rateLimiter({ bucketSize: 100, interval: 1000 });
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(policy.execute(() => Promise.resolve(i)));
    }
    await Promise.all(promises);
  });
});
