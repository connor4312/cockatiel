// Temporary augmentation for TS since @types/node lacks the AbortSignal type,
// and depending on the target milage may vary...
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/d5323665619bd6034643f11291c1b1405f1f8790/types/node/globals.d.ts#L45-L57

// tslint:disable
declare module global {
  export interface AbortSignal {
    readonly aborted: boolean;
    addEventListener(event: 'abort', listener: () => void): void;
    removeEventListener(event: 'abort', listener: () => void): void;
  }

  export class AbortController {
    readonly signal: AbortSignal;
    abort(): void;
  }
}

export const neverAbortedSignal = new AbortController().signal;

const cancelledSrc = new AbortController();
cancelledSrc.abort();
export const abortedSignal = cancelledSrc.signal;

/**
 * Creates a new AbortController that is aborted when the parent signal aborts.
 * @private
 */
export const deriveAbortController = (signal?: AbortSignal) => {
  const ctrl = new AbortController();
  if (!signal) {
    return ctrl;
  }

  if (signal.aborted) {
    ctrl.abort();
  }

  const l = () => ctrl.abort();
  signal.addEventListener('abort', l);
  ctrl.signal.addEventListener('abort', () => signal.removeEventListener('abort', l));

  return ctrl;
};

export const waitForAbort = (signal: AbortSignal) => {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>(resolve => {
    const l = () => {
      resolve();
      signal.removeEventListener('abort', l);
    };

    signal.addEventListener('abort', l);
  });
};
