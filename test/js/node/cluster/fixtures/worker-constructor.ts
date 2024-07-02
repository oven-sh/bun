import assert from "node:assert";
import cluster from "node:cluster";

let worker;

worker = new cluster.Worker();
assert.strictEqual(worker.exitedAfterDisconnect, undefined);
assert.strictEqual(worker.state, "none");
assert.strictEqual(worker.id, 0);
assert.strictEqual(worker.process, undefined);

worker = new cluster.Worker({
  id: 3,
  state: "online",
  process: process,
});
assert.strictEqual(worker.exitedAfterDisconnect, undefined);
assert.strictEqual(worker.state, "online");
assert.strictEqual(worker.id, 3);
assert.strictEqual(worker.process, process);

worker = cluster.Worker.call({}, { id: 5 });
assert(worker instanceof cluster.Worker);
assert.strictEqual(worker.id, 5);
