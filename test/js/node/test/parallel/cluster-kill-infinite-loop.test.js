//#FILE: test-cluster-kill-infinite-loop.js
//#SHA1: 57e3a34549cfda35dea88a4c6cd87168ae00e842
//-----------------
"use strict";
const cluster = require("cluster");

test("cluster kill infinite loop", () => {
  if (cluster.isPrimary) {
    const worker = cluster.fork();

    worker.on("online", () => {
      // Use worker.process.kill() instead of worker.kill() because the latter
      // waits for a graceful disconnect, which will never happen.
      worker.process.kill();
    });

    return new Promise(resolve => {
      worker.on("exit", (code, signal) => {
        expect(code).toBeNull();
        expect(signal).toBe("SIGTERM");
        resolve();
      });
    });
  } else {
    while (true);
  }
});

//<#END_FILE: test-cluster-kill-infinite-loop.js
