setTimeout(() => {
  console.log("TEST FAILED!");
}, 100)
  .ref()
  .unref();

setTimeout(() => {
  // this one should always run
}, 1);
