import { EventEmitter } from './common/Event';
import { execute } from './common/execute';
import { FailureReason, IBasePolicyOptions, IPolicy } from './Policy';

export class FallbackPolicy<ReturnConstraint, AltReturn>
  implements IPolicy<void, ReturnConstraint, AltReturn> {
  private readonly fallbackEmitter = new EventEmitter<FailureReason<ReturnConstraint>>();

  /**
   * Event that fires when a fallback happens.
   */
  // tslint:disable-next-line: member-ordering
  public readonly onFallback = this.fallbackEmitter.addListener;

  constructor(
    private readonly options: IBasePolicyOptions<ReturnConstraint>,
    private readonly value: () => AltReturn,
  ) {}

  /**
   * Executes the given function.
   * @param fn -- Function to execute.
   * @returns The function result or fallback value.
   */
  public async execute<T extends ReturnConstraint>(
    fn: (context: void) => PromiseLike<T> | T,
  ): Promise<T | AltReturn> {
    const result = await execute(this.options, fn);
    if ('success' in result) {
      return result.success;
    }

    this.fallbackEmitter.emit(result);
    return this.value();
  }
}
