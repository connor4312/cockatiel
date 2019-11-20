import { IBreaker } from './breaker/Breaker';
import { Bulkhead } from './Bulkhead';
import { CircuitBreakerPolicy } from './CircuitBreakerPolicy';
import { RetryPolicy } from './RetryPolicy';
import { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy';

type Constructor<T> = new (...args: any) => T;

const typeFilter = <T>(cls: Constructor<T>, predicate?: (error: T) => boolean) =>
  predicate ? (v: unknown) => v instanceof cls && predicate(v) : (v: unknown) => v instanceof cls;

const always = () => true;
const never = () => false;

export interface IBasePolicyOptions<ReturnType> {
  errorFilter: (error: Error) => boolean;
  resultFilter: (result: ReturnType) => boolean;
}

/**
 * The reason for a call failure. Either an error, or the a value that was
 * marked as a failure (when using result filtering).
 */
export type FailureReason<R> = { error: Error } | { value: R };

/**
 * Factory that builds a base set of filters that can be used in circuit
 * breakers, retries, etc.
 */
export class Policy<ReturnType> {
  /**
   * Creates a bulkhead--a policy that limits the number of concurrent calls.
   */
  public static bulkhead(limit: number, queue: number = 0) {
    return new Bulkhead(limit, queue);
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

  protected constructor(private readonly options: Readonly<IBasePolicyOptions<ReturnType>>) {}

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
  public orWhenResult(predicate: (r: ReturnType) => boolean) {
    /**
     * Bounty on this. Properly, you should also be able to discriminate the
     * return types. So if you add a handler like `(result: ReturnType) =>
     * result is T` where T extends ReturnType, then the policy should then
     * say that the 'wrapped' function returns `ReturnType - T`. However, I
     * can't seem to figure out how to get this to work...
     */
    return new Policy<ReturnType>({
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
  public orResultType<T extends ReturnType>(
    cls: Constructor<T>,
    predicate?: (error: ReturnType) => boolean,
  ) {
    const filter = typeFilter(cls, predicate);
    return new Policy<ReturnType>({
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
}
