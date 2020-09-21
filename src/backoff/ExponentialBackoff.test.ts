import { expectDurations } from './Backoff.test';
import { ExponentialBackoff } from './ExponentialBackoff';
import { noJitterGenerator } from './ExponentialBackoffGenerators';

describe('ExponentialBackoff', () => {
  it('works', () => {
    const b = new ExponentialBackoff({ generator: noJitterGenerator });
    expectDurations(b, [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 30000, 30000, 30000]);
  });

  it('sets max retries correctly', () => {
    const b = new ExponentialBackoff({ generator: noJitterGenerator, maxAttempts: 4 });
    expectDurations(b, [128, 256, 512, 1024, undefined]);
  });
});
