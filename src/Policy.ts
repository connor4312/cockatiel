import { ConstantBackoff, IBackoffFactory } from './backoff/Backoff';
import { IBreaker } from './breaker/Breaker';
import { BulkheadPolicy } from './BulkheadPolicy';
import { CircuitBreakerPolicy } from './CircuitBreakerPolicy';
import { Event } from './common/Event';
import { ExecuteWrapper } from './common/Executor';
import { FallbackPolicy } from './FallbackPolicy';
import { NoopPolicy } from './NoopPolicy';
import { IRetryBackoffContext, RetryPolicy } from './RetryPolicy';
import { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy';

type Constructor<T> = new (...args: any) => T;

const typeFilter = <T>(cls: Constructor<T>, predicate?: (error: T) => boolean) =>
  predicate ? (v: unknown) => v instanceof cls && predicate(v) : (v: unknown) => v instanceof cls;

const always = () => true;
const never = () => false;

export interface IBasePolicyOptions {
  errorFilter: (error: Error) => boolean;
  resultFilter: (result: unknown) => boolean;
}

/**
 * The reason for a call failure. Either an error, or the a value that was
 * marked as a failure (when using result filtering).
 */
export type FailureReason<ReturnType> = { error: Error } | { value: ReturnType };

/**
 * Event emitted on the `onFailure` calls.
 */
export interface IFailureEvent {
  /**
   * Call duration, in milliseconds (with nanosecond precision, as the OS allows).
   */
  duration: number;

  /**
   * Whether the error was handled by the policy.
   */
  handled: boolean;

  /**
   * The reason for the error.
   */
  reason: FailureReason<unknown>;
}

/**
 * Event emitted on the `onSuccess` calls.
 */
export interface ISuccessEvent {
  /**
   * Call duration, in milliseconds (with nanosecond precision, as the OS allows).
   */
  duration: number;
}

export interface IDefaultPolicyContext {
  /**
   * Abort signal for the operation. This is propagated through multiple
   * retry policies.
   */
  signal: AbortSignal;
}

/**
 * IPolicy is the type of all policies that Cockatiel provides. It describes
 * an execute() function which takes a generic argument.
 */
export interface IPolicy<
  ContextType extends IDefaultPolicyContext = IDefaultPolicyContext,
  AltReturn = never,
> {
  /**
   * Virtual property only used for TypeScript--will not actually be defined.
   * @deprecated This property does not exist
   */
  readonly _altReturn: AltReturn;

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
    signal?: AbortSignal,
  ): Promise<T | AltReturn>;
}

export interface IMergedPolicy<A extends IDefaultPolicyContext, B, W extends IPolicy<any, any>[]>
  extends IPolicy<A, B> {
  readonly wrapped: W;
}

type MergePolicies<A, B> = A extends IPolicy<infer A1, any>
  ? B extends IPolicy<infer B1, any>
    ? IMergedPolicy<
        A1 & B1,
        A['_altReturn'] | B['_altReturn'],
        B extends IMergedPolicy<any, any, infer W> ? [A, ...W] : [A, B]
      >
    : never
  : never;

export class Policy {
  /**
   * Factory that builds a base set of filters that can be used in circuit
   * breakers, retries, etc.
   */
  constructor(public readonly options: Readonly<IBasePolicyOptions>) {}

  /**
   * Allows the policy to additionally handles errors of the given type.
   *
   * @param cls Class constructor to check that the error is an instance of.
   * @param predicate If provided, a function to be called with the error
   * which should return "true" if we want to handle this error.
   * @example
   * ```js
   * // retry both network errors and response errors with a 503 status code
   * new Policy()
   *  .orType(NetworkError)
   *  .orType(ResponseError, err => err.statusCode === 503)
   *  .retry()
   *  .attempts(3)
   *  .execute(() => getJsonFrom('https://example.com'));
   * ```
   */
  public orType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
    const filter = typeFilter(cls, predicate);
    return new Policy({
      ...this.options,
      errorFilter: e => this.options.errorFilter(e) || filter(e),
    });
  }

  /**
   * Allows the policy to additionally handles errors that pass the given
   * predicate function.
   *
   * @param predicate Takes any thrown error, and returns true if it should
   * be retried by this policy.
   * @example
   * ```js
   * // only retry if the error has a "shouldBeRetried" property set
   * new Policy()
   *  .orWhen(err => err.shouldBeRetried === true)
   *  .retry()
   *  .attempts(3)
   *  .execute(() => getJsonFrom('https://example.com'));
   * ```
   */
  public orWhen(predicate: (error: Error) => boolean) {
    return new Policy({
      ...this.options,
      errorFilter: e => this.options.errorFilter(e) || predicate(e),
    });
  }

  /**
   * Adds handling for return values. The predicate will be called with
   * the return value of the executed function,
   *
   * @param predicate Takes the returned value, and returns true if it
   * should be retried by this policy.
   * @example
   * ```js
   * // retry when the response status code is a 5xx
   * new Policy()
   *  .orResultWhen(res => res.statusCode >= 500)
   *  .retry()
   *  .attempts(3)
   *  .execute(() => getJsonFrom('https://example.com'));
   * ```
   */
  public orWhenResult(predicate: (r: unknown) => boolean) {
    return new Policy({
      ...this.options,
      resultFilter: r => this.options.resultFilter(r) || predicate(r),
    });
  }

  /**
   * Adds handling for return values. The predicate will be called with
   * the return value of the executed function,
   *
   * @param predicate Takes the returned value, and returns true if it
   * should be retried by this policy.
   * @example
   * ```js
   * // retry when the response status code is a 5xx
   * new Policy()
   *  .orResultType(res => res.statusCode >= 500)
   *  .retry()
   *  .attempts(3)
   *  .execute(() => getJsonFrom('https://example.com'));
   * ```
   */
  public orResultType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
    const filter = typeFilter(cls, predicate);
    return new Policy({
      ...this.options,
      resultFilter: r => this.options.resultFilter(r) || filter(r),
    });
  }
}

