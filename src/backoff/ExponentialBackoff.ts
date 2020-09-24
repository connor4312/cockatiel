import { IBackoff, IBackoffFactory } from './Backoff';
import { decorrelatedJitterGenerator, GeneratorFn } from './ExponentialBackoffGenerators';

/**
 * Options passed into {@link ExponentialBackoff}.
 */
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

const defaultOptions: IExponentialBackoffOptions<any> = {
  generator: decorrelatedJitterGenerator,
  maxDelay: 30000,
  maxAttempts: Infinity,
  exponent: 2,
  initialDelay: 128,
};

/**
 * An implementation of exponential backoff.
 */
export class ExponentialBackoff<S> implements IBackoffFactory<unknown> {
  private readonly options: IExponentialBackoffOptions<S>;

  constructor(options?: Partial<IExponentialBackoffOptions<S>>) {
    this.options = options ? { ...defaultOptions, ...options } : defaultOptions;
  }

  public next() {
    return instance(this.options).next(undefined);
  }
}

/**
 * An implementation of exponential backoff.
 */
const instance = <S>(
  options: IExponentialBackoffOptions<S>,
  state?: S,
  delay = 0,
  attempt = -1,
): IBackoff<unknown> => ({
  duration: delay,
  next() {
    if (attempt >= options.maxAttempts - 1) {
      return undefined;
    }

    const [nextDelay, nextState] = options.generator(state, options);
    return instance(options, nextState, nextDelay, attempt + 1);
  },
});
