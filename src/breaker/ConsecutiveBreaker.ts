import { IBreaker } from './Breaker';

export class ConsecutiveBreaker implements IBreaker {
  /**
   * @inheritdoc
   */
  public state = 0;

  /**
   * ConsecutiveBreaker breaks if more than `threshold` exceptions are received
   * over a time period.
   */
  constructor(private readonly threshold: number) {}

  /**
   * @inheritdoc
   */
  public success() {
    this.state = 0;
  }

  /**
   * @inheritdoc
   */
  public failure() {
    return ++this.state >= this.threshold;
  }
}
