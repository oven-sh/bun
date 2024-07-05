const assert = require("assert");
const cluster = require("cluster");
const net = require("net");
import { mustNotCall } from "../common";

if (cluster.isPrimary) {
  // Ensure that the worker exits peacefully
  cluster.fork().on("exit", function (statusCode) {
    assert.strictEqual(statusCode, 0);
  });
} else {
  // listen() without port should not trigger a libuv assert
  net.createServer(mustNotCall()).listen(process.exit);
}
