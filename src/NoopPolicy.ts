import { neverAbortedSignal } from './common/abort';
import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { IDefaultPolicyContext, IPolicy } from './Policy';

/**
 * A no-op policy, useful for unit tests and stubs.
 */
export class NoopPolicy implements IPolicy {
  private readonly executor = new ExecuteWrapper();

  // tslint:disable-next-line: member-ordering
  public readonly onSuccess = this.executor.onSuccess;

  // tslint:disable-next-line: member-ordering
  public readonly onFailure = this.executor.onFailure;

  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal: AbortSignal = neverAbortedSignal,
  ): Promise<T> {
    return returnOrThrow(await this.executor.invoke(fn, { signal }));
  }
}
