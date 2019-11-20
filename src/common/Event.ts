import { CancellationToken } from '../CancellationToken';
import { TaskCancelledError } from '../errors/TaskCancelledError';

/**
 * Type that can be disposed.
 */
export interface IDisposable {
  dispose(): void;
}

export const noopDisposable = { dispose: () => undefined };

/**
 * Function that subscribes the method to receive data.
 */
export type Event<T> = (listener: (data: T) => void) => IDisposable;

// tslint:disable-next-line: no-namespace
export namespace Event {
  /**
   * Adds a handler that handles one event on the emitter.
   */
  export const once = <T>(event: Event<T>, listener: (data: T) => void): IDisposable => {
    let syncDispose = false;
    let disposable: IDisposable | void;

    disposable = event(value => {
      listener(value);

      if (disposable) {
        disposable.dispose();
      } else {
        syncDispose = true; // callback can fire before disposable is returned
      }
    });

    if (syncDispose) {
      disposable.dispose();
      return noopDisposable; // no reason to keep the ref around
    }

    return disposable;
  };

  /**
   * Returns a promise that resolves when the event fires, or when cancellation
   * is requested, whichever happens first.
   */
  export const toPromise = <T>(event: Event<T>, cancellation?: CancellationToken): Promise<T> => {
    if (!cancellation) {
      return new Promise<T>(resolve => once(event, resolve));
    }

    if (cancellation.isCancellationRequested) {
      return Promise.reject(new TaskCancelledError());
    }

    return new Promise((resolve, reject) => {
      const d1 = once(cancellation.onCancellationRequested, () => {
        d2.dispose();
        reject(new TaskCancelledError());
      });

      const d2 = once(event, data => {
        d1.dispose();
        resolve(data);
      });
    });
  };
}

/**
 * Base event emitter. Calls listeners when data is emitted.
 */
export class EventEmitter<T> {
  protected readonly listeners = new Set<(data: T) => void>();

  /**
   * Event<T> function.
   */
  public readonly addListener: Event<T> = listener => this.addListenerInner(listener);

  /**
   * Emits event data.
   */
  public emit(value: T) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  protected addListenerInner(listener: (data: T) => void): IDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}

/**
 * An event emitter that memorizes and instantly re-emits its last value
 * to attached listeners.
 */
export class MemorizingEventEmitter<T> extends EventEmitter<T> {
  /**
   * Last emitted value, wrapped in an object so that we can correctly detect
   * emission of 'undefined' values.
   */
  private lastValue?: { value: T };

  /**
   * Gets whether this emitter has yet emitted any event.
   */
  public get hasEmitted() {
    return !!this.lastValue;
  }

  /**
   * @inheritdoc
   */
  public readonly addListener: Event<T> = listener => {
    const disposable = this.addListenerInner(listener);
    if (this.lastValue) {
      listener(this.lastValue.value);
    }

    return disposable;
  };

  /**
   * @inheritdoc
   */
  public emit(value: T) {
    this.lastValue = { value };

    for (const listener of this.listeners) {
      listener(value);
    }
  }
}
