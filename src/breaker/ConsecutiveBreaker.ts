import { IBreaker } from './Breaker';

/**
 * ConsecutiveBreaker breaks if more than `threshold` exceptions are received
 * over a time period.
 */
export class ConsecutiveBreaker implements IBreaker {
  private count = 0;

  constructor(private readonly threshold: number) {}

  /**
   * @inheritdoc
   */
  public success() {
    this.count = 0;
  }

  /**
   * @inheritdoc
   */
  public failure() {
    return ++this.count >= this.threshold;
  }
}
