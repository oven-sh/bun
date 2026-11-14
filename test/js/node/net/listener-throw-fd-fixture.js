// usage: <drain|write>
// listener-throw-handle-callback-fixture.js for a net.Socket over a file descriptor: an extra stdio
// pipe of a child process. The child exits with 0 if the last bytes it reads are "PING".
// Runs unchanged under node.
const { spawn } = require("node:child_process");

const result = { events: [], destroyed: undefined, delivered: false };
process.on("exit", () => console.log(JSON.stringify(result)));
function boom() {
  result.events.push("throw");
  throw new Error("boom");
}

const reader = `
  let tail = "";
  require("node:fs")
    .createReadStream(null, { fd: 3 })
    .on("data", d => (tail = (tail + d.toString("latin1")).slice(-4)))
    .on("end", () => process.exit(tail === "PING" ? 0 : 1));
`;
const child = spawn(process.execPath, ["-e", reader], { stdio: ["ignore", "ignore", "inherit", "pipe"] });
child.on("exit", code => (result.delivered = code === 0));

const target = child.stdio[3];
target.on("error", e => {
  result.events.push("error:" + e.message);
  target.destroy();
});
target.on("close", hadError => result.events.push("close:" + hadError));
process.on("uncaughtException", e => {
  result.events.push("uncaught:" + e.message);
  result.destroyed = target.destroyed;
  target.end("PING");
});

// More than the pipe holds, so the write completes from the handle's writable callback.
const big = Buffer.alloc(4 * 1024 * 1024, "x");
if (process.argv[2] === "drain") {
  target.once("drain", boom);
  target.write(big);
} else {
  target.write(big, boom);
}
