import { IDisposable, onAbort } from './Event';

export const neverAbortedSignal = new AbortController().signal;

const cancelledSrc = new AbortController();
cancelledSrc.abort();
export const abortedSignal = cancelledSrc.signal;

const noop: () => void = () => {};

/**
 * Creates a new AbortController that is aborted when the parent signal aborts.
 * @private
 */
export const deriveAbortController = (
  signal?: AbortSignal,
): { ctrl: AbortController } & IDisposable => {
  const ctrl = new AbortController();
  let dispose: () => void = noop;
  if (!signal) {
    return { ctrl, dispose };
  }

  if (signal.aborted) {
    ctrl.abort();
  } else {
    const abortEvt = onAbort(signal);
    abortEvt.event(() => ctrl.abort());
    dispose = abortEvt.dispose;
  }

  return { ctrl, dispose };
};
