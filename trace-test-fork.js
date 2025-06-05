const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const tmpdir = path.join("/tmp", "trace-test-fork-" + Date.now());
fs.mkdirSync(tmpdir, { recursive: true });

console.log("Running child in:", tmpdir);

// Create a child script file
const childScript = path.join(tmpdir, "child.js");
fs.writeFileSync(
  childScript,
  `
console.log('Child process started in:', process.cwd());
setTimeout(() => {}, 1);
setImmediate(() => {});
`,
);

const proc = cp.fork(childScript, [], {
  cwd: tmpdir,
  execArgv: ["--trace-event-categories", "node.environment"],
});

proc.on("exit", () => {
  console.log("Child exited");
  const files = fs.readdirSync(tmpdir);
  console.log("Files in tmpdir:", files);

  // Also check parent directory
  const parentFiles = fs.readdirSync(".").filter(f => f.startsWith("node_trace"));
  console.log("Trace files in parent:", parentFiles);

  fs.rmSync(tmpdir, { recursive: true });
});
