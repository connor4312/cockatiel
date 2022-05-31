import { onAbort } from './Event';

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

  onAbort(signal)(() => ctrl.abort());

  return ctrl;
};
