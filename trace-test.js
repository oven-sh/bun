const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const tmpdir = path.join("/tmp", "trace-test-" + Date.now());
fs.mkdirSync(tmpdir, { recursive: true });

console.log("Running child in:", tmpdir);

const proc = cp.spawn(
  process.execPath,
  ["--trace-event-categories", "node.environment", "-e", "setTimeout(() => {}, 1); setImmediate(() => {})"],
  { cwd: tmpdir },
);

proc.on("exit", () => {
  console.log("Child exited");
  const files = fs.readdirSync(tmpdir);
  console.log("Files in tmpdir:", files);

  // Also check parent directory
  const parentFiles = fs.readdirSync(".").filter(f => f.startsWith("node_trace"));
  console.log("Trace files in parent:", parentFiles);

  fs.rmSync(tmpdir, { recursive: true });
});
