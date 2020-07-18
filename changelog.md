# Changelog

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
