import { ExecuteWrapper } from './common/Executor';
import { IPolicy } from './Policy';

export class FallbackPolicy<AltReturn> implements IPolicy<void, AltReturn> {
  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onSuccess = this.executor.onSuccess;

  /**
   * @inheritdoc
   */
  // tslint:disable-next-line: member-ordering
  public readonly onFailure = this.executor.onFailure;

  constructor(private readonly executor: ExecuteWrapper, private readonly value: () => AltReturn) {}

  /**
   * Executes the given function.
   * @param fn -- Function to execute.
   * @returns The function result or fallback value.
   */
  public async execute<T>(fn: (context: void) => PromiseLike<T> | T): Promise<T | AltReturn> {
    const result = await this.executor.invoke(fn);
    if ('success' in result) {
      return result.success;
    }

    return this.value();
  }
}
