import { RetryPolicy } from './RetryPolicy';

type Constructor<T> = new (...args: any) => T;

const typeFilter = <T>(cls: Constructor<T>, predicate?: (error: T) => boolean) =>
  predicate ? (v: unknown) => v instanceof cls && predicate(v) : (v: unknown) => v instanceof cls;

const always = () => true;
const never = () => false;

/**
 * Factory that builds a base set of filters that can be used in circuit
 * breakers, retries, etc.
 */
export class Policy<ReturnType> {
  /**
   * Creates a retry policy that handles all errors.
   */
  public static handleAll() {
    return new Policy(always, never);
  }

  /**
   * See {@link Policy.orType} for usage.
   */
  public static handleType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
    return new Policy(typeFilter(cls, predicate), never);
  }

  /**
   * See {@link Policy.orWhen} for usage.
   */
  public static handleWhen(predicate: (error: Error) => boolean) {
    return new Policy(predicate, never);
  }
  /**
   * See {@link Policy.orResultType} for usage.
   */
  public static handleResultType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {
    return new Policy(never, typeFilter(cls, predicate));
  }

  /**
   * See {@link Policy.orWhenResult} for usage.
   */
  public static handleWhenResult<T>(predicate: (error: T) => boolean) {
    return new Policy(never, predicate);
  }
  protected constructor(
    private readonly errorFilter: (error: Error) => boolean,
    private readonly resultFilter: (result: ReturnType) => boolean,
  ) {}

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
    return new Policy(e => this.errorFilter(e) || filter(e), this.resultFilter);
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
    return new Policy(e => this.errorFilter(e) || predicate(e), this.resultFilter);
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
    return new Policy<ReturnType>(this.errorFilter, r => this.resultFilter(r) || predicate(r));
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
    return new Policy<ReturnType>(this.errorFilter, r => this.resultFilter(r) || filter(r));
  }

  /**
   * Returns a retry policy builder.
   */
  public retry() {
    return new RetryPolicy({
      errorFilter: this.errorFilter,
      resultFilter: this.resultFilter,
    });
  }
}
