# Cockatiel

[![Actions Status](https://github.com/connor4312/cockatiel/workflows/Run%20Tests/badge.svg)](https://github.com/connor4312/cockatiel/actions)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/cockatiel)](https://bundlephobia.com/result?p=cockatiel@0.1.0)
![No dependencies](https://img.shields.io/badge/dependencies-none-success)

Cockatiel is resilience and transient-fault-handling library that allows developers to express policies such as Retry, Circuit Breaker, Timeout, Bulkhead Isolation, and Fallback. .NET has [Polly](https://github.com/App-vNext/Polly), a wonderful one-stop shop for all your fault handling needs--I missed having such a library for my JavaScript projects, and grew tired of copy-pasting retry logic between my projects. Hence, this module!

    npm install --save cockatiel

Then go forth with confidence:

```js
// alternatively: const { Policy, ConsecutiveBreaker } = require('cockatiel');
import { Policy, ConsecutiveBreaker } from 'cockatiel';
import { database } from './my-db';

// Create a retry policy that'll try whatever function we execute 3
// times with a randomized exponential backoff.
const retry = Policy.handleAll().retry().attempts(3).exponential();

// Create a circuit breaker that'll stop calling the executed function for 10
// seconds if it fails 5 times in a row. This can give time for e.g. a database
// to recover without getting tons of traffic.
const circuitBreaker = Policy.handleAll().circuitBreaker(10 * 1000, new ConsecutiveBreaker(5));

// Combine these! Create a policy that retries 3 times, calling through the circuit breaker
const retryWithBreaker = Policy.wrap(retry, circuitBreaker);

exports.handleRequest = async (req, res) => {
  // Call your database safely!
  const data = await retryWithBreaker.execute(() => database.getInfo(req.params.id));
  return res.json(data);
};
```

I recommend reading the [Polly wiki](https://github.com/App-vNext/Polly/wiki) for more information for details and mechanics around the patterns we provide.

## Table of Contents

- [`IPolicy` (the shape of a policy)](#ipolicy-the-shape-of-a-policy)
- [`Policy`](#policy)
  - [`Policy.handleAll()`](#policyhandleall)
  - [`Policy.handleType(ctor[, filter])`](#policyhandletypector-filter)
  - [`policy.orType(ctor[, filter])`](#policyortypector-filter)
  - [`Policy.handleWhen(filter)`](#policyhandlewhenfilter)
  - [`policy.orWhen(filter)`](#policyorwhenfilter)
  - [`Policy.handleResultType(ctor[, filter])`](#policyhandleresulttypector-filter)
  - [`policy.orResultType(ctor[, filter])`](#policyorresulttypector-filter)
  - [`Policy.handleWhenResult(filter)`](#policyhandlewhenresultfilter)
  - [`policy.orWhenResult(filter)`](#policyorwhenresultfilter)
  - [`Policy.wrap(...policies)`](#policywrappolicies)
  - [`Policy.use(policy)`](#policyusepolicy)
  - [`Policy.noop`](#policynoop)
- [Backoffs](#backoffs)
  - [ConstantBackoff](#constantbackoff)
  - [ExponentialBackoff](#exponentialbackoff)
  - [IterableBackoff](#iterablebackoff)
  - [DelegateBackoff](#delegatebackoff)
  - [CompositeBackoff](#compositebackoff)
- [`CancellationToken`](#cancellationtoken)
  - [`new CancellationTokenSource([parent])`](#new-cancellationtokensourceparent)
  - [`cancellationTokenSource.token`](#cancellationtokensourcetoken)
  - [`cancellationTokenSource.cancel()`](#cancellationtokensourcecancel)
  - [`cancellationToken.isCancellationRequested`](#cancellationtokeniscancellationrequested)
  - [`cancellationToken.onCancellationRequested(callback)`](#cancellationtokenoncancellationrequestedcallback)
  - [`cancellationToken.cancelled([cancellationToken])`](#cancellationtokencancelledcancellationtoken)
- [Events](#events)
  - [`Event.toPromise(event[, cancellationToken])`](#eventtopromiseevent-cancellationtoken)
  - [`Event.once(event, callback)`](#eventonceevent-callback)
- [`Policy.retry()`](#policyretry)
  - [`retry.execute(fn[, cancellationToken])`](#retryexecutefn-cancellationtoken)
  - [`retry.attempts(count)`](#retryattemptscount)
  - [`retry.delay(amount)`](#retrydelayamount)
  - [`retry.exponential(options)`](#retryexponentialoptions)
  - [`retry.delegate(fn)`](#retrydelegatefn)
  - [`retry.backoff(policy)`](#retrybackoffpolicy)
  - [`retry.dangerouslyUnref()`](#retrydangerouslyunref)
  - [`retry.onRetry(callback)`](#retryonretrycallback)
  - [`retry.onSuccess(callback)`](#retryonsuccesscallback)
  - [`retry.onFailure(callback)`](#retryonfailurecallback)
  - [`retry.onGiveUp(callback)`](#retryongiveupcallback)
- [`Policy.circuitBreaker(openAfter, breaker)`](#policycircuitbreakeropenafter-breaker)
  - [`ConsecutiveBreaker`](#consecutivebreaker)
  - [`SamplingBreaker`](#samplingbreaker)
  - [`breaker.execute(fn[, cancellationToken])`](#breakerexecutefn-cancellationtoken)
  - [`breaker.state`](#breakerstate)
  - [`breaker.onBreak(callback)`](#breakeronbreakcallback)
  - [`breaker.onReset(callback)`](#breakeronresetcallback)
  - [`breaker.onHalfOpen(callback)`](#breakeronhalfopencallback)
  - [`breaker.onStateChange(callback)`](#breakeronstatechangecallback)
  - [`breaker.onSuccess(callback)`](#breakeronsuccesscallback)
  - [`breaker.onFailure(callback)`](#breakeronfailurecallback)
  - [`breaker.isolate()`](#breakerisolate)
- [`Policy.timeout(duration, strategy)`](#policytimeoutduration-strategy)
  - [`timeout.dangerouslyUnref()`](#timeoutdangerouslyunref)
  - [`timeout.execute(fn[, cancellationToken])`](#timeoutexecutefn-cancellationtoken)
  - [`timeout.onTimeout(callback)`](#timeoutontimeoutcallback)
  - [`timeout.onSuccess(callback)`](#timeoutonsuccesscallback)
  - [`timeout.onFailure(callback)`](#timeoutonfailurecallback)
- [`Policy.bulkhead(limit[, queue])`](#policybulkheadlimit-queue)
  - [`bulkhead.execute(fn[, cancellationToken])`](#bulkheadexecutefn-cancellationtoken)
  - [`bulkhead.onReject(callback)`](#bulkheadonrejectcallback)
  - [`bulkhead.onSuccess(callback)`](#bulkheadonsuccesscallback)
  - [`bulkhead.onFailure(callback)`](#bulkheadonfailurecallback)
  - [`bulkhead.executionSlots`](#bulkheadexecutionslots)
  - [`bulkhead.queueSlots`](#bulkheadqueueslots)
- [`Policy.fallback(valueOrFactory)`](#policyfallbackvalueorfactory)
  - [`fallback.execute(fn[, cancellationToken])`](#fallbackexecutefn-cancellationtoken)
  - [`fallback.onSuccess(callback)`](#fallbackonsuccesscallback)
  - [`fallback.onFailure(callback)`](#fallbackonfailurecallback)

## `IPolicy` (the shape of a policy)

All Cockatiel fault handling policies (fallbacks, circuit breakers, bulkheads, timeouts, retries) adhere to the same interface. In TypeScript, this is given as:

```ts
export interface IPolicy<ContextType extends { cancellationToken: CancellationToken }> {
  /**
   * Fires on the policy when a request successfully completes and some
   * successful value will be returned. In a retry policy, this is fired once
   * even if the request took multiple retries to succeed.
   */
  readonly onSuccess: Event<ISuccessEvent>;

  /**
   * Fires on the policy when a request fails *due to a handled reason* fails
   * and will give rejection to the called.
   */
  readonly onFailure: Event<IFailureEvent>;

  /**
   * Runs the function through behavior specified by the policy.
   */
  execute<T>(
    fn: (context: ContextType) => PromiseLike<T> | T,
    cancellationToken?: CancellationToken,
  ): Promise<T>;
}
```

If you don't read TypeScript often, here's what it means:

- There are two [events](#events), `onSuccess`/`onFailure`, that are called when a call succeeds or fails. Note that `onFailure` _only_ is called if a handled error is thrown.

  As a design decision, Cockatiel won't assume all thrown errors are actually failures unless you tell us. For example, in your application you might have errors thrown if the user submits invalid input, and triggering fault handling behavior for this reason would not be desirable!

- There's an `execute` function that you can use to "wrap" your own function. Anything you return from that function is returned, in a promise, from `execute`. You can optionally pass a cancellation token to the `execute()` function, and the function will always be called with an object _at least_ containing a cancellation token (some policies might add extra metadata for you).

## `Policy`

The Policy defines how errors and results are handled. Everything in Cockatiel ultimately deals with handling errors or bad results. The Policy sets up how

### `Policy.handleAll()`

Tells the policy to handle _all_ errors.

```ts
Policy.handleAll();
// ...
```

### `Policy.handleType(ctor[, filter])`

### `policy.orType(ctor[, filter])`

Tells the policy to handle errors of the given type, passing in the contructor. If a `filter` function is also passed, we'll only handle errors if that also returns true.

```ts
Policy.handleType(NetworkError).orType(HttpError, err => err.statusCode === 503);
// ...
```

### `Policy.handleWhen(filter)`

### `policy.orWhen(filter)`

Tells the policy to handle any error for which the filter returns truthy

```ts
Policy.handleWhen(err => err instanceof NetworkError).orWhen(err => err.shouldRetry === true);
// ...
```

### `Policy.handleResultType(ctor[, filter])`

### `policy.orResultType(ctor[, filter])`

Tells the policy to treat certain return values of the function as errors--retrying if they appear, for instance. Results will be retried if they're an instance of the given class. If a `filter` function is also passed, we'll only treat return values as errors if that also returns true.

```ts
Policy.handleResultType(ReturnedNetworkError).orResultType(
  HttpResult,
  res => res.statusCode === 503,
);
// ...
```

### `Policy.handleWhenResult(filter)`

### `policy.orWhenResult(filter)`

Tells the policy to treat certain return values of the function as errors--retrying if they appear, for instance. Results will be retried the filter function returns true.

```ts
Policy.handleWhenResult(res => res.statusCode === 503).orWhenResult(res => res.statusCode === 429);
// ...
```

### `Policy.wrap(...policies)`

Wraps the given set of policies into a single policy. For instance, this:

```js
const result = await retry.execute(() =>
  breaker.execute(() => timeout.execute(({ cancellationToken }) => getData(cancellationToken))),
);
```

Is the equivalent to:

```js
const result = await Policy
  .wrap(retry, breaker, timeout)
  .execute(({ cancellationToken }) => getData(cancellationToken)));
```

The `context` argument passed to the executed function is the merged object of all previous policies. So for instance, in the above example you'll get the cancellation token from the [TimeoutPolicy](#policytimeoutduration-strategy) as well as the attempt number from the [RetryPolicy](#policyretry):

```ts
Policy.wrap(retry, breaker, timeout).execute(context => {
  console.log(context);
  // => { attempts: 1, cancellation: }
});
```

### `Policy.use(policy)`

A decorator that can be used to wrap class methods and apply the given policy to them. It also adds the last argument normally given in `Policy.execute` as the last argument in the function call. For example:

```ts
import { Policy } from 'cockatiel';

const retry = Policy.handleAll().retry().attempts(3);

class Database {
  @Policy.use(retry)
  public getUserInfo(userId, context) {
    console.log('Retry attempt number', context.attempt);
    // implementation here
  }
}

const db = new Database();
db.getUserInfo(3).then(info => console.log('User 3 info:', info));
```

Note that it will force the return type to be a Promise, since that's what policies return.

### `Policy.noop`

A no-op policy, which may be useful for tests and stubs.

```ts
import { Policy } from 'cockatiel';

const policy = isProduction ? Policy.handleAll().retry().attempts(3) : Policy.noop;

export async function handleRequest() {
  return policy.execute(() => getInfoFromDatabase());
}
```

## Backoffs

Backoff algorithms are immutable. The backoff class adheres to the interface:

```ts
export interface IBackoffFactory<T> {
  /**
   * Returns the next backoff duration. Can return "undefined" to signal
   * that we should stop backing off.
   */
  next(context: T): IBackoff<T> | undefined;
}
```

The backoff, returned from the `next()` call, has the appropriate delay and `next()` method again.

```ts
export interface IBackoff<T> {
  next(context: T): IBackoff<T> | undefined; // same as above

  /**
   * Returns the number of milliseconds to wait for this backoff attempt.
   */
  readonly duration: number;
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

> Tip: exponential backoffs and [circuit breakers](#policycircuitbreakeropenafter-breaker) are great friends!

The crowd favorite. By default, it uses a decorrelated jitter algorithm, which is a good default for most applications. Takes in an options object, which can have any of these properties:

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
import { ExponentialBackoff, noJitterGenerator } from 'cockatiel';

// Use all the defaults. Decorrelated jitter, 30 seconds max delay, infinite attempts:
const defaultBackoff = new ExponentialBackoff();

// Have some lower limits:
const limitedBackoff = new ExponentialBackoff({ maxDelay: 1000, initialDelay: 4 });

// Use a backoff without jitter
const limitedBackoff = new ExponentialBackoff({ generator: noJitterGenerator });
```

Several jitter strategies are provided. This [AWS blog post](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) has more information around the strategies and why you might want to use them. The available jitter generators exported from `cockatiel` are:

- `decorrelatedJitterGenerator` -- The default implementation, the one that [Polly.Contrib.WaitAndRetry uses](https://github.com/Polly-Contrib/Polly.Contrib.WaitAndRetry/tree/79224cff9670b159418f955af4d0a9ebc2a09778#new-jitter-recommendation)
- `noJitterGenerator` -- Does not add any jitter
- `fullJitterGenerator` -- Jitters between `[0, interval)`
- `halfJitterGenerator` -- Jitters between `[interval / 2, interval)`

### IterableBackoff

Takes in a list of delays, and goes through them one by one. When it reaches the end of the list, the backoff will stop.

```ts
// Wait 100ms, 200ms, and then 500ms between attempts before giving up:
const backoff = new IterableBackoff([100, 200, 500]);
```

### DelegateBackoff

Delegates determining the backoff to the given function. The function can return a number of milliseconds to wait, or `undefined` to stop the backoff.

```ts
// Try with a 500ms delay asa long as `shouldGiveUp` is false.
const backoff = new DelegateBackoff(context => (shouldGiveUp ? undefined : 500));
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

  return { delay: 100 * Math.pow(2, context.count), state: context.result.error };
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

## `CancellationToken`

Cancellation tokens are prominent in C# land to allow for cooperative cancellation. They're used here for [timeouts](#policytimeoutduration-strategy).

The `CancellationTokenSource` is the 'factory' that creates `CancellationTokens`, and can be used to cancel and operation. Once cancellation is requested, an event will be emitted on all linked tokens. You can nest cancellation tokens and sources, cancellation cascades down.

```ts
import { CancellationTokenSource } from 'cockatiel';

const source1 = new CancellationTokenSource();
const token1 = source1.token;

// You can listen to an event, await a promise, or just check a synchronous value...
token1.onCancellationRequested(() => console.log('source1 cancelled'));
token1.cancellation().then(() => {
  /* ... */
});

if (token1.isCancellationRequested) {
  console.log('source1 already cancelled!');
}

// You can the nest new cancellation token sources:
const source2 = new CancellationTokenSource(token1);
source2.onCancellationRequested(() => console.log('source2 cancelled'));

// And, finally, cancel tokens, which will cascade down to all children:
source1.cancel();
// => source1 cancelled
// => source2 cancelled
```

### `new CancellationTokenSource([parent])`

Creates a new CancellationTokenSource, optionally linked to the parent token.

```ts
const source1 = new CancellationTokenSource();
const source2 = new CancellationTokenSource(token1);
```

### `cancellationTokenSource.token`

Returns the [CancellationToken](#cancellationtokeniscancellationrequested)

### `cancellationTokenSource.cancel()`

Cancells all tokens linked to the source, and all child sources.

```ts
source.token.onCancellationRequested(() => console.log('source cancelled');
source.cancel();
// => source cancelled
```

### `cancellationToken.isCancellationRequested`

Returns whether cancellation has yet been requested.

```ts
if (token.isCancellationRequested) {
  console.log('source1 already cancelled!');
}
```

### `cancellationToken.onCancellationRequested(callback)`

An [event emitter](#events) that fires when a cancellation is requested. Fires immediately if cancellation has already been requested. Returns a disposable instance.

```ts
const listener = token.onCancellationRequested(() => console.log('cancellation requested'));

// later:
listener.dispose();
```

### `cancellationToken.cancelled([cancellationToken])`

Returns a promise that resolves once cancellation is requested. You can optionally pass in another cancellation token to this method, to cancel waiting on the event.

```ts
await token.cancelled();
```

## Events

Cockatiel uses a simple bespoke style for events, similar to those that we use in VS Code. These events provide better type-safety (you can never subscribe to the wrong event name) and better functionality around triggering listeners, which we use to implement cancellation tokens.

An event can be subscribed to simply by passing a callback. Take [`onFailure`](#fallbackonfailurecallback) for instance:

```js
const listener = policy.onFailure(error => {
  console.log(error);
});
```

The event returns an `IDisposable` instance. To unsubscribe the listener, call `.dispose()` on the returned instance. It's always safe to call an IDisposable's `.dispose()` multiple times.

```js
listener.dispose();
```

We provide a couple extra utilities around events as well.

### `Event.toPromise(event[, cancellationToken])`

Returns a promise that resolves once the event fires. Optionally, you can pass in a [CancellationToken](#cancellationtoken) to control when you stop listening, which will reject the promise with a `TaskCancelledError` if it's not already resolved.

```js
import { Event } from 'cockatiel';

async function waitForFallback(policy) {
  await Event.toPromise(policy.onFallback);
  console.log('a fallback happened!');
}
```

### `Event.once(event, callback)`

Waits for the event to fire once, and then automatically unregisters the listener. This method itself returns an `IDisposable`, which you could use to unregister the listener if needed.

```js
import { Event } from 'cockatiel';

async function waitForFallback(policy) {
  Event.once(policy.onFallback, () => {
    console.log('a fallback happened!');
  });
}
```

## `Policy.retry()`

If you know how to use Polly, you already almost know how to use Cockatiel. The `Policy` object is the base builder, and you can get a RetryBuilder off of that by calling `.retry()`.

Here are some example:

```ts
const response1 = await Policy.handleAll() // handle all errors
  .retry() // get a RetryBuilder
  .attempts(3) // retry three times, with no delay
  .execute(() => getJson('https://example.com'));

const response1 = await Policy.handleType(NetworkError) // only catch network errors
  .retry()
  .execute(() => getJson('https://example.com'));
```

### `retry.execute(fn[, cancellationToken])`

Executes the function. The current retry context, containing the attempts and cancellation token, `{ attempt: number, cancellationToken: CancellationToken }`, is passed as the function's first argument. The function should throw, return a promise, or return a value, which get handled as configured in the Policy.

If the function doesn't succeed before the backoff ceases or cancellation is requested, the last error thrown will be bubbled up, or the last result will be returned (if you used any of the `Policy.handleResult*` methods).

```ts
await Policy.handleAll()
  .retry()
  .execute(() => getJson('https://example.com'));
```

### `retry.attempts(count)`

Sets the maximum number of retry attempts.

```ts
Policy.handleAll().retry().attempts(3);
// ...
```

### `retry.delay(amount)`

Sets the delay between retries. You can pass a single number, or a list of retry delays.

```ts
// retry 5 times, with 100ms between them
Policy.handleAll().retry().attempts(5).delay(100);
// ...

// retry 3 times, increasing delays between them
Policy.handleAll().retry().delay([100, 200, 300]);
// ...
```

### `retry.exponential(options)`

Uses an exponential backoff for retries. See [ExponentialBackoff](#exponentialbackoff) for more details around the available options.

```ts
Policy
  .handleAll()
  .retry()
  .exponential({ maxDelay: 10 * 1000, maxAttempts: 5 )
  // ...
```

### `retry.delegate(fn)`

Creates a delegate backoff. See [DelegateBackoff](#DelegateBackoff) for more details here.

```ts
Policy.handleAll()
  .retry()
  .delegate(context => 100 * Math.pow(2, context.attempt));
// ...
```

### `retry.backoff(policy)`

Uses a custom backoff strategy for retries.

```ts
Policy.handleAll().retry().backoff(myBackoff);
// ...
```

### `retry.dangerouslyUnref()`

When retrying, a referenced timer is created. This means the Node.js event loop is kept active while we're delaying a retried call. Calling this method on the retry builder will unreference the timer, allowing the process to exit even if a retry might still be pending:

```ts
const response1 = await Policy.handleAll() // handle all errors
  .retry() // get a RetryBuilder
  .dangerouslyUnref() // unreference the timer
  .attempts(3) // retry three times, with no delay
  .execute(() => getJson('https://example.com'));
```

### `retry.onRetry(callback)`

An [event emitter](#events) that fires when we retry a call, before any backoff. It's invoked with an object that includes:

- the `delay` we're going to wait before retrying, and;
- either a thrown error like `{ error: someError, delay: number }`, or an errorful result in an object like `{ value: someValue, delay: number }` when using [result filtering](#policyhandleresulttypector-filter).

Useful for telemetry. Returns a dispable instance.

```js
const listener = retry.onRetry(reason => console.log('retrying a function call:', reason));

// ...
listener.dispose();
```

### `retry.onSuccess(callback)`

An [event emitter](#events) that fires whenever a function is successfully called. It's invoked with an object containing the duration in milliseconds to nanosecond precision.

```js
const listener = retry.onSuccess({ duration }) => {
  console.log(`retry call ran in ${duration}ms`);
});

// later:
listener.dispose();
```

### `retry.onFailure(callback)`

An [event emitter](#events) that fires whenever a function throw an error or returns an errorful result. It's invoked with the duration of the call, the reason for the failure, and an boolean indicating whether the error is handled by the policy.

```js
const listener = retry.onFailure({ duration, handled, reason }) => {
  console.log(`retry call ran in ${duration}ms and failed with`, reason);
  console.log(handled ? 'error was handled' : 'error was not handled');
});

// later:
listener.dispose();
```

### `retry.onGiveUp(callback)`

An [event emitter](#events) that fires when we're no longer retrying a call and are giving up. It's invoked with either a thrown error in an object like `{ error: someError }`, or an errorful result in an object like `{ value: someValue }` when using [result filtering](#policyhandleresulttypector-filter). Useful for telemetry. Returns a dispable instance.

```js
const listener = retry.onGiveUp(reason => console.log('retrying a function call:', reason));

// ...
listener.dispose();
```

## `Policy.circuitBreaker(openAfter, breaker)`

Circuit breakers stop execution for a period of time after a failure threshold has been reached. This is very useful to allow faulting systems to recover without overloading them. See the [Polly docs](https://github.com/App-vNext/Polly/wiki/Circuit-Breaker#how-the-polly-circuitbreaker-works) for more detailed information around circuit breakers.

> It's **important** that you reuse the same circuit breaker across multiple requests, otherwise it won't do anything!

To create a breaker, you use a [Policy](#Policy) like you normally would, and call `.circuitBreaker()`. The first argument is the number of milliseconds after which we should try to close the circuit after failure ('closing the circuit' means restarting requests). The second argument is the breaker policy.

Calls to `execute()` while the circuit is open (not taking requests) will throw a `BrokenCircuitError`.

```js
import { Policy, BrokenCircuitError, ConsecutiveBreaker, SamplingBreaker } from 'cockatiel';

// Break if more than 20% of requests fail in a 30 second time window:
const breaker = Policy.handleAll().circuitBreaker(
  10 * 1000,
  new SamplingBreaker({ threshold: 0.2, duration: 30 * 1000 }),
);

// Break if more than 5 requests in a row fail:
const breaker = Policy.handleAll().circuitBreaker(10 * 1000, new ConsecutiveBreaker(5));

// Get info from the database, or return 'service unavailable' if it's down/recovering
export async function handleRequest() {
  try {
    return await breaker.execute(() => getInfoFromDatabase());
  } catch (e) {
    if (e instanceof BrokenCircuitError) {
      return 'service unavailable';
    } else {
      throw e;
    }
  }
}
```

### `ConsecutiveBreaker`

The `ConsecutiveBreaker` breaks after `n` requests in a row fail. Simple, easy.

```js
// Break if more than 5 requests in a row fail:
const breaker = Policy.handleAll().circuitBreaker(10 * 1000, new ConsecutiveBreaker(5));
```

### `SamplingBreaker`

The `SamplingBreaker` breaks after a proportion of requests over a time period fail.

```js
// Break if more than 20% of requests fail in a 30 second time window:
const breaker = Policy.handleAll().circuitBreaker(
  10 * 1000,
  new SamplingBreaker({ threshold: 0.2, duration: 30 * 1000 }),
);
```

You can specify a minimum requests-per-second value to use to avoid closing the circuit under period of low load. By default we'll choose a value such that you need 5 failures per second for the breaker to kick in, and you can configure this if it doesn't work for you:

```js
const breaker = Policy.handleAll().circuitBreaker(
  10 * 1000,
  new SamplingBreaker({
    threshold: 0.2,
    duration: 30 * 1000,
    minimumRps: 10, // require 10 requests per second before we can break
  }),
);
```

### `breaker.execute(fn[, cancellationToken])`

Executes the function. May throw a `BrokenCircuitError` if the circuit is open. If a half-open test is currently running and it succeeds, the circuit breaker will check the cancellation token (possibly throwing a `TaskCancelledError`) before continuing to run the inner function.

Otherwise, it calls the inner function and returns what it returns, or throws what it throws.

Like all `Policy.execute` methods, any propagated `{ cancellationToken: CancellationToken }` will be given as the first argument to `fn`.

```ts
const response = await breaker.execute(() => getJson('https://example.com'));
```

### `breaker.state`

The current state of the circuit breaker, allowing for introspection.

```js
import { CircuitState } from 'cockatiel';

// ...

if (breaker.state === CircuitState.Open) {
  console.log('the circuit is open right now');
}
```

### `breaker.onBreak(callback)`

An [event emitter](#events) that fires when the circuit opens as a result of failures. Returns a disposable instance.

```js
const listener = breaker.onBreak(() => console.log('circuit is open'));

// later:
listener.dispose();
```

### `breaker.onReset(callback)`

An [event emitter](#events) that fires when the circuit closes after being broken. Returns a disposable instance.

```js
const listener = breaker.onReset(() => console.log('circuit is closed'));

// later:
listener.dispose();
```

### `breaker.onHalfOpen(callback)`

An [event emitter](#events) when the circuit breaker is half open (running a test call). Either `onBreak` on `onReset` will subsequently fire.

```js
const listener = breaker.onHalfOpen(() => console.log('circuit is testing a request'));

// later:
listener.dispose();
```

### `breaker.onStateChange(callback)`

An [event emitter](#events) that fires whenever the circuit state changes in general, after the more specific `onReset`, `onHalfOpen`, `onBreak` emitters fires.

```js
import { CircuitState } from 'cockatiel';

const listener = breaker.onStateChange(state => {
  if (state === CircuitState.Closed) {
    console.log('circuit breaker is once again closed');
  }
});

// later:
listener.dispose();
```

### `breaker.onSuccess(callback)`

An [event emitter](#events) that fires whenever a function is successfully called. It's invoked with an object containing the duration in milliseconds to nanosecond precision.

```js
const listener = breaker.onSuccess({ duration }) => {
  console.log(`circuit breaker call ran in ${duration}ms`);
});

// later:
listener.dispose();
```

### `breaker.onFailure(callback)`

An [event emitter](#events) that fires whenever a function throw an error or returns an errorful result. It's invoked with the duration of the call, the reason for the failure, and an boolean indicating whether the error is handled by the policy.

```js
const listener = breaker.onFailure({ duration, handled, reason }) => {
  console.log(`circuit breaker call ran in ${duration}ms and failed with`, reason);
  console.log(handled ? 'error was handled' : 'error was not handled');
});

// later:
listener.dispose();
```

### `breaker.isolate()`

Manually holds the circuit open, until the returned disposable is disposed of. While held open, the circuit will throw `IsolatedCircuitError`, a type of `BrokenCircuitError`, on attempted executions. It's safe to have multiple `isolate()` calls; we'll refcount them behind the scenes.

```js
const handle = breaker.isolate();

// later, allow calls again:
handle.dispose();
```

## `Policy.timeout(duration, strategy)`

Creates a timeout policy. The duration specifies how long to wait before timing out `execute()`'d functions. The strategy for timeouts, "Cooperative" or "Aggressive". A [ CancellationToken](#cancellationtoken) will be pass to any executed function, and in cooperative timeouts we'll simply wait for that function to return or throw. In aggressive timeouts, we'll immediately throw a TaskCancelledError when the timeout is reached, in addition to marking the passed token as failed.

```js
import { TimeoutStrategy, Policy, TaskCancelledError } from 'cockatiel';

const timeout = Policy.timeout(2000, TimeoutStrategy.Cooperative);

// Get info from the database, or return if it didn't respond in 2 seconds
export async function handleRequest() {
  try {
    return await timeout.execute(cancellationToken => getInfoFromDatabase(cancellationToken));
  } catch (e) {
    if (e instanceof TaskCancelledError) {
      return 'database timed out';
    } else {
      throw e;
    }
  }
}
```

### `timeout.dangerouslyUnref()`

When timing out, a referenced timer is created. This means the Node.js event loop is kept active while we're waiting for the timeout, as long as the function hasn't returned. Calling this method on the timeout builder will unreference the timer, allowing the process to exit even if a timeout might still be happening.

### `timeout.execute(fn[, cancellationToken])`

Executes the given function as configured in the policy. A [CancellationToken](#cancellationtoken) will be pass to the function, which it should use for aborting operations as needed. If cancellation is requested on the parent cancellation token provided as the second argument to `execute()`, the cancellation will be propagated.

```ts
await timeout.execute(({ cancellationToken }) => getInfoFromDatabase(cancellationToken));
```

### `timeout.onTimeout(callback)`

An [event emitter](#events) that fires when a timeout is reached. Useful for telemetry. Returns a disposable instance.

In the "aggressive" timeout strategy, a timeout event will immediately preceed a failure event and promise rejection. In the cooperative timeout strategy, the timeout event is still emitted, _but_ the success or failure is determined by what the executed function throws or returns.

```ts
const listener = timeout.onTimeout(() => console.log('timeout was reached'));

// later:
listener.dispose();
```

### `timeout.onSuccess(callback)`

An [event emitter](#events) that fires whenever a function is successfully called. It's invoked with an object containing the duration in milliseconds to nanosecond precision.

```js
const listener = timeout.onSuccess({ duration }) => {
  console.log(`timeout call ran in ${duration}ms`);
});

// later:
listener.dispose();
```

### `timeout.onFailure(callback)`

An [event emitter](#events) that fires whenever a function throw an error or returns an errorful result. It's invoked with the duration of the call, the reason for the failure, and an boolean indicating whether the error is handled by the policy.

This is _only_ called when the function itself fails, and not when a timeout happens.

```js
const listener = timeout.onFailure({ duration, handled, reason }) => {
  console.log(`timeout call ran in ${duration}ms and failed with`, reason);
  console.log(handled ? 'error was handled' : 'error was not handled');
});

// later:
listener.dispose();
```

## `Policy.bulkhead(limit[, queue])`

A Bulkhead is a simple structure that limits the number of concurrent calls. Attempting to exceed the capacity will cause `execute()` to throw a `BulkheadRejectedError`.

```js
import { Policy } from 'cockatiel';

const bulkhead = Policy.bulkhead(12); // limit to 12 concurrent calls

// Get info from the database, or return if there's too much load
export async function handleRequest() {
  try {
    return await bulkhead.execute(() => getInfoFromDatabase());
  } catch (e) {
    if (e instanceof BulkheadRejectedError) {
      return 'too much load, try again later';
    } else {
      throw e;
    }
  }
}
```

You can optionally pass a second parameter to `bulkhead()`, which will allow for events to be queued instead of rejected after capacity is exceeded. Once again, if this queue fills up, a `BulkheadRejectedError` will be thrown.

```js
const bulkhead = Policy.bulkhead(12, 4); // limit to 12 concurrent calls, with 4 queued up
```

### `bulkhead.execute(fn[, cancellationToken])`

Depending on the bulkhead state, either:

- Executes the function immediately and returns its results;
- Queues the function for execution and returns its results when it runs, or;
- Throws a `BulkheadRejectedError` if the configured concurrency and queue limits have been execeeded.

The cancellation token is checked (possibly resulting in a TaskCancelledError) when the function is first submitted to the bulkhead, and when it dequeues.

Like all `Policy.execute` methods, any propagated `{ cancellationToken: CancellationToken }` will be given as the first argument to `fn`.

```js
const data = await bulkhead.execute(({ cancellationToken }) =>
  getInfoFromDatabase(cancellationToken),
);
```

### `bulkhead.onReject(callback)`

An [event emitter](#events) that fires when a call is rejected. Useful for telemetry. Returns a disposable instance.

```js
const listener = bulkhead.onReject(() => console.log('bulkhead call was rejected'));

// later:
listener.dispose();
```

### `bulkhead.onSuccess(callback)`

An [event emitter](#events) that fires whenever a function is successfully called. It's invoked with an object containing the duration in milliseconds to nanosecond precision.

```js
const listener = bulkhead.onSuccess({ duration }) => {
  console.log(`bulkhead call ran in ${duration}ms`);
});

// later:
listener.dispose();
```

### `bulkhead.onFailure(callback)`

An [event emitter](#events) that fires whenever a function throw an error or returns an errorful result. It's invoked with the duration of the call, the reason for the failure, and an boolean indicating whether the error is handled by the policy.

This is _only_ called when the function itself fails, and not when a bulkhead rejection occurs.

```js
const listener = bulkhead.onFailure({ duration, handled, reason }) => {
  console.log(`bulkhead call ran in ${duration}ms and failed with`, reason);
  console.log(handled ? 'error was handled' : 'error was not handled');
});

// later:
listener.dispose();
```

### `bulkhead.executionSlots`

Returns the number of execution slots left in the bulkhead. If either this or `bulkhead.queueSlots` is greater than zero, the `execute()` will not throw a `BulkheadRejectedError`.

### `bulkhead.queueSlots`

Returns the number of queue slots left in the bulkhead. If either this or `bulkhead.executionSlots` is greater than zero, the `execute()` will not throw a `BulkheadRejectedError`.

## `Policy.fallback(valueOrFactory)`

Creates a policy that returns the `valueOrFactory` if an executed function fails. As the name suggests, `valueOrFactory` either be a value, or a function we'll call when a failure happens to create a value.

```js
import { Policy } from 'cockatiel';

const fallback = Policy.handleType(DatabaseError).fallback(() => getStaleData());

export function handleRequest() {
  return fallback.execute(() => getInfoFromDatabase());
}
```

### `fallback.execute(fn[, cancellationToken])`

Executes the given function. Any _handled_ error or errorful value will be eaten, and instead the fallback value will be returned.

Like all `Policy.execute` methods, any propagated `{ cancellationToken: CancellationToken }` will be given as the first argument to `fn`.

```js
const result = await fallback.execute(() => getInfoFromDatabase());
```

### `fallback.onSuccess(callback)`

An [event emitter](#events) that fires whenever a function is successfully called. It's invoked with an object containing the duration in milliseconds to nanosecond precision.

```js
const listener = fallback.onSuccess({ duration }) => {
  console.log(`fallback call ran in ${duration}ms`);
});

// later:
listener.dispose();
```

### `fallback.onFailure(callback)`

An [event emitter](#events) that fires whenever a function throw an error or returns an errorful result. It's invoked with the duration of the call, the reason for the failure, and an boolean indicating whether the error is handled by the policy.

If the error was handled, the fallback will kick in.

```js
const listener = fallback.onFailure({ duration, handled, reason }) => {
  console.log(`fallback call ran in ${duration}ms and failed with`, reason);
  console.log(handled ? 'error was handled' : 'error was not handled');
});

// later:
listener.dispose();
```
