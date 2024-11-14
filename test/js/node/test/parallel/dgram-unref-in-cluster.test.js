//#FILE: test-dgram-unref-in-cluster.js
//#SHA1: eca71c33b1bf5be34a28e6cc82df49c73e775153
//-----------------
"use strict";

const dgram = require("dgram");
const cluster = require("cluster");

if (process.platform === "win32") {
  test.skip("dgram clustering is currently not supported on Windows.");
} else {
  if (cluster.isPrimary) {
    test("dgram unref in cluster", () => {
      cluster.fork();
    });
  } else {
    test("dgram unref in cluster worker", () => {
      const socket = dgram.createSocket("udp4");
      socket.unref();
      socket.bind();

      return new Promise(resolve => {
        socket.on("listening", () => {
          const sockets = process.getActiveResourcesInfo().filter(item => {
            return item === "UDPWrap";
          });
          expect(sockets.length).toBe(0);
          process.disconnect();
          resolve();
        });
      });
    });
  }
}

//<#END_FILE: test-dgram-unref-in-cluster.js
