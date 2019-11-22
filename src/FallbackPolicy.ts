import { EventEmitter } from './common/Event';
import { execute } from './common/execute';
import { FailureReason, IBasePolicyOptions, IPolicy } from './Policy';

export class FallbackPolicy<AltReturn> implements IPolicy<void, AltReturn> {
  private readonly fallbackEmitter = new EventEmitter<FailureReason<unknown>>();

  /**
   * Event that fires when a fallback happens.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onFallback = this.fallbackEmitter.addListener;

  constructor(
    private readonly options: IBasePolicyOptions,
    private readonly value: () => AltReturn,
  ) {}

  /**
   * Executes the given function.
   * @param fn -- Function to execute.
   * @returns The function result or fallback value.
   */
  public async execute<T>(fn: (context: void) => PromiseLike<T> | T): Promise<T | AltReturn> {
    const result = await execute(this.options, fn);
    if ('success' in result) {
      return result.success;
    }

    this.fallbackEmitter.emit(result);
    return this.value();
  }
}
