export class ActionRequestCancelledError extends Error {}

export default class ActionRequestQueue {
  constructor({ isReady }) {
    this.isReady = isReady;
    this.pending = new Map();
    this.running = new Set();
    this.scheduled = false;
    this.disposed = false;
  }

  enqueue(key, execute) {
    if (this.disposed)
      return Promise.reject(new ActionRequestCancelledError('Queued action was cancelled'));
    return new Promise((resolve, reject) => {
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key).push({ execute, resolve, reject });
      this.flush();
    });
  }

  has(key) {
    return this.pending.has(key) || this.running.has(key);
  }

  flush() {
    if (this.scheduled || this.disposed || !this.pending.size) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed) return;
      for (const [key, requests] of this.pending) {
        if (this.running.has(key)) continue;
        let ready;
        try {
          ready = this.isReady(key);
        } catch (error) {
          requests.shift().reject(error);
          if (!requests.length) this.pending.delete(key);
          this.flush();
          continue;
        }
        if (!ready) continue;
        const request = requests.shift();
        if (!requests.length) this.pending.delete(key);
        this.running.add(key);
        let result;
        try {
          result = request.execute();
        } catch (error) {
          request.reject(error);
          this.running.delete(key);
          this.flush();
          continue;
        }
        Promise.resolve(result)
          .then(request.resolve, request.reject)
          .finally(() => {
            this.running.delete(key);
            this.flush();
          });
      }
    });
  }

  cancel(key) {
    for (const request of this.pending.get(key) || [])
      request.reject(new ActionRequestCancelledError('Queued action was cancelled'));
    this.pending.delete(key);
  }

  dispose() {
    this.disposed = true;
    for (const requests of this.pending.values())
      for (const request of requests)
        request.reject(new ActionRequestCancelledError('Queued action was cancelled'));
    this.pending.clear();
  }
}
