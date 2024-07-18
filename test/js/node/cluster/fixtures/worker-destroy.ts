import assert from "assert";
import cluster from "cluster";
import { patchEmitter } from "../common";
let worker1, worker2;

if (cluster.isPrimary) {
  worker1 = cluster.fork();
  worker2 = cluster.fork();

  [worker1, worker2].forEach(function (worker) {
    patchEmitter(worker, "worker");
    worker.on("disconnect", () => {});
    worker.on("exit", () => {});
  });
} else if (cluster.worker.id === 1) {
  // Call destroy when worker is disconnected
  cluster.worker.process.on("disconnect", function () {
    cluster.worker.destroy();
  });

  const w = cluster.worker.disconnect();
  assert.strictEqual(w, cluster.worker);
} else {
  // Call destroy when worker is not disconnected yet
  cluster.worker.destroy();
}
