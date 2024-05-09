let unhandledRejectionCalled = false;

setTimeout(() => {
  if (!unhandledRejectionCalled) {
    process.exit(1);
  }
  // timeouts should be processed
  process.exit(42);
}, 1);

let promise;

process.on("unhandledRejection", (err, promise) => {
  unhandledRejectionCalled = true;
  // there should be an error
  if (!err) {
    process.exit(1);
  }
  if (promise !== promise) {
    process.exit(1);
  }
});

promise = Promise.reject(new Error("error"));
