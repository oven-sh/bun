process.exitCode = 1;
setTimeout(() => {
  setTimeout(() => {
    process.exitCode = 1;
  }, 999_999);
  process.exitCode = 1;
}, 100).unref();

setTimeout(() => {
  // this one should always run
  process.exitCode = 0;
}, 1);
