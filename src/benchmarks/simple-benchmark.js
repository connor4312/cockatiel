// Simple benchmark script that works with both old and new versions
const { performance } = require('perf_hooks');

// Import based on what's available
let cockatiel;
try {
  // Try new import style first
  cockatiel = require('../dist/src/index.js');
} catch (e) {
  // Fallback to built version
  cockatiel = require('../dist/index.js');
}

const {
  Policy,
  retry,
  circuitBreaker,
  timeout,
  bulkhead,
  rateLimiter,
  handleAll,
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy
} = cockatiel;

// Helper function to measure performance
async function benchmark(name, fn, iterations = 100000) {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    await fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const end = performance.now();
  
  const nsPerOp = ((end - start) / iterations) * 1000000;
  console.log(`${name}: ${nsPerOp.toFixed(2)} ns/op (${iterations} iterations)`);
}

async function runBenchmarks() {
  console.log('=== Cockatiel Performance Benchmarks ===\n');

  // Baseline
  await benchmark('Baseline function call', async () => {
    const fn = () => 42;
    return fn();
  });

  await benchmark('Baseline async function', async () => {
    const fn = async () => 42;
    return await fn();
  });

  console.log('\n--- Circuit Breaker ---');

  // Circuit Breaker (try both old and new API)
  let breaker;
  try {
    // New API
    breaker = circuitBreaker(handleAll, {
      halfOpenAfter: 10000,
      breaker: new ConsecutiveBreaker(5)
    });
  } catch (e) {
    // Old API
    breaker = Policy.handleAll().circuitBreaker(10000, new ConsecutiveBreaker(5));
  }

  await benchmark('Circuit breaker (closed)', async () => {
    return await breaker.execute(() => 42);
  }, 10000);

  console.log('\n--- Retry Policy ---');

  // Retry Policy
  let retryPolicy;
  try {
    // New API
    retryPolicy = retry(handleAll, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff()
    });
  } catch (e) {
    // Old API
    retryPolicy = Policy.handleAll()
      .retry()
      .attempts(3)
      .exponentialBackoff();
  }

  await benchmark('Retry (immediate success)', async () => {
    return await retryPolicy.execute(() => 42);
  }, 10000);

  console.log('\n--- Timeout Policy ---');

  // Timeout Policy
  let timeoutPolicy;
  try {
    // New API
    timeoutPolicy = timeout(5000, TimeoutStrategy.Cooperative);
  } catch (e) {
    // Old API
    timeoutPolicy = Policy.timeout(5000, TimeoutStrategy.Cooperative);
  }

  await benchmark('Timeout policy', async () => {
    return await timeoutPolicy.execute(() => 42);
  }, 10000);

  console.log('\n--- Bulkhead Policy ---');

  // Bulkhead
  let bulkheadPolicy;
  try {
    // New API
    bulkheadPolicy = bulkhead(10);
  } catch (e) {
    // Old API
    bulkheadPolicy = Policy.bulkhead(10);
  }

  await benchmark('Bulkhead policy', async () => {
    return await bulkheadPolicy.execute(() => 42);
  }, 10000);

  console.log('\n--- Rate Limiter Policy ---');

  // Rate Limiter (only available in new version)
  if (rateLimiter) {
    const rateLimiterPolicy = rateLimiter({
      bucketSize: 1000000, // Very high limit to avoid exhaustion during benchmark
      interval: 1000
    });

    await benchmark('Rate limiter policy', async () => {
      return await rateLimiterPolicy.execute(() => 42);
    }, 10000);
  } else {
    console.log('Rate limiter not available in this version');
  }

  console.log('\n--- Combined Policies ---');

  // Policy wrapping
  try {
    // Try both APIs for wrap
    let combined;
    if (cockatiel.wrap) {
      combined = cockatiel.wrap(retryPolicy, timeoutPolicy);
    } else {
      combined = Policy.wrap(retryPolicy, timeoutPolicy);
    }
    
    await benchmark('Wrapped policies (2)', async () => {
      return await combined.execute(() => 42);
    }, 10000);
  } catch (e) {
    console.log('Policy wrapping not available or different API');
  }

  console.log('\n--- Memory Usage ---');
  
  // Memory usage
  if (global.gc) {
    global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    
    // Create many policies
    const policies = [];
    for (let i = 0; i < 1000; i++) {
      try {
        policies.push(circuitBreaker(handleAll, {
          halfOpenAfter: 10000,
          breaker: new ConsecutiveBreaker(5)
        }));
      } catch (e) {
        policies.push(Policy.handleAll().circuitBreaker(10000, new ConsecutiveBreaker(5)));
      }
    }
    
    const memAfter = process.memoryUsage().heapUsed;
    const memPerPolicy = (memAfter - memBefore) / 1000;
    
    console.log(`Memory per circuit breaker: ${(memPerPolicy / 1024).toFixed(2)} KB`);
  } else {
    console.log('Run with --expose-gc to measure memory usage');
  }

  console.log('\n=== Benchmark Complete ===');
}

// Run benchmarks
runBenchmarks().catch(console.error);