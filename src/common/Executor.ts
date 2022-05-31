import { FailureReason, IFailureEvent, ISuccessEvent } from '../Policy';
import { EventEmitter } from './Event';

export type FailureOrSuccess<R> = FailureReason<R> | { success: R };

export const returnOrThrow = <R>(failure: FailureOrSuccess<R>) => {
  if ('error' in failure) {
    throw failure.error;
  }

  if ('success' in failure) {
    return failure.success;
  }

  return failure.value;
};

declare const performance: { now(): number };

const makeStopwatch = () => {
  if (typeof performance !== 'undefined') {
    const start = performance.now();
    return () => performance.now() - start;
  } else {
    const start = process.hrtime.bigint();
    return () => Number(process.hrtime.bigint() - start) / 1000000; // ns->ms
  }
};

export class ExecuteWrapper {
  private readonly successEmitter = new EventEmitter<ISuccessEvent>();
  private readonly failureEmitter = new EventEmitter<IFailureEvent>();
  // tslint:disable-next-line: member-ordering
  public readonly onSuccess = this.successEmitter.addListener;
  // tslint:disable-next-line: member-ordering
  public readonly onFailure = this.failureEmitter.addListener;

  constructor(
    private readonly errorFilter: (error: Error) => boolean = () => false,
    private readonly resultFilter: (result: unknown) => boolean = () => false,
  ) {}

  public clone() {
    return new ExecuteWrapper(this.errorFilter, this.resultFilter);
  }

  public async invoke<T extends unknown[], R>(
    fn: (...args: T) => PromiseLike<R> | R,
    ...args: T
  ): Promise<FailureOrSuccess<R>> {
    const stopwatch = this.successEmitter.size || this.failureEmitter.size ? makeStopwatch() : null;

    try {
      const value = await fn(...args);
      if (!this.resultFilter(value)) {
        if (stopwatch) {
          this.successEmitter.emit({ duration: stopwatch() });
        }
        return { success: value };
      }

      if (stopwatch) {
        this.failureEmitter.emit({ duration: stopwatch(), handled: true, reason: { value } });
      }

      return { value };
    } catch (rawError) {
      const error = rawError as Error;
      const handled = this.errorFilter(error as Error);
      if (stopwatch) {
        this.failureEmitter.emit({ duration: stopwatch(), handled, reason: { error } });
      }

      if (!handled) {
        throw error;
      }

      return { error };
    }
  }
}
