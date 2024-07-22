import { CircuitState } from '../CircuitBreakerPolicy';
import { IBreaker } from './Breaker';

export interface ICountBreakerOptions {
  /**
   * Percentage (from 0 to 1) of requests that need to fail before we'll
   * open the circuit.
   */
  threshold: number;

  /**
   * Size of the count based sliding window.
   */
  size: number;

  /**
   * Minimum number of calls needed to (potentially) open the circuit.
   * Useful to avoid unnecessarily tripping when there are only few samples yet.
   * Defaults to {@link ICountBreakerOptions.size}.
   */
  minimumNumberOfCalls?: number;
}


interface ICountBreakerState {
  samples: (boolean | null)[];
  currentSample: number;
  failures: number;
  successes: number;
}


export class CountBreaker implements IBreaker {
  private readonly threshold: number;
  private readonly minimumNumberOfCalls: number;

  /**
   * The samples in the sliding window. `true` means "success", `false` means
   * "failure" and `null` means that there is no sample yet.
   */
  private samples: (boolean | null)[];
  private successes = 0;
  private failures = 0;
  private currentSample = 0;

  /**
   * @inheritdoc
   */
  public get state(): unknown {
    return {
      samples: this.samples,
      currentSample: this.currentSample,
      failures: this.failures,
      successes: this.successes,
    } satisfies ICountBreakerState;
  }

  /**
   * @inheritdoc
   */
  public set state(value: unknown) {
    Object.assign(this, value);
  }

  /**
   * CountBreaker breaks if more than `threshold` percentage of the last `size`
   * calls failed, so long as at least `minimumNumberOfCalls` calls have been
   * performed (to avoid opening unnecessarily if there are only few samples
   * in the sliding window yet).
   */
  constructor({ threshold, size, minimumNumberOfCalls = size }: ICountBreakerOptions) {
    if (threshold <= 0 || threshold >= 1) {
      throw new RangeError(`CountBreaker threshold should be between (0, 1), got ${threshold}`);
    }
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new RangeError(`CountBreaker size should be a positive integer, got ${size}`);
    }
    if (
      !Number.isSafeInteger(minimumNumberOfCalls) ||
      minimumNumberOfCalls < 1 ||
      minimumNumberOfCalls > size
    ) {
      throw new RangeError(
        `CountBreaker size should be an integer between (1, size), got ${minimumNumberOfCalls}`,
      );
    }

    this.threshold = threshold;
    this.minimumNumberOfCalls = minimumNumberOfCalls;
    this.samples = Array.from({ length: size }, () => null);
  }

  /**
   * @inheritdoc
   */
  public success(state: CircuitState) {
    if (state === CircuitState.HalfOpen) {
      this.reset();
    }

    this.sample(true);
  }

  /**
   * @inheritdoc
   */
  public failure(state: CircuitState) {
    this.sample(false);

    if (state !== CircuitState.Closed) {
      return true;
    }

    const total = this.successes + this.failures;

    if (total < this.minimumNumberOfCalls) {
      return false;
    }

    if (this.failures > this.threshold * total) {
      return true;
    }

    return false;
  }

  private reset() {
    this.samples.fill(null);
    this.successes = 0;
    this.failures = 0;
  }

  private sample(success: boolean) {
    const current = this.samples[this.currentSample];
    if (current === true) {
      this.successes--;
    } else if (current === false) {
      this.failures--;
    }

    this.samples[this.currentSample] = success;
    if (success) {
      this.successes++;
    } else {
      this.failures++;
    }

    this.currentSample = (this.currentSample + 1) % this.samples.length;
  }
}
