/**
 * Error thrown when a task is cancelled.
 */
export class TaskCancelledError extends Error {
  constructor(public readonly message = 'Operation cancelled') {
    super(message);
  }
}
