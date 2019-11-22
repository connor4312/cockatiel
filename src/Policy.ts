import { IBreaker } from './breaker/Breaker';
import { BulkheadPolicy } from './BulkheadPolicy';
import { CircuitBreakerPolicy } from './CircuitBreakerPolicy';
import { FallbackPolicy } from './FallbackPolicy';
import { RetryPolicy } from './RetryPolicy';
import { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy';

type Constructor<T> = new (...args: any) => T;

const typeFilter = <T>(cls: Constructor<T>, predicate?: (error: T) => boolean) =>
  predicate ? (v: unknown) => v instanceof cls && predicate(v) : (v: unknown) => v instanceof cls;

const always = () => true;
const never = () => false;

export interface IBasePolicyOptions<ReturnConstraint> {
  errorFilter: (error: Error) => boolean;
  resultFilter: (result: ReturnConstraint) => boolean;
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
export interface IPolicy<ContextType, ReturnConstraint = unknown, AltReturn = never> {
  execute<T extends ReturnConstraint>(
    fn: (context: ContextType) => PromiseLike<T> | T,
  ): Promise<T | AltReturn>;
}

/**
 * Factory that builds a base set of filters that can be used in circuit
 * breakers, retries, etc.
 */
export class Policy<ReturnConstraint> {
  /**
   * A no-op policy, useful for unit tests and stubs.
   */
  public static readonly noop: IPolicy<void> = { execute: async fn => fn(undefined) };

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
   * @todo I think there may be a TS bug here preventing correct type-safe
   * usage without casts: https://github.com/microsoft/TypeScript/issues/35288
   */
  // forgive me, for I have sinned
  public static wrap<T1, U1, A1>(p1: IPolicy<T1, U1, A1>): IPolicy<T1, U1, A1>;
  public static wrap<T1, U1, A1, T2, U2, A2>(
    p1: IPolicy<T1, U1, A1>,
    p2: IPolicy<T2, U2, A2>,
  ): IPolicy<T1 | T2, U1 & U2, A1 | A2>;
  public static wrap<T1, U1, A1, T2, U2, A2, T3, U3, A3>(
    p1: IPolicy<T1, U1, A1>,
    p2: IPolicy<T2, U2, A2>,
    p3: IPolicy<T3, U3, A3>,
  ): IPolicy<T1 | T2 | T3, U1 & U2 & U3, A1 | A2 | A3>;
  public static wrap<T1, U1, A1, T2, U2, A2, T3, U3, A3, T4, U4, A4>(
    p1: IPolicy<T1, U1, A1>,
    p2: IPolicy<T2, U2, A2>,
    p3: IPolicy<T3, U3, A3>,
    p4: IPolicy<T4, U4, A4>,
  ): IPolicy<T1 | T2 | T3 | T4, U1 & U2 & U3 & U4, A1 | A2 | A3 | A4>;
  public static wrap<T1, U1, A1, T2, U2, A2, T3, U3, A3, T4, U4, A4, T5, U5, A5>(
    p1: IPolicy<T1, U1, A1>,
    p2: IPolicy<T2, U2, A2>,
    p3: IPolicy<T3, U3, A3>,
    p4: IPolicy<T4, U4, A4>,
    p5: IPolicy<T5, U5, A5>,
  ): IPolicy<T1 | T2 | T3 | T4 | T5, U1 & U2 & U3 & U4 & U5, A1 | A2 | A3 | A4 | A5>;
  public static wrap<T, U, A>(...p: Array<IPolicy<T, U, A>>): IPolicy<T, U, A>;
  public static wrap<T, U, A>(...p: Array<IPolicy<T, U>>): IPolicy<T, U, A> {
    return {
      execute<R extends U>(fn: (context: T) => PromiseLike<R> | R): Promise<R> {
        const run = (context: any, i: number): R | PromiseLike<R> =>
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
  public static handleWhenResult<T>(predicate: (error: T) => boolean) {
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

  protected constructor(private readonly options: Readonly<IBasePolicyOptions<ReturnConstraint>>) {}

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
  public orWhenResult(predicate: (r: ReturnConstraint) => boolean) {
    /**
     * Bounty on this. Properly, you should also be able to discriminate the
     * return types. So if you add a handler like `(result: ReturnConstraint) =>
     * result is T` where T extends ReturnConstraint, then the policy should then
     * say that the 'wrapped' function returns `ReturnConstraint - T`. However, I
     * can't seem to figure out how to get this to work...
     */
    return new Policy<ReturnConstraint>({
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
  public orResultType<T extends ReturnConstraint>(
    cls: Constructor<T>,
    predicate?: (error: T) => boolean,
  ) {
    const filter = typeFilter(cls, predicate);
    return new Policy<ReturnConstraint>({
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
