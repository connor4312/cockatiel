# Changelog

## 0.1.5 - 2019-03-01

- **feat**: add `.dangerouslyUnref` methods for timeouts and retries ([#11](https://github.com/connor4312/cockatiel/issues/11), thanks to [@novemberborn](https://github.com/novemberborn))

## 0.1.4 - 2019-02-24

- **fix**: `Timeout.Aggressive` triggering timeouts immediately ([#16](https://github.com/connor4312/cockatiel/issues/16), thanks to [@ekillops](https://github.com/ekillops))
- **fix**: correctly compile to ES2018 ([#10](https://github.com/connor4312/cockatiel/issues/10), thanks to [@novemberborn](https://github.com/novemberborn))

## 0.1.3 - 2019-01-26

- **feat**: add new `Policy.use()` decorator

## 0.1.2 - 2019-12-12

- **fix**: wrong typing information for options to `retry.exponential()`

## 0.1.1 - 2019-12-01

- **fix**: jitter backoff not applying max delay correctly
- **fix**: jitter backoff adding more than intended amount of jitter

## 0.1.0 - 2019-11-24

Initial Release
