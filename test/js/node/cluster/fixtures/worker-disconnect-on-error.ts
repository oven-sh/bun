import http from "http";
import cluster from "cluster";
import assert from "assert";

cluster.schedulingPolicy = cluster.SCHED_NONE;

const server = http.createServer();
if (cluster.isPrimary) {
  let worker;

  server.listen(0, () => {
    assert(worker);

    worker.send({ port: server.address().port });
  });

  worker = cluster.fork();
  worker.on("exit", () => {
    server.close();
  });
} else {
  process.on("message", msg => {
    assert(msg.port);

    server.listen(msg.port);
    server.on("error", e => {
      cluster.worker.disconnect();
    });
  });
}
