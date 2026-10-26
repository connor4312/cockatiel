import { CircuitState } from '../CircuitBreakerPolicy.js';
import { IBreaker } from './Breaker.js';

interface IWindow {
  startedAt: number;
  failures: number;
  successes: number;
}

export interface ISamplingBreakerOptions {
  /**
   * Percentage (from 0 to 1) of requests that need to fail before we'll
   * open the circuit.
   */
  threshold: number;

  /**
   * Length of time over which to sample.
   */
  duration: number;

  /**
   * Minimum number of RPS needed to be able to (potentially) open the circuit.
   * Useful to avoid unnecessarily tripping under low load.
   */
  minimumRps?: number;
}

interface ISamplingBreakerState {
  windows: IWindow[];
  currentWindow: number;
  currentFailures: number;
  currentSuccesses: number;
}

export class SamplingBreaker implements IBreaker {
  private readonly threshold: number;
  private readonly minimumRpms: number;
  private readonly duration: number;
  private readonly windowSize: number;

  private windows: IWindow[] = [];
  private currentWindow = 0;
  private currentFailures = 0;
  private currentSuccesses = 0;

  /**
   * @inheritdoc
   */
  public get state(): unknown {
    return {
      windows: this.windows.map(w => ({ ...w })),
      currentWindow: this.currentWindow,
      currentFailures: this.currentFailures,
      currentSuccesses: this.currentSuccesses,
    } satisfies ISamplingBreakerState;
  }

  /**
   * @inheritdoc
   */
  public set state(value: unknown) {
    Object.assign(this, structuredClone(value));
  }

  /**
   * SamplingBreaker breaks if more than `threshold` percentage of calls over the
   * last `samplingDuration`, so long as there's at least `minimumRps` (to avoid
   * opening unnecessarily under low RPS).
   */
  constructor({ threshold, duration: samplingDuration, minimumRps }: ISamplingBreakerOptions) {
    if (threshold <= 0 || threshold >= 1) {
      throw new RangeError(`SamplingBreaker threshold should be between (0, 1), got ${threshold}`);
    }

    this.threshold = threshold;

    // at least 5 windows, max 1 second each:
    const windowCount = Math.max(5, Math.ceil(samplingDuration / 1000));
    for (let i = 0; i < windowCount; i++) {
      this.windows.push({ startedAt: 0, failures: 0, successes: 0 });
    }

    this.windowSize = Math.round(samplingDuration / windowCount);
    this.duration = this.windowSize * windowCount;

    if (minimumRps) {
      this.minimumRpms = minimumRps / 1000;
    } else {
      // for our rps guess, set it so at least 5 failures per second
      // are needed to open the circuit
      this.minimumRpms = 5 / (threshold * 1000);
    }
  }

  /**
   * @inheritdoc
   */
  public success(state: CircuitState) {
    if (state === CircuitState.HalfOpen) {
      this.resetWindows();
    }

    this.push(true);
  }

  /**
   * @inheritdoc
   */
  public failure(state: CircuitState) {
    this.push(false);

    if (state !== CircuitState.Closed) {
      return true;
    }

    const total = this.currentSuccesses + this.currentFailures;

    // If we don't have enough rps, then the circuit is open.
    // 1. `total / samplingDuration` gets rps
    // 2. We want `rpms < minimumRpms`
    // 3. Simplifies to `total < samplingDuration * minimumRps`
    if (total < this.duration * this.minimumRpms) {
      return false;
    }

    // If we're above threshold, open the circuit
    // 1. `failures / total > threshold`
    // 2. `failures > threshold * total`
    if (this.currentFailures > this.threshold * total) {
      return true;
    }

    return false;
  }

  private resetWindows() {
    this.currentFailures = 0;
    this.currentSuccesses = 0;
    for (const window of this.windows) {
      window.failures = 0;
      window.successes = 0;
      window.startedAt = 0;
    }
  }

  /**
   * Advances to a new window, `elapsedWindows` window lengths after the start
   * of the current one. The windows passed over (at most the whole ring) are
   * expired, so that samples older than the sampling duration are dropped even
   * if no calls were made in between.
   */
  private rotateWindow(now: number, elapsedWindows: number) {
    const steps = Math.min(elapsedWindows, this.windows.length);
    for (let i = 1; i <= steps; i++) {
      const expired = this.windows[(this.currentWindow + i) % this.windows.length];
      this.currentFailures -= expired.failures;
      this.currentSuccesses -= expired.successes;
      expired.failures = 0;
      expired.successes = 0;
    }

    const next = (this.currentWindow + steps) % this.windows.length;
    const window = (this.windows[next] = { failures: 0, successes: 0, startedAt: now });
    this.currentWindow = next;

    return window;
  }

  private push(success: boolean) {
    const now = Date.now();

    // Get the current time period window, advance if necessary
    let window = this.windows[this.currentWindow];
    const elapsed = now - window.startedAt;
    if (elapsed >= this.windowSize) {
      // `|| 1` covers a zero window size, where the division is NaN
      window = this.rotateWindow(now, Math.floor(elapsed / this.windowSize) || 1);
    }

    // Increment current counts
    if (success) {
      window.successes++;
      this.currentSuccesses++;
    } else {
      window.failures++;
      this.currentFailures++;
    }
  }
}
