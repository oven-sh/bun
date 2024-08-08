process.exitCode = 1;

setTimeout(() => {
  console.log("TEST PASSED!");
  process.exitCode = 0;
}, 1)
  .unref()
  .ref();
