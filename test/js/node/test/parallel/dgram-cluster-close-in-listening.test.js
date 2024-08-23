//#FILE: test-dgram-cluster-close-in-listening.js
//#SHA1: f288642fce76ef0138f8e44cd8eb09ded9dc4640
//-----------------
"use strict";
// Ensure that closing dgram sockets in 'listening' callbacks of cluster workers
// won't throw errors.

const dgram = require("dgram");
const cluster = require("cluster");

if (process.platform === "win32") {
  it.skip("dgram clustering is currently not supported on windows.", () => {});
} else {
  if (cluster.isPrimary) {
    test("Primary cluster forks workers", () => {
      for (let i = 0; i < 3; i += 1) {
        expect(() => cluster.fork()).not.toThrow();
      }
    });
  } else {
    test("Worker handles dgram socket lifecycle", done => {
      const socket = dgram.createSocket("udp4");

      socket.on("error", () => {
        done(new Error("Error event should not be called"));
      });

      socket.on("listening", () => {
        socket.close();
      });

      socket.on("close", () => {
        cluster.worker.disconnect();
        done();
      });

      socket.bind(0);
    });
  }
}

//<#END_FILE: test-dgram-cluster-close-in-listening.js
