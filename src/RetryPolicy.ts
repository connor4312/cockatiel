import { IBackoff } from './backoff/Backoff';
import { CompositeBackoff, CompositeBias } from './backoff/CompositeBackoff';
import { ConstantBackoff } from './backoff/ConstantBackoff';
import { DelegateBackoff, DelegateBackoffFn } from './backoff/DelegateBackoff';
import { IterableBackoff } from './backoff/IterableBackoff';

const delay = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));

/**
 * Context passed into the execute method of the builder.
 */
export interface IRetryContext {
  /**
   * The retry attempt, starting at 1 for calls into backoffs.
   */
  attempt: number;
}

/**
 * Context passed into backoff delegated.
 */
export interface IRetryBackoffContext<R> extends IRetryContext {
  /**
   * The result of the last method call. Either a thrown error, or a value
   * that we determined should be retried upon.
   */
  result: { error: Error } | { value: R };
}

export interface IRetryPolicyConfig<R> {
  errorFilter: (e: Error) => boolean;
  resultFilter: (e: R) => boolean;
  backoff?: IBackoff<IRetryBackoffContext<R>>;
}

export class RetryPolicy<R> {
  constructor(private readonly options: IRetryPolicyConfig<R>) {}

  /**
   * Sets the number of retry attempts for the function.
   * @param count -- Retry attempts to make
   */
  public attempts(count: number) {
    return this.composeBackoff('a', new ConstantBackoff(1, count));
  }

  /**
   * Sets the delay between retries. Can be a single duration, of a list of
   * durations. If it's a list, it will also determine the number of backoffs.
   */
  public delay(amount: number | ReadonlyArray<number>) {
    return this.composeBackoff(
      'b',
      typeof amount === 'number' ? new ConstantBackoff(amount) : new IterableBackoff(amount),
    );
  }

  /**
   * Sets the baackoff to use for retries.
   */
  public delegate<S>(backoff: DelegateBackoffFn<IRetryBackoffContext<R>, S>) {
    return this.composeBackoff('b', new DelegateBackoff(backoff));
  }

  /**
   * Sets the baackoff to use for retries.
   */
  public backoff(backoff: IBackoff<IRetryBackoffContext<R>>) {
    return this.composeBackoff('b', backoff);
  }

  /**
   * Executes the given function with retries.
   * @param fn -- Function to run
   * @returns a Promise that resolves or rejects with the function results.
   */
  public async execute<T extends R>(fn: (context: IRetryContext) => Promise<T> | T): Promise<T> {
    let backoff: IBackoff<IRetryBackoffContext<R>> | undefined =
      this.options.backoff || new ConstantBackoff(0, 1);
    for (let retries = 0; ; retries++) {
      let result: { value: T } | { error: Error };
      try {
        const value = await fn({ attempt: 0 });
        if (!this.options.resultFilter(value)) {
          return value;
        }

        result = { value };
      } catch (error) {
        if (!this.options.errorFilter(error)) {
          throw error;
        }

        result = { error };
      }

      if (backoff) {
        await delay(backoff.duration());
        backoff = backoff.next({ attempt: retries + 1, result });
        continue;
      }

      if ('error' in result) {
        throw result.error;
      }

      return result.value;
    }
  }

  private composeBackoff(bias: CompositeBias, backoff: IBackoff<IRetryBackoffContext<R>>) {
    if (this.options.backoff) {
      backoff = new CompositeBackoff(bias, this.options.backoff, backoff);
    }

    return new RetryPolicy({ ...this.options, backoff });
  }
}
