const http = require("http");
const cluster = require("cluster");
const assert = require("assert");
import { patchEmitter } from "../common";

cluster.schedulingPolicy = cluster.SCHED_RR;

const server = http.createServer();
patchEmitter(server, "server");

if (cluster.isPrimary) {
  server.listen({ port: 0 }, () => {
    const port = server.address().port;
    const worker = cluster.fork({ PORT: port });
    worker.on("exit", () => {
      server.close();
    });
  });
} else {
  assert(process.env.PORT);
  process.on("uncaughtException", () => {});
  server.listen(process.env.PORT);
  server.on("error", e => {
    cluster.worker.disconnect();
    throw e;
  });
}
