const cluster = require("cluster");
const net = require("net");
import { mustNotCall } from "../common";

if (cluster.isPrimary) {
  cluster.fork().on("message", function (msg) {
    if (msg === "done") this.kill();
  });
} else {
  const server = net.createServer(mustNotCall());
  server.listen(0, function () {
    server.unref();
    server.ref();
    server.close(function () {
      process.send("done");
    });
  });
}
