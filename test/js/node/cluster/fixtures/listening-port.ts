const assert = require("assert");
const cluster = require("cluster");
const net = require("net");
import { mustNotCall, patchEmitter } from "../common";

if (cluster.isPrimary) {
  patchEmitter(cluster, "cluster");
  cluster.fork();
  cluster.on("listening", function (worker, address) {
    const port = address.port;
    // Ensure that the port is not 0 or null
    assert(port);
    // Ensure that the port is numerical
    assert.strictEqual(typeof port, "number");
    worker.kill();
  });
} else {
  const s = net.createServer(mustNotCall()).listen(0);
  patchEmitter(s, "server");
}
