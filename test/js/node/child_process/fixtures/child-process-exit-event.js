const { spawn } = require("node:child_process");

function exitHandler() {
  console.log("exithHandler called");
}
function closeHandler() {
  console.log("closeHandler called");
}

let bunExe = process.execPath;
if ((process.versions.bun || "").endsWith("_debug")) {
  bunExe = "bun-debug";
} else if (bunExe.endsWith("node")) {
  bunExe = "bun";
}

const p = spawn(bunExe, ["--version"]);

p.on("exit", exitHandler);
p.on("close", closeHandler);
