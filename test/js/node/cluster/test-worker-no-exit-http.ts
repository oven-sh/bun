const assert = require("assert");
const cluster = require("cluster");
const http = require("http");
import { patchEmitter } from "./common";

let destroyed;
let success;
let worker;
let server;

// Workers do not exit on disconnect, they exit under normal node rules: when
// they have nothing keeping their loop alive, like an active connection
//
// test this by:
//
// 1 creating a server, so worker can make a connection to something
// 2 disconnecting worker
// 3 wait to confirm it did not exit
// 4 destroy connection
// 5 confirm it does exit
if (cluster.isPrimary) {
  server = http
    .createServer(function (req, res) {
      server.close();
      worker.disconnect();
      worker
        .once("disconnect", function () {
          setTimeout(function () {
            req.destroy();
            destroyed = true;
          }, 1000);
        })
        .once("exit", function () {
          // Worker should not exit while it has a connection
          assert(destroyed, "worker exited before connection destroyed");
          success = true;
        });
    })
    .listen(0, function () {
      const port = this.address().port;

      worker = cluster.fork();
      worker.on("online", function () {
        this.send({ port });
      });
    });
  patchEmitter(server, "server");
  process.on("exit", function () {
    assert(success);
  });
} else {
  process.on("message", function (msg) {
    console.log(2, msg);
    // We shouldn't exit, not while a network connection exists
    const req = http.get(`http://localhost:${msg.port}/`, res => {
      console.log(4, res.constructor.name);
    });
    console.log(3, req.constructor.name);
  });
  console.log(1);
}
