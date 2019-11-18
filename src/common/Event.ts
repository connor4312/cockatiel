/**
 * Type that can be disposed.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * Function that subscribes the method to receive data.
 */
export type Event<T> = (listener: (data: T) => void) => IDisposable;

export class EventEmitter<T> {
  private readonly listeners = new Set<(data: T) => void>();

  /**
   * Event<T> function.
   */
  public readonly addListener: Event<T> = listener => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  /**
   * Emits event data.
   */
  public emit(data: T) {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
}
