// test-cluster-worker-init.js
// verifies that, when a child process is forked, the cluster.worker
// object can receive messages as expected

function patchEmitter(emitter, prefix) {
  var oldEmit = emitter.emit;

  emitter.emit = function () {
    console.log([prefix, ...arguments]);
    oldEmit.apply(emitter, arguments);
  };
}

const assert = require("assert");
const cluster = require("cluster");
const msg = "foo";

if (cluster.isPrimary) {
  const worker = cluster.fork();
  patchEmitter(worker, "worker");

  worker.on("message", message => {
    assert.strictEqual(message, true);
    const w = worker.disconnect();
    assert.strictEqual(worker, w);
  });

  worker.on("online", () => {
    worker.send(msg);
  });
} else {
  // https://github.com/nodejs/node-v0.x-archive/issues/7998
  cluster.worker.on("message", message => {
    process.send(message === msg);
  });
}
