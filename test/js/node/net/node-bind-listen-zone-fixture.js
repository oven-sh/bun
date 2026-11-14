// The primary forks one worker. The worker listens with `net` or binds with `dgram` on each host, which
// makes the primary bind that address for it. The primary prints what the worker got for each one: the
// address, or the error.
const cluster = require("node:cluster");
const dgram = require("node:dgram");
const net = require("node:net");

// [["net" | "udp4" | "udp6", host], ...]
const binds = JSON.parse(process.argv[2]);

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.once("message", message => {
    console.log(JSON.stringify(message));
    worker.kill();
  });
} else {
  const settled = handle =>
    new Promise(resolve => {
      handle.once("error", err => resolve({ error: err.message }));
      handle.once("listening", () => {
        const { address, family } = handle.address();
        resolve({ address, family });
      });
    });

  (async () => {
    const results = [];
    for (const [kind, host] of binds) {
      const handle = kind === "net" ? net.createServer() : dgram.createSocket(kind);
      const result = settled(handle);
      if (kind === "net") handle.listen(0, host);
      else handle.bind(0, host);
      results.push(await result);
    }
    process.send(results);
  })();
}
