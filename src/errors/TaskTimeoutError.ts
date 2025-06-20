export class TaskTimeoutError extends Error {
  public readonly isTaskTimeoutError = true;

  /**
   * Error thrown when a task is timeout.
   */
  constructor(
    /** Timeout in milliseconds */
    public readonly timeout: number,
  ) {
    super(`Operation timed out after ${timeout}ms`);
  }
}
