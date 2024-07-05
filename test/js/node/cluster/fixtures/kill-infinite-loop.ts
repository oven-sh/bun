const cluster = require("cluster");
const assert = require("assert");

if (cluster.isPrimary) {
  const worker = cluster.fork();

  worker.on("online", () => {
    // Use worker.process.kill() instead of worker.kill() because the latter
    // waits for a graceful disconnect, which will never happen.
    worker.process.kill();
  });

  worker.on("exit", (code, signal) => {
    assert.strictEqual(code, null);
    assert.strictEqual(signal, "SIGTERM");
  });
} else {
  while (true);
}
