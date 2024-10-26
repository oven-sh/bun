const path = require("node:path");
const child_process = require("node:child_process");

console.log("p start");

const child = child_process.spawn(process.argv[2], [path.resolve(import.meta.dirname, "ipc-child-bun.js")], {
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
child.on("message", message => {
  console.log("p", message);
  process.exit(0);
});

setTimeout(() => child.send("I am your father"), 500);
console.log("p end");
