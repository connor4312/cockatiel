import { BrokenCircuitError } from './BrokenCircuitError';

export class IsolatedCircuitError extends BrokenCircuitError {
  public readonly isIsolatedCircuitError = true;

  /**
   * Exception thrown from {@link CircuitBreakerPolicy.execute} when the
   * circuit breaker is open.
   */
  constructor() {
    super(`Execution prevented because the circuit breaker is open`);
  }
}
