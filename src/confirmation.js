// One decision at a time: a repeated click must never approve a second action
// with the answer to the first prompt.
export function createConfirmationController() {
  let current = null;
  let resolveCurrent = null;
  let sequence = 0;
  let closed = false;
  const listeners = new Set();
  const publish = () => {
    for (const listener of listeners) listener();
  };

  function settle(id, accepted = false) {
    if (!current || current.id !== id) return false;
    const resolve = resolveCurrent;
    current = null;
    resolveCurrent = null;
    publish();
    resolve(accepted === true);
    return true;
  }

  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request(options = {}) {
      if (closed || current) return Promise.resolve(false);
      const promise = new Promise((resolve) => {
        resolveCurrent = resolve;
      });
      current = Object.freeze({ ...options, id: ++sequence });
      publish();
      return promise;
    },
    settle,
    activate() {
      closed = false;
    },
    dispose() {
      closed = true;
      if (current) settle(current.id, false);
    },
  });
}
