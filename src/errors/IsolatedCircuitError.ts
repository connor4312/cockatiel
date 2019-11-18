import { BrokenCircuitError } from './BrokenCircuitError';

/**
 * Exception thrown from {@link CircuitBreakerPolicy.execute} when the
 * circuit breaker is open.
 */
export class IsolatedCircuitError extends BrokenCircuitError {
  constructor() {
    super(`Execution prevented because the circuit breaker is open`);
  }
}
