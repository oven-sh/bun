process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { spawn } = require("child_process");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function check(event) {
  if (asyncLocalStorage.getStore()?.test !== "child_process.spawn stdio") {
    console.error(`FAIL: spawn ${event} event lost context`);
    failed = true;
  }
}

asyncLocalStorage.run({ test: "child_process.spawn stdio" }, () => {
  // Each stream takes more than one read.
  const child = spawn(process.execPath, [
    "-e",
    "process.stdout.write(Buffer.alloc(200000, 120)); process.stderr.write(Buffer.alloc(200000, 120));",
  ]);

  child.stdout.on("data", () => check("stdout data"));
  child.stdout.on("end", () => check("stdout end"));
  child.stdout.on("close", () => check("stdout close"));

  child.stderr.on("readable", () => {
    check("stderr readable");
    child.stderr.read();
  });
  child.stderr.on("end", () => check("stderr end"));
  child.stderr.on("close", () => check("stderr close"));

  child.on("close", () => {
    check("close");
    process.exit(failed ? 1 : 0);
  });

  child.on("error", () => {
    process.exit(1);
  });
});