export const noop = new NoopPolicy();

/**
 * A policy that handles all errors.
 */
export const handleAll = new Policy({ errorFilter: always, resultFilter: never });

/**
 * See {@link Policy.orType} for usage.
 */
export function handleType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
  return new Policy({ errorFilter: typeFilter(cls, predicate), resultFilter: never });
}

/**
 * See {@link Policy.orWhen} for usage.
 */
export function handleWhen(predicate: (error: Error) => boolean) {
  return new Policy({ errorFilter: predicate, resultFilter: never });
}
/**
 * See {@link Policy.orResultType} for usage.
 */
export function handleResultType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
  return new Policy({ errorFilter: never, resultFilter: typeFilter(cls, predicate) });
}

/**
 * See {@link Policy.orWhenResult} for usage.
 */
export function handleWhenResult(predicate: (error: unknown) => boolean) {
  return new Policy({ errorFilter: never, resultFilter: predicate });
}

/**
 * Creates a bulkhead--a policy that limits the number of concurrent calls.
 */
export function bulkhead(limit: number, queue: number = 0) {
  return new BulkheadPolicy(limit, queue);
}

/**
 * A decorator that can be used to wrap class methods and apply the given
 * policy to them. It also adds the last argument normally given in
 * {@link Policy.execute} as the last argument in the function call.
 * For example:
 *
 * ```ts
 * import { usePolicy, retry, handleAll } from 'cockatiel';
 *
 * const retry = retry(handleAll, { maxAttempts: 3 });
 *
 * class Database {
 *   @usePolicy(retry)
 *   public getUserInfo(userId, context, cancellationToken) {
 *     console.log('Retry attempt number', context.attempt);
 *     // implementation here
 *   }
 * }
 *
 * const db = new Database();
 * db.getUserInfo(3).then(info => console.log('User 3 info:', info))
 * ```
 *
 * Note that it will force the return type to be a Promise, since that's
 * what policies return.
 */
export function usePolicy(policy: IPolicy<IDefaultPolicyContext, never>) {
  return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => {
    const inner = descriptor.value;
    if (typeof inner !== 'function') {
      throw new Error(`Can only decorate functions with @cockatiel, got ${typeof inner}`);
    }

    descriptor.value = function (this: unknown, ...args: any[]) {
      const signal = args[args.length - 1] instanceof AbortSignal ? args.pop() : undefined;
      return policy.execute(context => inner.apply(this, [...args, context]), signal);
    };
  };
}

/**
 * Creates a timeout policy.
 * @param duration - How long to wait before timing out execute()'d functions
 * @param strategy - Strategy for timeouts, "Cooperative" or "Aggressive".
 * A {@link CancellationToken} will be pass to any executed function, and in
 * cooperative timeouts we'll simply wait for that function to return or
 * throw. In aggressive timeouts, we'll immediately throw a
 * {@link TaskCancelledError} when the timeout is reached, in addition to
 * marking the passed token as failed.
 */
export function timeout(duration: number, strategy: TimeoutStrategy) {
  return new TimeoutPolicy(duration, strategy);
}

/**
 * Wraps the given set of policies into a single policy. For instance, this:
 *
 * ```js
 * retry.execute(() =>
 *  breaker.execute(() =>
 *    timeout.execute(({ cancellationToken }) => getData(cancellationToken))))
 * ```
 *
 * Is the equivalent to:
 *
 * ```js
 * Policy
 *  .wrap(retry, breaker, timeout)
 *  .execute(({ cancellationToken }) => getData(cancellationToken)));
 * ```
 *
 * The `context` argument passed to the executed function is the merged object
 * of all previous policies.
 *
 */
// The types here a certain unattrative. Ideally we could do
// `wrap<A, B>(p: IPolicy<A, B>): IPolicy<A, B>`, but TS doesn't narrow the
// types well in that scenario (unless p is explicitly typed as an IPolicy
// and not some implementation) and returns `IPolicy<void, unknown>` and
// the like. This is the best solution I've found for it.
export function wrap<A extends IPolicy<IDefaultPolicyContext, unknown>>(p1: A): A;
export function wrap<
  A extends IPolicy<IDefaultPolicyContext, unknown>,
  B extends IPolicy<IDefaultPolicyContext, unknown>,
