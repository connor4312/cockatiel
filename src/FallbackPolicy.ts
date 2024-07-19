import { ExecuteWrapper } from './common/Executor';
import { IDefaultPolicyContext, IPolicy } from './Policy';

export class FallbackPolicy<AltReturn> implements IPolicy<IDefaultPolicyContext, AltReturn> {
  declare readonly _altReturn: AltReturn;

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  constructor(private readonly executor: ExecuteWrapper, private readonly value: () => AltReturn) {}

  /**
   * Executes the given function.
   * @param fn Function to execute.
   * @returns The function result or fallback value.
   */
  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal?: AbortSignal,
  ): Promise<T | AltReturn> {
    const result = await this.executor.invoke(fn, { signal });
    if ('success' in result) {
      return result.success;
    }

    return this.value();
  }
}
