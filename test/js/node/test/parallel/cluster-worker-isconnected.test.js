//#FILE: test-cluster-worker-isconnected.js
//#SHA1: cf1e0243c030fe4cf872716099e517daec3efffc
//-----------------
"use strict";
const cluster = require("cluster");

if (cluster.isPrimary) {
  test("worker isConnected() in primary", () => {
    const worker = cluster.fork();

    expect(worker.isConnected()).toBe(true);

    worker.on("disconnect", () => {
      expect(worker.isConnected()).toBe(false);
    });

    worker.on("message", function (msg) {
      if (msg === "readyToDisconnect") {
        worker.disconnect();
      }
    });
  });
} else {
  test("worker isConnected() in worker", () => {
    function assertNotConnected() {
      expect(cluster.worker.isConnected()).toBe(false);
    }

    expect(cluster.worker.isConnected()).toBe(true);

    cluster.worker.on("disconnect", assertNotConnected);
    cluster.worker.process.on("disconnect", assertNotConnected);

    process.send("readyToDisconnect");
  });
}

//<#END_FILE: test-cluster-worker-isconnected.js
