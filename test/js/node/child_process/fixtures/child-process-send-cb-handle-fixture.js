// Prints the order of the callback of a send() with a handle and of a setImmediate() queued
// after that send(). The child reads nothing of the channel before the file argv[2] exists.
const { fork } = require("child_process");
const fs = require("fs");
const net = require("net");

if (process.argv[3] === "child") {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(process.argv[2])) Atomics.wait(pause, 0, 0, 1);
  process.on("message", (message, handle) => {
    handle.close();
    process.disconnect();
  });
} else {
  const order = [];
  const child = fork(__filename, [process.argv[2], "child"]);
  const server = net.createServer();
  server.listen(0, () => {
    child.send({}, server, () => {
      order.push("callback");
      server.close();
    });
    setImmediate(() => {
      order.push("setImmediate");
      fs.writeFileSync(process.argv[2], "");
    });
  });
  child.on("exit", () => console.log(JSON.stringify(order)));
}
