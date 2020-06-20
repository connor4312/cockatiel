import { ExecuteWrapper, returnOrThrow } from './common/Executor';
import { IPolicy } from './Policy';

/**
 * A no-op policy, useful for unit tests and stubs.
 */
export class NoopPolicy implements IPolicy<void> {
  private readonly executor = new ExecuteWrapper();

  // tslint:disable-next-line: member-ordering
  public readonly onSuccess = this.executor.onSuccess;

  // tslint:disable-next-line: member-ordering
  public readonly onFailure = this.executor.onFailure;

  public async execute<T>(fn: (context: void) => PromiseLike<T> | T): Promise<T> {
    return returnOrThrow(await this.executor.invoke(fn));
  }
}
