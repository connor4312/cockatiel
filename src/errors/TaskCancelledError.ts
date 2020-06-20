/**
 * Error thrown when a task is cancelled.
 */
export class TaskCancelledError extends Error {
  public readonly isTaskCancelledError = true;

  constructor(public readonly message = 'Operation cancelled') {
    super(message);
  }
}
