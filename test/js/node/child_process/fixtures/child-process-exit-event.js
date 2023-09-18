const { spawn } = require("node:child_process");

function exitHandler() {
  console.log("exithHandler called");
}
function closeHandler() {
  console.log("closeHandler called");
}

const p = spawn("bun", ["--version"]);

p.on("exit", exitHandler);
p.on("close", closeHandler);
