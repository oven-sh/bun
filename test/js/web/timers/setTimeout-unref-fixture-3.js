setTimeout(() => {
  setTimeout(() => {}, 999_999);
}, 100).unref();

setTimeout(() => {
  // this one should always run
}, 1);
