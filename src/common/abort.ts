import { onAbort } from './Event';

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
    return ctrl;
  }

  const ref = new WeakRef(ctrl);
  onAbort(signal)(() => ref.deref()?.abort());

  return ctrl;
};
