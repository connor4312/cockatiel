import { IBackoff } from './Backoff';
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
export class ExponentialBackoff<S> implements IBackoff<void> {
  private options: IExponentialBackoffOptions<S>;
  private state?: S;
  private attempt = -1;
  private delay = 0;

  constructor(options?: Partial<IExponentialBackoffOptions<S>>) {
    this.options = options ? { ...defaultOptions, ...options } : defaultOptions;
  }

  /**
   * @inheritdoc
   */
  public duration() {
    if (this.attempt === -1) {
      throw Error(`duration is avaiable until the first next call`);
    }
    return this.delay;
  }

  public next() {
    if (this.attempt >= this.options.maxAttempts - 1) {
      return undefined;
    }

    const e = new ExponentialBackoff(this.options);
    [e.delay, e.state] = this.options.generator(this.state, this.options);
    e.attempt = this.attempt + 1;
    return e;
  }
}
