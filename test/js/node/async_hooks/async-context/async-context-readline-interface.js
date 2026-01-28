process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const readline = require("readline");
const { Readable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

asyncLocalStorage.run({ test: "readline" }, () => {
  const input = new Readable({
    read() {},
  });

  const rl = readline.createInterface({
    input,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", line => {
    if (asyncLocalStorage.getStore()?.test !== "readline") {
      console.error("FAIL: readline line event lost context");
      failed = true;
    }
  });

  rl.on("close", () => {
    if (asyncLocalStorage.getStore()?.test !== "readline") {
      console.error("FAIL: readline close event lost context");
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

  // Send data and close
  input.push("test line\n");
  input.push(null);
});
