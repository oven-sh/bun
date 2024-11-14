//#FILE: test-cluster-call-and-destroy.js
//#SHA1: 840777cd738f6257dd874035b1c0291ebe16e326
//-----------------
"use strict";
const cluster = require("cluster");

if (cluster.isPrimary) {
  test("worker disconnection and destruction", () => {
    const worker = cluster.fork();

    return new Promise(resolve => {
      worker.on("disconnect", () => {
        expect(worker.isConnected()).toBe(false);
        worker.destroy();
        resolve();
      });
    });
  });
} else {
  test("worker connection in child process", () => {
    expect(cluster.worker.isConnected()).toBe(true);
    cluster.worker.disconnect();
  });
}

//<#END_FILE: test-cluster-call-and-destroy.js
