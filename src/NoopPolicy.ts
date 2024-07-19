import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { IDefaultPolicyContext, IPolicy } from './Policy';

/**
 * A no-op policy, useful for unit tests and stubs.
 */
export class NoopPolicy implements IPolicy {
  declare readonly _altReturn: never;
  private readonly executor = new ExecuteWrapper();
  public readonly onSuccess = this.executor.onSuccess;
  public readonly onFailure = this.executor.onFailure;

  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    return returnOrThrow(await this.executor.invoke(fn, { signal }));
  }
}
