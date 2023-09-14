let counter = 0;
process.on("beforeExit", () => {
  if (process._exiting) {
    throw new Error("process._exiting should be undefined");
  }

  console.log("beforeExit:", counter);
  if (!counter++) {
    setTimeout(() => {}, 1);
  }
});

process.on("exit", () => {
  if (!process._exiting) {
    throw new Error("process.on('exit') called with process._exiting false");
  }
  console.log("exit:", counter);
});
