export class BulkheadRejectedError extends Error {
  public readonly isBulkheadRejectedError = true;

  constructor(executionSlots: number, queueSlots: number) {
    super(
      `Bulkhead capacity exceeded (0/${executionSlots} execution slots, 0/${queueSlots} available)`,
    );
  }
}
