# Changelog

## 0.1.9 - 2020-06-16

- **feat**: add `isBrokenCircuitError`, `isBulkheadRejectedError`, `isIsolatedCircuitError`, `isTaskCancelledError` methods to the errors and matching predicate functions
- **fix**: add `onHalfOpen` event to the circuit breaker
- **fix**: `retry.exponential()` requiring an argument when it should have been optional

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
