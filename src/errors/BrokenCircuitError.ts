/**
 * Exception thrown from {@link CircuitBreakerPolicy.execute} when the
 * circuit breaker is open.
 */
export class BrokenCircuitError extends Error {
  public readonly isBrokenCircuitError = true;

  constructor(message: string = 'Execution prevented because the circuit breaker is open') {
    super(message);
  }
}
