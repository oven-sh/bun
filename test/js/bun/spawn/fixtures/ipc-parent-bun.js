const path = require("node:path");

console.log("p start");
const child = Bun.spawn(["node", path.resolve(import.meta.dir, "ipc-child-node.js")], {
  ipc(message) {
    console.log("p", message);
    process.exit(0);
  },
  stdio: ["ignore", "inherit", "inherit"],
  serialization: "json",
});

child.send("I am your father");
console.log("p end");
