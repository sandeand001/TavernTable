export function openDatabase(factory, name, upgrade) {
  if (!factory) return Promise.reject(new Error('IndexedDB is unavailable in this browser'));
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onerror = () => {
      failed = true;
      reject(request.error);
    };
    request.onblocked = () => {
      failed = true;
      reject(new Error('The local database is blocked. Close other TavernTable tabs and retry.'));
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
  });
}

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transact(database, stores, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let value;
    let failure;
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () =>
      reject(
        failure || transaction.error || new Error('The local database transaction was aborted')
      );
    Promise.resolve()
      .then(() => operation(transaction))
      .then((result) => {
        value = result;
      })
      .catch((error) => {
        failure = error;
        try {
          transaction.abort();
        } catch (abortError) {
          reject(
            new AggregateError(
              [error, abortError],
              'The local database transaction could not be completed or aborted'
            )
          );
        }
      });
  });
}
