const { CloudError } = require('./cloud-error.js');

let occupied = false;

function acquireLargeFileWork() {
  if (occupied)
    throw Object.assign(
      new CloudError(
        503,
        'cloud-requests-busy',
        'A large file operation is already in progress; retry shortly'
      ),
      { retryAfter: 1 }
    );
  occupied = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    occupied = false;
  };
}

module.exports = { acquireLargeFileWork };
