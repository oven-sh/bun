process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { exec } = require("child_process");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "child_process.exec" }, () => {
  exec("echo test", (error, stdout, stderr) => {
    if (asyncLocalStorage.getStore()?.test !== "child_process.exec") {
      console.error("FAIL: child_process.exec callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
