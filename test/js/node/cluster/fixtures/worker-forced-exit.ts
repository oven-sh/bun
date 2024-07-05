"use strict";
const assert = require("assert");
const cluster = require("cluster");

const SENTINEL = 42;

// Workers forcibly exit when control channel is disconnected, if
// their .exitedAfterDisconnect flag isn't set
//
// test this by:
//
// 1 setup worker to wait a short time after disconnect, and exit
//   with a sentinel value
// 2 disconnect worker with cluster's disconnect, confirm sentinel
// 3 disconnect worker with child_process's disconnect, confirm
//   no sentinel value
if (cluster.isWorker) {
  process.on("disconnect", msg => {
    setTimeout(() => process.exit(SENTINEL), 10);
  });
  return;
}

checkUnforced();
checkForced();

function checkUnforced() {
  const worker = cluster.fork();
  worker
    .on("online", () => worker.disconnect())
    .on("exit", status => {
      assert.strictEqual(status, SENTINEL);
    });
}

function checkForced() {
  const worker = cluster.fork();
  worker.on("online", () => worker.process.disconnect()).on("exit", status => assert.strictEqual(status, 0));
}
