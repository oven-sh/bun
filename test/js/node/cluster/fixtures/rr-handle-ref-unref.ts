const cluster = require("cluster");
const net = require("net");
import { mustNotCall } from "../common";

cluster.schedulingPolicy = cluster.SCHED_RR;

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("exit", () => {});
} else {
  const server = net.createServer(mustNotCall());
  server.listen(0, () => {
    server.ref();
    server.unref();
    process.channel.unref();
  });
  server.unref();
}
