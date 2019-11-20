import { Event, IDisposable, MemorizingEventEmitter, noopDisposable } from './common/Event';

/**
 * Source that creates {@link CancellationToken} instances/
 */
export class CancellationTokenSource {
  private readonly onCancel = new MemorizingEventEmitter<void>();
  private parentListener?: IDisposable;

  constructor(parent?: CancellationToken) {
    if (parent) {
      this.parentListener = parent.onCancellationRequested(() => this.cancel());
    }
  }

  /**
   * Gets the cancellation token for this source.
   */
  // tslint:disable-next-line: member-ordering
  public readonly token = new CancellationToken(this.onCancel.addListener);

  /**
   * Cancels associated tokens.
   */
  public cancel() {
    if (this.parentListener) {
      this.parentListener.dispose();
      this.parentListener = undefined;
    }

    if (!this.onCancel.hasEmitted) {
      this.onCancel.emit();
    }
  }
}

/**
 * Implementation of a cancellation token. Exposes several methods that can
 * be used to implement cooperative cancellation.
 */
export class CancellationToken {
  /**
   * A cancellation token which is never cancelled.
   */
  public static None = new CancellationToken(() => noopDisposable);

  /**
   * A cancellation token which is immediately/already cancelled.
   */
  public static Cancelled = new CancellationToken(listener => {
    listener(undefined);
    return noopDisposable;
  });

  private isRequested = false;

  /**
   * Creates a new cancellation token that is marked as cancelled once the
   * callback fires.
   */
  constructor(public readonly onCancellationRequested: Event<void>) {
    Event.once(onCancellationRequested, () => (this.isRequested = true));
  }

  /**
   * Returns whether cancellation has been requested.
   */
  public get isCancellationRequested() {
    return this.isRequested;
  }

  /**
   * Returns a promise that resolves once cancellation is requested.
   */
  public cancellation(listenerCancellation?: CancellationToken): Promise<void> {
    return Event.toPromise(this.onCancellationRequested, listenerCancellation);
  }
}
