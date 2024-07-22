import { CircuitState } from '../CircuitBreakerPolicy';

/**
 * The breaker determines when the circuit breaker should open.
 */
export interface IBreaker {
  /**
   * Gets or sets the internal state of the breaker. Used for serialization
   * with {@link CircuitBreaker.toJSON}.
   */
  state: unknown;

  /**
   * Called when a call succeeds.
   */
  success(state: CircuitState): void;

  /**
   * Called when a call fails. Returns true if the circuit should open.
   */
  failure(state: CircuitState): boolean;
}

export * from './ConsecutiveBreaker';
export * from './CountBreaker';
export * from './SamplingBreaker';

