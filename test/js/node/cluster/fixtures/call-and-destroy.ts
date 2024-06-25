const cluster = require("cluster");
const assert = require("assert");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("disconnect", () => {
    assert.strictEqual(worker.isConnected(), false);
    worker.destroy();
  });
} else {
  assert.strictEqual(cluster.worker.isConnected(), true);
  cluster.worker.disconnect();
}
