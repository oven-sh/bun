// Simple test to see if trace events are being written
const fs = require("fs");
const path = require("path");
const tmpdir = require("os").tmpdir();

// Change to a temp directory
process.chdir(tmpdir);

// Simple program that should emit a few trace events
setTimeout(() => {
  console.log("Timer fired");
  process.exit(0);
}, 10);

process.on("exit", () => {
  console.log("Exit event");
  const file = path.join(tmpdir, "node_trace.1.log");
  console.log("Looking for trace file at:", file);
  console.log("File exists:", fs.existsSync(file));
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, "utf8");
    console.log("Trace file content:");
    console.log(content);
  }
});
