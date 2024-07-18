const net = require("net");
const cluster = require("cluster");

cluster.schedulingPolicy = cluster.SCHED_NONE;

if (cluster.isPrimary) {
  const worker = cluster.fork();

  // This is the important part of the test: Confirm that `disconnect` fires.
  worker.on("disconnect", () => {});

  // These are just some extra stuff we're checking for good measure...
  worker.on("exit", () => {});
  cluster.on("exit", () => {});

  cluster.disconnect();
  return;
}

const server = net.createServer();

server.listen(0);
