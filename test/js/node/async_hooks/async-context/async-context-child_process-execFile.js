process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { execFile } = require("child_process");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "child_process.execFile" }, () => {
  execFile("echo", ["test"], (error, stdout, stderr) => {
    if (asyncLocalStorage.getStore()?.test !== "child_process.execFile") {
      console.error("FAIL: child_process.execFile callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
