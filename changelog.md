# Changelog

## 3.1.4

- **fix:** event listener leak in `timeout`

## 3.1.3

- **fix:** decorrelatedJitter backoff returning NaN after many iterations ([#86](https://github.com/connor4312/cockatiel/issues/86))

## 3.1.2

- **chore:** remove test files from dist package ([#84](https://github.com/connor4312/cockatiel/issues/84))

## 3.1.1

- **fix:** memory leak when using `timeout()` in `wrap()` ([#69](https://github.com/connor4312/cockatiel/issues/69))

## 3.1.0

- **feat:** add new option `abortOnReturn` to timeouts ([#72](https://github.com/connor4312/cockatiel/issues/72))

## 3.0.0

- **breaking:** please see the breaking changes for the two 3.0.0-beta releases
- **feat:** expose `wrap()`ed policies in the merged policy ([#61](https://github.com/connor4312/cockatiel/issues/61))

## 3.0.0-beta.1

- **breaking:** **refactor:** create policies as free-floating functions rather than Policy methods

  Previously, all policies were created via something like `Policy.handleAll().retry(...)`. However, as a result, it was hard for bundlers to tree-shake Cockatiel, since the `Policy` class was used and referenced every mechanism provided in this library.

  Instead, policies are now created via functions that consume the base `Policy` configuration--and that configuration is started as free functions rather than static methods. For example, where you previously wrote:

  ```ts
  import { Policy } from 'cockatiel';
  Policy.handleAll().retry().attempts(3);
  ```

  You instead write

  ```ts
  import { handleAll, retry } from 'cockatiel';
  retry(handleAll, { attempts: 3 );
  ```

  The full changes are:

  - `Policy.retry()` -> `retry(policy, options)`
  - `Policy.circuitBreaker(halfOpenAfter, breaker)` -> `retry(policy, { halfOpenAfter: number, breaker: IBreaker })`
  - `Policy.fallback(valueOrFactory)` -> `fallback(policy, valueOrFactory)`
  - `Policy.wrap(...)` -> `wrap(...)`
  - `Policy.timeout(duration, strategy)` -> `timeout(duration, strategy)`
  - `Policy.bulkhead(limit[, quue])` -> `bulkhead(limit[, quue])`
  - `Policy.use()` -> `usePolicy(policy)`

  This resolves [#50](https://github.com/connor4312/cockatiel/issues/50)

- **breaking:** **refactor:** remove confusing Retry builder.

  Previously, this package had a builder interface on `Policy.retry()...`. However, it was confusing how the different options of the builder interacted in more complex cases. For example, both the retry policy itself _and_ the backoff could have different max attempts.

  We simplified it to be a simple options object given in `policy`, where the max attempts is also given. For the backoff itself, you pass the underlying backoff generator (or a custom one)

  Instead of:

  - `Policy.retry().attempts(2).delay(5)`, you can write `retry(policy, { maxAttempts: 2, backoff: new ConstantBackoff(5) })`
  - `Policy.retry().delay([100, 200, 300])`, you can write `retry(policy, { maxAttempts: 3, backoff: new IterableBackoff(100, 200, 300) })`
  - `Policy.retry().exponential(opts)`, you can write `retry(policy, { backoff: new ExponentialBackoff(opts) })`
  - `Policy.retry().delegate(fn)`, you can write `retry(policy, { backoff: new DelegateBackoff(fn) })`

  This is a little more verbose, but should be more clear to readers, and it also tree-shakes better.

  As part of this, the `CompositeBackoff` has been removed. This was mostly an implementation detail of the retry builder internally, and can be better implemented as a custom function in a `DelegateBackoff` by most consumers.

  This resolves [#58](https://github.com/connor4312/cockatiel/issues/58)

- **fix:** TypeScript warnings when using other providers of `AbortSignal`.

## 3.0.0-beta.0

- **breaking:** **refactor:** move to using native `AbortSignal` over `CancellationToken`.

  Previously, this package provided its own implementation of cancellation via the `CancellationTokenSource` and `CancellationToken`. Now, we use the native `AbortSignal` which is available in browsers and Node.js since Node 16. To migrate, instead of...

  - accessing `context.cancellationToken`, access `context.signal` which is an `AbortSignal`,
  - pass in an `AbortSignal` as the second argument to `Policy.execute`, instead of a `CancellationToken`,
  - use `signal.aborted` instead of `signal.isCancellationRequested` to check for cancellation,
  - use `signal.addEventListener("abort", fn)` instead of `signal.onCancellationRequested(fn)` to listen for cancellation,
  - use `new AbortController()` instead of `new CancellationTokenSource()`, and `ctrl.abort()` and `ctrl.signal` instead of `ctrl.cancel()` and `ctrl.token()`,
  - use the helper function `deriveAbortController(signal)` exported from this package instead of `new CancellationTokenSource(parent)`.

## 2.0.2

- **feat:** improve event performance
- **fix:** export `IDisposable`

## 2.0.1

- **fix:** remove incorrect deprecated marker on `RetryPolicy.onGiveUp`
- **fix:** incorrect typings in `retry().backoff()` ([#34](https://github.com/connor4312/cockatiel/issues/34))

## 2.0.0 - 2020-09-24

- **breaking:** **reactor:** introduce a separate BackoffFactory interface for the first backoff

  This _only_ requires changes if you use retry policies in your own code, outside of the `Policy.retry()`.

  See [#30](https://github.com/connor4312/cockatiel/issues/30). For some backoff policies, such as delegate and exponential policies, the first backoff was always 0, before `next()` was called. This is undesirable, and fixing it involved separating the backoff factory from the backoff itself.

  The backoff classes, such as `DelegateBackoff` and `ExponentialBackoff`, now _only_ have a `next()` method. The `duration`, which is now a property instead of a method, is only available after the first `next()` call.

  For example, previously if you did this:

  ```js
  let backoff = new ExponentialBackoff();
  while (!succeeded) {
    if (!tryAgain()) {
      await delay(backoff.duration());
      backoff = backoff.next();
    }
  }
  ```

  You now need to call `next()` before you access `duration`:

  ```js
  let backoff = new ExponentialBackoff();
  while (!succeeded) {
    if (!tryAgain()) {
      backoff = backoff.next();
      await delay(backoff.duration);
    }
  }
  ```

  > Note: if you use typescript, you will need another variable for it to understand you. [Here's an example](https://github.com/connor4312/cockatiel/blob/657be03da7ff6d5fa68da4a0a4172e217882b6bc/src/RetryPolicy.ts#L149-L163) of how we use it inside the RetryPolicy.

## 1.1.1 - 2020-07-17

- **fix:** events on the timeout policy being emitted incorrectly, or not emitted (see [#27](https://github.com/connor4312/cockatiel/issues/27))

## 1.1.0 - 2020-07-08

- **feat:** add an optional `CancellationToken` to `IPolicy.execute`. Add cancellation awareness to all policies; see their specific documentation for more information. (see [#25](https://github.com/connor4312/cockatiel/issues/25))
- **docs:** fix outdated docs on `Policy.circuitBreaker` and unnecessary dashes in jsdoc comments (see [#22](https://github.com/connor4312/cockatiel/issues/22), [#23](https://github.com/connor4312/cockatiel/issues/23), [#24](https://github.com/connor4312/cockatiel/issues/24))

## 1.0.1 - 2020-06-22

- **fix:** cockatiel not working in certain browser builds

## 1.0.0 - 2020-06-16

- **breaking:** Node versions <10 are no longer supported.
- **breaking:** `FallbackPolicy.onFallback` is replaced with `FallbackPolicy.onFailure`. When a failure happens, a fallback will occur.
- **feat**: add `isBrokenCircuitError`, `isBulkheadRejectedError`, `isIsolatedCircuitError`, `isTaskCancelledError` methods to the errors and matching predicate functions.
- **feat**: all policies now include `onFailure` and `onSuccess` callbacks for monitoring purposes (see [#20](https://github.com/connor4312/cockatiel/issues/20))
- **fix**: add `onHalfOpen` event to the circuit breaker (see [#18](https://github.com/connor4312/cockatiel/issues/18))
- **fix**: `retry.exponential()` requiring an argument when it should have been optional (see [#18](https://github.com/connor4312/cockatiel/issues/18))

## 0.1.5 - 2020-03-01

- **feat**: add `.dangerouslyUnref` methods for timeouts and retries ([#11](https://github.com/connor4312/cockatiel/issues/11), thanks to [@novemberborn](https://github.com/novemberborn))

## 0.1.4 - 2020-02-24

- **fix**: `Timeout.Aggressive` triggering timeouts immediately ([#16](https://github.com/connor4312/cockatiel/issues/16), thanks to [@ekillops](https://github.com/ekillops))
- **fix**: correctly compile to ES2018 ([#10](https://github.com/connor4312/cockatiel/issues/10), thanks to [@novemberborn](https://github.com/novemberborn))

## 0.1.3 - 2020-01-26

- **feat**: add new `Policy.use()` decorator

## 0.1.2 - 2019-12-12

- **fix**: wrong typing information for options to `retry.exponential()`

## 0.1.1 - 2019-12-01

- **fix**: jitter backoff not applying max delay correctly
- **fix**: jitter backoff adding more than intended amount of jitter

## 0.1.0 - 2019-11-24

Initial Release
