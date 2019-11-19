export class BulkheadRejectedError extends Error {
  constructor() {
    super('Bulkhead capacity exceeded');
  }
}
