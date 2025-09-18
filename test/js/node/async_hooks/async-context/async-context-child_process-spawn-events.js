process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { spawn } = require("child_process");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "child_process.spawn" }, () => {
  const child = spawn("bun", ["-e", "Bun.sleepSync(100)"]);

  child.on("spawn", () => {
    if (asyncLocalStorage.getStore()?.test !== "child_process.spawn") {
      console.error("FAIL: spawn event lost context");
      failed = true;
    }
  });

  child.stdout.on("data", data => {
    if (asyncLocalStorage.getStore()?.test !== "child_process.spawn") {
      console.error("FAIL: spawn stdout data event lost context");
      failed = true;
    }
  });

  child.on("close", code => {
    if (asyncLocalStorage.getStore()?.test !== "child_process.spawn") {
      console.error("FAIL: spawn close event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  child.on("error", () => {
    process.exit(1);
  });
});
