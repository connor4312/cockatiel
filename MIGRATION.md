# Migration Guide

## Migrating from v2 to v3

Version 3 includes significant API changes to improve tree-shaking and bundle sizes. Here's how to migrate your code:

### Breaking Changes

#### 1. Policy Creation

**Before (v2):**

```typescript
import { Policy } from 'cockatiel';

const retryPolicy = Policy.handleAll().retry().attempts(3).exponentialBackoff();

const circuitBreaker = Policy.handleAll().circuitBreaker(10_000, new ConsecutiveBreaker(5));
```

**After (v3):**

```typescript
import {
  retry,
  circuitBreaker,
  handleAll,
  ConsecutiveBreaker,
  ExponentialBackoff,
} from 'cockatiel';

const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff(),
});

const circuitBreaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
```

#### 2. Policy Builders Removed

All fluent builder methods have been replaced with configuration objects:

**Before:**

```typescript
Policy.handleAll().retry().attempts(5).delay(100).exponentialBackoff({ maxDelay: 30_000 });
```

**After:**

```typescript
retry(handleAll, {
  maxAttempts: 5,
  backoff: new ExponentialBackoff({
    initialDelay: 100,
    maxDelay: 30_000,
  }),
});
```

#### 3. Import Changes

**Before:**

```typescript
import { Policy } from 'cockatiel';
// Everything was on the Policy class
```

**After:**

```typescript
// Import only what you need - better tree-shaking!
import {
  retry,
  circuitBreaker,
  timeout,
  bulkhead,
  fallback,
  wrap,
  handleAll,
  handleType,
  handleWhen,
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
} from 'cockatiel';
```

### Common Migration Patterns

#### Retry Policy

```typescript
// v2
const policy = Policy.handleType(NetworkError).retry().attempts(3).exponentialBackoff();

// v3
const policy = retry(handleType(NetworkError), {
  maxAttempts: 3,
  backoff: new ExponentialBackoff(),
});
```

#### Circuit Breaker

```typescript
// v2
const policy = Policy.handleAll().circuitBreaker(5000, new SamplingBreaker(0.2, 30000));

// v3
const policy = circuitBreaker(handleAll, {
  halfOpenAfter: 5000,
  breaker: new SamplingBreaker({
    threshold: 0.2,
    duration: 30000,
  }),
});
```

#### Timeout

```typescript
// v2
const policy = Policy.timeout(5000, TimeoutStrategy.Aggressive);

// v3
const policy = timeout(5000, TimeoutStrategy.Aggressive);
```

#### Fallback

```typescript
// v2
const policy = Policy.handleType(DatabaseError).fallback(() => getCachedData());

// v3
const policy = fallback(handleType(DatabaseError), () => getCachedData());
```

#### Policy Composition

```typescript
// v2
const policy = Policy.handleAll()
  .retry()
  .attempts(3)
  .circuitBreaker(10_000, new ConsecutiveBreaker(5))
  .timeout(5000);

// v3
const policy = wrap(
  retry(handleAll, { maxAttempts: 3 }),
  circuitBreaker(handleAll, {
    halfOpenAfter: 10_000,
    breaker: new ConsecutiveBreaker(5),
  }),
  timeout(5000, TimeoutStrategy.Cooperative),
);
```

### New Features in v3

#### 1. Circuit Breaker State Hydration

```typescript
// Save state
const state = breaker.toJSON();

// Restore in a new instance
const breaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
  initialState: state,
});
```

#### 2. Backoff for Circuit Breaker Half-Open

```typescript
const breaker = circuitBreaker(handleAll, {
  halfOpenAfter: new ExponentialBackoff(),
  breaker: new ConsecutiveBreaker(5),
});
```

#### 3. Count-based Circuit Breaker

```typescript
const breaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new CountBreaker({
    threshold: 0.2,
    size: 100,
    minimumNumberOfCalls: 50,
  }),
});
```

### Benefits of v3

1. **Better Tree-Shaking**: Import only the policies you use
2. **Smaller Bundle Size**: Unused policies are not included
3. **Type Safety**: Improved TypeScript types with configuration objects
4. **Performance**: Optimizations throughout the codebase
5. **Flexibility**: New features like state hydration

### Getting Help

If you encounter issues during migration:

1. Check the [examples in the README](README.md)
2. Review the [API documentation](https://github.com/connor4312/cockatiel#readme)
3. Open an issue on [GitHub](https://github.com/connor4312/cockatiel/issues)

### Automated Migration

For large codebases, consider using a codemod. Here's a simple example using jscodeshift:

```bash
# Install jscodeshift
npm install -g jscodeshift

# Run the migration (example - actual codemod not included)
jscodeshift -t cockatiel-v3-migration.js src/**/*.ts
```
