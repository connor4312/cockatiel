import { IBreaker } from './Breaker';

export class ConsecutiveBreaker implements IBreaker {
  private count = 0;

  /**
   * ConsecutiveBreaker breaks if more than `threshold` exceptions are received
   * over a time period.
   */
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
