//#FILE: test-cluster-dgram-reuse.js
//#SHA1: b7bfc0764ebc95fa5ef85ce1d860aebd3f7df539
//-----------------
"use strict";

const cluster = require("cluster");
const dgram = require("dgram");

if (process.platform === "win32") {
  test.skip("dgram clustering is currently not supported on windows.");
} else {
  if (cluster.isPrimary) {
    test("Primary process", () => {
      const worker = cluster.fork();
      worker.on("exit", code => {
        expect(code).toBe(0);
      });
    });
  } else {
    test("Worker process", async () => {
      let waiting = 2;
      function close() {
        if (--waiting === 0) cluster.worker.disconnect();
      }

      const options = { type: "udp4", reuseAddr: true };
      const socket1 = dgram.createSocket(options);
      const socket2 = dgram.createSocket(options);

      await new Promise(resolve => {
        socket1.bind(0, () => {
          socket2.bind(socket1.address().port, () => {
            // Work around health check issue
            process.nextTick(() => {
              socket1.close(close);
              socket2.close(close);
              resolve();
            });
          });
        });
      });
    });
  }
}

//<#END_FILE: test-cluster-dgram-reuse.js
