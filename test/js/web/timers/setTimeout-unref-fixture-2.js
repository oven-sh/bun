process.exitCode = 1;
setTimeout(() => {
  console.log("TEST FAILED!");
}, 100)
  .ref()
  .unref();

setTimeout(function () {
  // this one should always run
  process.exitCode = 0;
  if (typeof this?.refresh !== "function") {
    process.exitCode = 1;
  }
}, 1);
