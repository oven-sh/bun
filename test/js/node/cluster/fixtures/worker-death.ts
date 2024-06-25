import assert from "node:assert";
import cluster from "node:cluster";

if (!cluster.isPrimary) {
  process.exit(42);
} else {
  const worker = cluster.fork();
  worker.on("exit", function (exitCode, signalCode) {
    assert.strictEqual(exitCode, 42);
    assert.strictEqual(signalCode, null);
  });
  cluster.on("exit", function (worker_) {
    assert.strictEqual(worker_, worker);
  });
}
