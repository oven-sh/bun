// After removing the last 'readable' or 'data' listener, fd 0 must be released
// so a stdio:'inherit' child can read it exclusively.
const { spawn } = require("child_process");

const event = process.argv[2] === "data" ? "data" : "readable";
const remover = process.argv[3] || "removeListener";

const handler =
  event === "readable"
    ? () => {
        while (process.stdin.read() !== null) {}
      }
    : () => {};
process.stdin.on(event, handler);

setImmediate(() => {
  if (remover === "removeAllListeners") process.stdin.removeAllListeners(event);
  else if (remover === "removeAllListenersNoArg") process.stdin.removeAllListeners();
  else process.stdin.removeListener(event, handler);

  if (process.stdin.listenerCount(event) !== 0) {
    process.stderr.write("FAIL: listener still attached\n");
    process.exit(1);
  }

  // disown is deferred to nextTick (via updateReadableListening); wait one
  // setImmediate so the child is spawned after fd 0 is released.
  setImmediate(() => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `let buf = "";
         process.stdin.setEncoding("utf8");
         process.stdin.on("data", d => buf += d);
         process.stdin.on("end", () => process.stdout.write("CHILD:" + buf));`,
      ],
      { stdio: ["inherit", "inherit", "inherit"] },
    );

    process.stderr.write("READY\n");

    child.on("close", code => {
      process.exit(code ?? 1);
    });
  });
});
