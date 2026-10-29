// The primary forks one worker. The worker listens with `net` and binds with `dgram` on the host, which
// makes the primary bind that address for it. The primary prints the addresses that the worker got, or
// the errors.
const cluster = require("node:cluster");
const dgram = require("node:dgram");
const net = require("node:net");

const [host, kinds] = process.argv.slice(2);

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.once("message", message => {
    console.log(JSON.stringify(message));
    worker.kill();
  });
} else {
  const settled = (handle, event) =>
    new Promise(resolve => {
      handle.once("error", err => resolve({ error: err.message }));
      handle.once(event, () => {
        const { address, family } = handle.address();
        resolve({ address, family });
      });
    });

  (async () => {
    const result = {};
    if (kinds.includes("net")) {
      const server = net.createServer();
      const listening = settled(server, "listening");
      server.listen(0, host);
      result.net = await listening;
    }
    if (kinds.includes("dgram")) {
      const socket = dgram.createSocket("udp6");
      const bound = settled(socket, "listening");
      socket.bind(0, host);
      result.dgram = await bound;
    }
    process.send(result);
  })();
}
