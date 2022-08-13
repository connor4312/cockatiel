export class TaskCancelledError extends Error {
  public readonly isTaskCancelledError = true;

  /**
   * Error thrown when a task is cancelled.
   */
  constructor(public readonly message = 'Operation cancelled') {
    super(message);
  }
}
