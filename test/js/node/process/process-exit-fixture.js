process.on("beforeExit", () => {
  throw new Error("process.on('beforeExit') called");
});

if (process._exiting) {
  throw new Error("process._exiting should be undefined");
}

process.on("exit", () => {
  if (!process._exiting) {
    throw new Error("process.on('exit') called with process._exiting false");
  }
  console.log("PASS");
});

process.exit(0);
