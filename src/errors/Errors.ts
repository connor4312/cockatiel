import { BrokenCircuitError } from './BrokenCircuitError';
import { BulkheadRejectedError } from './BulkheadRejectedError';
import { HydratingCircuitError } from './HydratingCircuitError';
import { IsolatedCircuitError } from './IsolatedCircuitError';
import { TaskCancelledError } from './TaskCancelledError';

export * from './BrokenCircuitError';
export * from './BulkheadRejectedError';
export * from './HydratingCircuitError';
export * from './IsolatedCircuitError';
export * from './TaskCancelledError';

export const isBrokenCircuitError = (e: unknown): e is BrokenCircuitError =>
  !!e && e instanceof Error && 'isBrokenCircuitError' in e;

export const isBulkheadRejectedError = (e: unknown): e is BulkheadRejectedError =>
  !!e && e instanceof Error && 'isBulkheadRejectedError' in e;

export const isIsolatedCircuitError = (e: unknown): e is IsolatedCircuitError =>
  !!e && e instanceof Error && 'isIsolatedCircuitError' in e;

export const isTaskCancelledError = (e: unknown): e is TaskCancelledError =>
  !!e && e instanceof Error && 'isTaskCancelledError' in e;

export const isHydratingCircuitError = (e: unknown): e is HydratingCircuitError =>
  !!e && e instanceof Error && 'isHydratingCircuitError' in e;
