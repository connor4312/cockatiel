import { IBreaker } from './breaker/Breaker';
import { BulkheadPolicy } from './BulkheadPolicy';
import { CircuitBreakerPolicy } from './CircuitBreakerPolicy';
import { FallbackPolicy } from './FallbackPolicy';
import { IRetryContext, RetryPolicy } from './RetryPolicy';
import { ICancellationContext, TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy';

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
 * IPolicy is the type of all policies that Cockatiel provides. It describes
 * an execute() function which takes a generic argument.
 */
export interface IPolicy<ContextType, AltReturn = never> {
  execute<T>(fn: (context: ContextType) => PromiseLike<T> | T): Promise<T | AltReturn>;
}

type PolicyType<T> = T extends RetryPolicy
  ? IPolicy<IRetryContext, never>
  : T extends TimeoutPolicy
  ? IPolicy<ICancellationContext, never>
  : T extends FallbackPolicy<infer F>
  ? IPolicy<void, F>
  : T extends CircuitBreakerPolicy
  ? IPolicy<void, never>
  : T extends IPolicy<infer ContextType, infer ReturnType>
  ? IPolicy<ContextType, ReturnType>
  : never;

type MergePolicies<A, B> = A extends IPolicy<infer A1, infer A2>
  ? B extends IPolicy<infer B1, infer B2>
    ? IPolicy<A1 & B1, A2 | B2>
    : never
  : never;

/**
 * Factory that builds a base set of filters that can be used in circuit
 * breakers, retries, etc.
 */
export class Policy {
  /**
   * A no-op policy, useful for unit tests and stubs.
   */
  public static readonly noop: IPolicy<any> = { execute: async fn => fn(undefined) };

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
  public static wrap<A extends IPolicy<unknown, unknown>>(p1: A): PolicyType<A>;
  public static wrap<A extends IPolicy<unknown, unknown>, B extends IPolicy<unknown, unknown>>(
    p1: A,
    p2: B,
  ): MergePolicies<PolicyType<A>, PolicyType<B>>;
  public static wrap<
    A extends IPolicy<unknown, unknown>,
    B extends IPolicy<unknown, unknown>,
    C extends IPolicy<unknown, unknown>
  >(p1: A, p2: B, p3: C): MergePolicies<PolicyType<C>, MergePolicies<PolicyType<A>, PolicyType<B>>>;
  public static wrap<
    A extends IPolicy<unknown, unknown>,
    B extends IPolicy<unknown, unknown>,
    C extends IPolicy<unknown, unknown>,
    D extends IPolicy<unknown, unknown>
  >(
    p1: A,
    p2: B,
    p3: C,
    p4: D,
  ): MergePolicies<
    PolicyType<D>,
    MergePolicies<PolicyType<C>, MergePolicies<PolicyType<A>, PolicyType<B>>>
  >;
  public static wrap<
    A extends IPolicy<unknown, unknown>,
    B extends IPolicy<unknown, unknown>,
    C extends IPolicy<unknown, unknown>,
    D extends IPolicy<unknown, unknown>,
    E extends IPolicy<unknown, unknown>
  >(
    p1: A,
    p2: B,
    p3: C,
    p4: D,
    p5: E,
  ): MergePolicies<
    PolicyType<E>,
    MergePolicies<
      PolicyType<D>,
      MergePolicies<PolicyType<C>, MergePolicies<PolicyType<A>, PolicyType<B>>>
    >
  >;
  public static wrap<C, A>(...p: Array<IPolicy<C, A>>): IPolicy<C, A>;
  public static wrap<C, A>(...p: Array<IPolicy<C, A>>): IPolicy<C, A> {
    return {
      execute<T>(fn: (context: C) => PromiseLike<T> | T): Promise<T | A> {
        const run = (context: any, i: number): PromiseLike<T | A> | T | A =>
          i === p.length ? fn(context) : p[i].execute(next => run({ ...context, ...next }, i + 1));
        return Promise.resolve(run({}, 0));
      },
    };
  }

  /**
   * Creates a bulkhead--a policy that limits the number of concurrent calls.
   */
  public static bulkhead(limit: number, queue: number = 0) {
    return new BulkheadPolicy(limit, queue);
  }

  /**
   * Creates a retry policy that handles all errors.
   */
  public static handleAll() {
    return new Policy({ errorFilter: always, resultFilter: never });
  }

  /**
   * See {@link Policy.orType} for usage.
   */
  public static handleType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
    return new Policy({ errorFilter: typeFilter(cls, predicate), resultFilter: never });
  }

  /**
   * See {@link Policy.orWhen} for usage.
   */
  public static handleWhen(predicate: (error: Error) => boolean) {
    return new Policy({ errorFilter: predicate, resultFilter: never });
  }
  /**
   * See {@link Policy.orResultType} for usage.
   */
  public static handleResultType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
    return new Policy({ errorFilter: never, resultFilter: typeFilter(cls, predicate) });
  }

  /**
   * See {@link Policy.orWhenResult} for usage.
   */
  public static handleWhenResult(predicate: (error: unknown) => boolean) {
    return new Policy({ errorFilter: never, resultFilter: predicate });
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
  public static timeout(duration: number, strategy: TimeoutStrategy) {
    return new TimeoutPolicy(duration, strategy);
  }

  protected constructor(private readonly options: Readonly<IBasePolicyOptions>) {}

  /**
   * Allows the policy to additionally handles errors of the given type.
   *
   * @param cls -- Class constructor to check that the error is an instance of.
   * @param predicate -- If provided, a function to be called with the error
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
   * @param predicate -- Takes any thrown error, and returns true if it should
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
   * @param predicate -- Takes the returned value, and returns true if it
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
   * @param predicate -- Takes the returned value, and returns true if it
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

  /**
   * Returns a retry policy builder.
   */
  public retry() {
    return new RetryPolicy({
      errorFilter: this.options.errorFilter,
      resultFilter: this.options.resultFilter,
    });
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
   *  .circuitBreaker(new SamplingBreaker(0.2, 30 * 1000));
   *
   * export function handleRequest() {
   *   return breaker.execute(() => getInfoFromDatabase());
   * }
   * ```
   *
   * @param breaker -- The circuit breaker to use. This package exports
   * ConsecutiveBreaker and SamplingBreakers for you to use.
   * @param halfOpenAfter -- Time after failures to try to open the circuit
   * breaker again. Defaults to 10 seconds.
   */
  public circuitBreaker(halfOpenAfter: number, breaker: IBreaker) {
    return new CircuitBreakerPolicy({
      ...this.options,
      breaker,
      halfOpenAfter,
    });
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
   * @param toValue -- Value to fall back to, or a function that creates the
   * value to return (any may return a promise)
   */
  public fallback<R>(valueOrFactory: (() => Promise<R> | R) | R) {
    return new FallbackPolicy(
      this.options,
      // not technically type-safe, since if they actually want to _return_
      // a function, that gets lost here. We'll just advice in the docs to
      // use a higher-order function if necessary.
      (typeof valueOrFactory === 'function' ? valueOrFactory : () => valueOrFactory) as () => R,
    );
  }
}
