# Cockatiel

Cockatiel is resilience and transient-fault-handling library that allows developers to express policies such as Retry, Circuit Breaker, Timeout, Bulkhead Isolation, and Fallback in a fluent and thread-safe manner. .NET has [Polly](https://github.com/App-vNext/Polly), a wonderful one-stop shop for all your fault handling needs--I missed having such a library for my JavaScript projects, and grew tired of copy-pasting retry logic between my projects. Hence, this module!

```
npm install --save cockatiel
```

## Contents

Cockatiel is a work-in progress; this serves as a table of contents and progress checklist!

- [x] Base [Policy](#policy)
- [x] [Backoffs](#backoffs)
  - [ConstantBackoff](#constantConstantBackoffbackoff)
  - [ExponentialBackoff](#ExponentialBackoff)
  - [IterableBackoff](#IterableBackoff)
  - [DelegateBackoff](#DelegateBackoff)
  - [CompositeBackoff](#CompositeBackoff)
- [x] [Retries](#retries)

## Policy

The Policy defines how errors and results are handled. Everything in Cockatiel ultimately deals with handling errors or bad results. The Policy sets up how

### `Policy.handleAll()`

Tells the policy to handle _all_ errors.

```ts
Policy
  .handleAll()
  // ...
```

### `Policy.handleType(ctor[, filter])`
### `policy.orType(ctor[, filter])`

Tells the policy to handle errors of the given type, passing in the contructor. If a `filter` function is also passed, we'll only handle errors if that also returns true.

```ts
Policy
  .handleType(NetworkError)
  .orType(HttpError, err => err.statusCode === 503)
  // ...
```

### `Policy.handleWhen(filter)`
### `policy.orWhen(filter)`

Tells the policy to handle any error for which the filter returns truthy

```ts
Policy
  .handleWhen(err => err instanceof NetworkError)
  .orWhen(err => err.shouldRetry === true)
  // ...
```

### `Policy.handleResultType(ctor[, filter])`
### `policy.orResultType(ctor[, filter])`

Tells the policy to treat certain return values of the function as errors--retrying if they appear, for instance. Results will be retried if they're an instance of the given class. If a `filter` function is also passed, we'll only treat return values as errors if that also returns true.

```ts
Policy
  .handleResultType(ReturnedNetworkError)
  .orResultType(HttpResult, res => res.statusCode === 503)
  // ...
```

### `Policy.handleResultWhen(filter])`
### `policy.orWhenResult(filter])`

Tells the policy to treat certain return values of the function as errors--retrying if they appear, for instance. Results will be retried the filter function returns true.

```ts
Policy
  .handleResultWhen(res => res.statusCode === 503)
  .orWhenResult(res => res.statusCode === 429)
  // ...
```

## Backoffs

Backoff algorithms are immutable. They adhere to the interface:

```ts
export interface IBackoff<T> {
  /**
   * Returns the number of milliseconds to wait for this backoff attempt.
   */
  duration(): number;

  /**
   * Returns the next backoff duration. Can return "undefined" to signal
   * that we should stop backing off.
   */
  next(context: T): IBackoff<T> | undefined;
}
```

### ConstantBackoff

A backoff that backs off for a constant amount of time, and can optionally stop after a certain number of attempts.

```ts
// Waits 50ms between back offs, forever
const foreverBackoff = new ConstantBackoff(50);

// Waits 50ms and stops backing off after three attempts.
const limitedBackoff = new ConstantBackoff(50, 3);
```

### ExponentialBackoff

> Tip: exponential backoffs and circuit breakers are great friends!

The crowd favorite. Takes in an options object, which can have any of these properties:

```ts
export interface IExponentialBackoffOptions<S> {
  /**
   * Delay generator function to use. This package provides several of these/
   * Defaults to "decorrelatedJitterGenerator", a good default for most
   * scenarios (see the linked Polly issue).
   *
   * @see https://github.com/App-vNext/Polly/issues/530
   * @see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
   */
  generator: GeneratorFn<S>;

  /**
   * Maximum delay, in milliseconds. Defaults to 30s.
   */
  maxDelay: number;

  /**
   * Maximum retry attempts. Defaults to Infinity.
   */
  maxAttempts: number;

  /**
   * Backoff exponent. Defaults to 2.
   */
  exponent: number;

  /**
   * The initial, first delay of the backoff, in milliseconds.
   * Defaults to 128ms.
   */
  initialDelay: number;
}
```

Example:

```ts
// Use all the defaults:
const defaultBackoff = new ExponentialBackoff();

// Have some lower limits:
const limitedBackoff = new ExponentialBackoff({ maxDelay: 1000, initialDelay: 4 );
```

### IterableBackoff

Takes in a list of delays, and goes through them one by one. When it reaches the end of the list, the backoff will stop.

```ts
// Wait 100ms, 200ms, and then 500ms between attempts before giving up:
const backoff new IterableBackoff([100, 200, 500]);
```

### DelegateBackoff

Delegates determining the backoff to the given function. The function can return a number of milliseconds to wait, or `undefined` to stop the backoff.

```ts
// Try with a 500ms delay asa long as `shouldGiveUp` is false.
const backoff = new DelegateBackoff(context => shouldGiveUp ? undefined : 500);
```

The first parameter is the generic `context` in which the backoff is being used. For retries, the context is an interface like this:

```ts
export interface IRetryBackoffContext<ReturnType> {
  /**
   * The retry attempt, starting at 1 for calls into backoffs.
   */
  attempt: number;
  /**
   * The result of the last method call. Either a thrown error, or a value
   * that we determined should be retried upon.
   */
  result: { error: Error } | { value: ReturnType };
}

```

You can also take in a `state` as the second parameter, and return an object containing the `{ state: S, delay: number }`. Here's both of those in action that we use to create a backoff policy that will stop backing off if we get the same error twice in a row, otherwise do an exponential backoff:

```ts
const myDelegateBackoff = new DelegateBackoff((context, lastError) => {
  if (context.result.error && context.result.error === lastError) {
    return undefined; // will cause the error to be thrown
  }

  return 100 * Math.pow(2, context.count);
});

```

### CompositeBackoff

A composite backoff merges two different backoffs. It will continue as long as both child backoffs also continue, and can be configured to use the delay from the first child (`a`) or second child (`b`), or the maximum (`max`) or minimum (`min`) values.

Here, we'll use the delegate backoff we created above for the delay (the "A" child), and add a constant backoff which ends after 5 attempts.

```ts
const backoff = new CompositeBackoff(
  'a',
  myDelegateBackoff,
  new ConstantBackoff(/* delay */ 0, /* attempts */ 5),
);
```

## Retries

If you know how to use Polly, you already almost know how to use Cockatiel. The `Policy` object is the base builder, and you can get a RetryBuilder off of that by calling `.retry()`.

Here are some example:

```ts
const response1 = await Policy
  .handleAll() // handle all errors
  .retry() // get a RetryBuilder
  .attempts(3) // retry three times, with no delay
  .execute(() => getJson('https://example.com'));

const response1 = await Policy
  .handleType(NetworkError) // only catch network errors
  .retry()
  .execute(() => getJson('https://example.com'));
```

### `execute(fn)`

Executes the function. The current retry context, containing the current `{ attempt: number }`. The function should throw, return a promise, or return a value, which get handled as configured in the Policy.

If the function doesn't succeed before the backoff ceases, the last error thrown will be bubbled up, or the last result will be returned (if you used any of the `Policy.handleResult*` methods).

```ts
await Policy
  .handleAll()
  .retry()
  .execute(() => getJson('https://example.com'));
```

### `attempts(count)`

Sets the maximum number of retry attempts.

```ts
Policy
  .handleAll()
  .retry()
  .attempts(3)
  // ...
```

### `delay(amount)`

Sets the delay between retries. You can pass a single number, or a list of retry delays.

```ts
// retry 5 times, with 100ms between them
Policy
  .handleAll()
  .retry()
  .attempts(5)
  .delay(100)
  // ...

// retry 3 times, increasing delays between them
Policy
  .handleAll()
  .retry()
  .delay([100, 200, 300])
  // ...
```

### `delegate(fn)`

Creates a delegate backoff. See [DelegateBackoff](#DelegateBackoff) for more details here.

```ts
Policy
  .handleAll()
  .retry()
  .delegate(context => 100 * Math.pow(2, context.attempt))
  // ...
```

### `backoff(fn)`

Uses a custom backoff strategy for retries.

```ts
Policy
  .handleAll()
  .retry()
  .backoff(myBackoff)
  // ...
```
