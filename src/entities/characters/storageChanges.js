export function afterCharacterCommit(result, complete) {
  return typeof result?.then === 'function' ? result.then(complete) : complete(result);
}

export function commitStorageChanges(storage, changes) {
  const previous = changes.map(([key]) => storage.getItem(key));
  const written = [];
  try {
    changes.forEach(([key, value], index) => {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      written.push(index);
    });
  } catch (error) {
    const failures = [];
    for (const index of written.reverse()) {
      try {
        const key = changes[index][0];
        if (previous[index] === null) storage.removeItem(key);
        else storage.setItem(key, previous[index]);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        [error, ...failures],
        'Character data could not be saved or fully restored. Check browser storage and backups.'
      );
    }
    throw new Error('The character change could not be saved; previous data was restored', {
      cause: error,
    });
  }
}
