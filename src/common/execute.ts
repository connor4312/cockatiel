import { FailureReason, IBasePolicyOptions } from '../Policy';

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

export const execute = async <T extends any[], R>(
  options: Readonly<IBasePolicyOptions>,
  fn: (...args: T) => PromiseLike<R> | R,
  ...args: T
): Promise<FailureOrSuccess<R>> => {
  try {
    const value = await fn(...args);
    if (!options.resultFilter(value)) {
      return { success: value };
    }

    return { value };
  } catch (error) {
    if (!options.errorFilter(error)) {
      throw error;
    }

    return { error };
  }
};