>(p1: A, p2: B): MergePolicies<A, B>;
export function wrap<
  A extends IPolicy<IDefaultPolicyContext, unknown>,
  B extends IPolicy<IDefaultPolicyContext, unknown>,
  C extends IPolicy<IDefaultPolicyContext, unknown>,
>(p1: A, p2: B, p3: C): MergePolicies<C, MergePolicies<A, B>>;
export function wrap<
  A extends IPolicy<IDefaultPolicyContext, unknown>,
  B extends IPolicy<IDefaultPolicyContext, unknown>,
  C extends IPolicy<IDefaultPolicyContext, unknown>,
  D extends IPolicy<IDefaultPolicyContext, unknown>,
>(p1: A, p2: B, p3: C, p4: D): MergePolicies<D, MergePolicies<C, MergePolicies<A, B>>>;
export function wrap<
  A extends IPolicy<IDefaultPolicyContext, unknown>,
  B extends IPolicy<IDefaultPolicyContext, unknown>,
  C extends IPolicy<IDefaultPolicyContext, unknown>,
  D extends IPolicy<IDefaultPolicyContext, unknown>,
  E extends IPolicy<IDefaultPolicyContext, unknown>,
>(
  p1: A,
  p2: B,
  p3: C,
  p4: D,
  p5: E,
): MergePolicies<E, MergePolicies<D, MergePolicies<C, MergePolicies<A, B>>>>;
export function wrap<C extends IDefaultPolicyContext, A>(...p: Array<IPolicy<C, A>>): IPolicy<C, A>;
export function wrap<C extends IDefaultPolicyContext, A>(
  ...p: Array<IPolicy<C, A>>
): IMergedPolicy<C, A, IPolicy<C, A>[]> {
  return {
    _altReturn: undefined as any,
    onFailure: p[0].onFailure,
    onSuccess: p[0].onSuccess,
    wrapped: p,
    execute<T>(fn: (context: C) => PromiseLike<T> | T, signal: AbortSignal): Promise<T | A> {
      const run = (context: C, i: number): PromiseLike<T | A> | T | A =>
        i === p.length
          ? fn(context)
          : p[i].execute(next => run({ ...context, ...next }, i + 1), context.signal);
      return Promise.resolve(run({ signal } as C, 0));
    },
  };
}

/**
 * Creates a retry policy. The options should contain the backoff strategy to
 * use. Included strategies are:
 *  - {@link ConstantBackoff}
 *  - {@link ExponentialBackoff}
 *  - {@link IterableBackoff}
 *  - {@link DelegateBackoff} (advanced)
 *
 * For example:
 *
 * ```
 * import { handleAll, retry } from 'cockatiel';
 *
 * const policy = retry(handleAll, { backoff: new ExponentialBackoff() });
 * ```
 *
 * You can optionally pass in the `attempts` to limit the maximum number of
 * retry attempts per call.
 */
export function retry(
  policy: Policy,
  opts: {
    maxAttempts?: number;
    backoff?: IBackoffFactory<IRetryBackoffContext<unknown>>;
  },
) {
  return new RetryPolicy(
    { backoff: opts.backoff || new ConstantBackoff(0), maxAttempts: opts.maxAttempts ?? Infinity },
    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter),
  );
}

/**
 * Returns a circuit breaker for the policy. **Important**: you should share
 * your circuit breaker between executions of whatever function you're
 * wrapping for it to function!
 *
 * ```ts
 * import { SamplingBreaker, Policy } from 'cockatiel';
 *
 * // Break if more than 20% of requests fail in a 30 second time window:
 * const breaker = Policy
 *  .handleAll()
 *  .circuitBreaker(10_000, new SamplingBreaker(0.2, 30 * 1000));
 *
 * export function handleRequest() {
 *   return breaker.execute(() => getInfoFromDatabase());
 * }
 * ```
 *
 * @param halfOpenAfter Time after failures to try to open the circuit
 * breaker again.
 * @param breaker The circuit breaker to use. This package exports
 * ConsecutiveBreaker and SamplingBreakers for you to use.
 */
export function circuitBreaker(policy: Policy, opts: { halfOpenAfter: number; breaker: IBreaker }) {
  return new CircuitBreakerPolicy(
    opts,
    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter),
  );
}

/**
 * Falls back to the given value in the event of an error.
 *
 * ```ts
 * import { Policy } from 'cockatiel';
 *
 * const fallback = Policy
 *  .handleType(DatabaseError)
 *  .fallback(() => getStaleData());
 *
 * export function handleRequest() {
 *   return fallback.execute(() => getInfoFromDatabase());
 * }
 * ```
 *
 * @param toValue Value to fall back to, or a function that creates the
 * value to return (any may return a promise)
 */
export function fallback<R>(policy: Policy, valueOrFactory: (() => Promise<R> | R) | R) {
  return new FallbackPolicy(
    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter),
    // not technically type-safe, since if they actually want to _return_
    // a function, that gets lost here. We'll just advice in the docs to
    // use a higher-order function if necessary.
    (typeof valueOrFactory === 'function' ? valueOrFactory : () => valueOrFactory) as () => R,
  );
}
