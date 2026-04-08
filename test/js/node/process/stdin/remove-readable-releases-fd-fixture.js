// After removing the last 'readable' listener, fd 0 must be released so a
// stdio:'inherit' child can read it exclusively.
const { spawn } = require("child_process");

const handler = () => {
  while (process.stdin.read() !== null) {}
};
process.stdin.on("readable", handler);

setImmediate(() => {
  process.stdin.removeListener("readable", handler);

  if (process.stdin.listenerCount("readable") !== 0) {
    process.stderr.write("FAIL: readable listener still attached\n");
    process.exit(1);
  }

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
