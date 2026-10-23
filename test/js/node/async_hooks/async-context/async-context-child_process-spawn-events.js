process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { spawn } = require("child_process");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;
let sawStdout = false;

asyncLocalStorage.run({ test: "child_process.spawn" }, () => {
  // process.execPath is whichever of node or bun is running this fixture; both
  // accept -e. The child prints something so that the stdout data event fires.
  const child = spawn(process.execPath, ["-e", "console.log('child')"]);

  child.on("spawn", () => {
    if (asyncLocalStorage.getStore()?.test !== "child_process.spawn") {
      console.error("FAIL: spawn event lost context");
      failed = true;
    }
  });

  child.stdout.on("data", () => {
    sawStdout = true;
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
    if (code !== 0 || !sawStdout) {
      console.error(`ERROR: child exited with code ${code}, stdout data event fired: ${sawStdout}`);
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  child.on("error", err => {
    console.error("ERROR:", err);
    process.exit(1);
  });
});
