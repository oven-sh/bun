const kind = process.env.WORKER_KIND;
if (kind === undefined) {
  const cluster = require("node:cluster");
  const lines = [];
  const kinds = ["requires-cluster", "net-only", "http-only", "net-then-cluster", "never-listens", "dgram-only", "dgram-exclusive", "dgram-not-a-worker"];
  let left = kinds.length;
  lines.push(`primary ${cluster.isPrimary} ${cluster.isWorker} ${"NODE_UNIQUE_ID" in process.env} ${Object.keys(cluster).sort().join()}`);
  for (const k of kinds) {
    const worker = cluster.fork({ WORKER_KIND: k });
    const seen = [];
    worker.on("online", () => seen.push("online"));
    worker.on("listening", address => seen.push(`listening ${typeof address.port} ${address.addressType}`));
    worker.on("message", message => seen.push(`message ${JSON.stringify(message)}`));
    worker.on("exit", code => {
      lines.push(`${k}: ${seen.sort().join(" | ")} | exit ${code}`);
      if (--left === 0) console.log(lines.sort().join("\n"));
    });
  }
} else {
  const had = "NODE_UNIQUE_ID" in process.env;
  const report = extra => {
    const cluster = require("node:cluster");
    process.send({ had, has: "NODE_UNIQUE_ID" in process.env, isWorker: cluster.isWorker, id: typeof cluster.worker?.id, state: cluster.worker?.state, same: cluster.worker?.process === process, keys: Object.keys(cluster).sort().join(), extra }, () => process.exit(0));
  };
  if (kind === "requires-cluster") {
    const cluster = require("node:cluster");
    report(`before listen ${cluster.worker.state}`);
  } else if (kind === "net-only") {
    const server = require("node:net").createServer(() => {});
    server.listen(0, () => report(`after ${"NODE_UNIQUE_ID" in process.env}`));
  } else if (kind === "http-only") {
    const server = require("node:http").createServer(() => {});
    server.listen(0, () => report(`after ${"NODE_UNIQUE_ID" in process.env}`));
  } else if (kind === "net-then-cluster") {
    const server = require("node:net").createServer(() => {});
    server.listen(0);
    const first = require("node:cluster");
    server.on("listening", () => report(`same object ${first === require("node:cluster")}`));
  } else if (kind === "dgram-only") {
    const socket = require("node:dgram").createSocket("udp4");
    socket.bind(0, "127.0.0.1", () => report(`after ${"NODE_UNIQUE_ID" in process.env} ${typeof socket.address().port}`));
  } else if (kind === "dgram-exclusive") {
    const socket = require("node:dgram").createSocket("udp4");
    socket.bind({ port: 0, address: "127.0.0.1", exclusive: true }, () => report(`after ${"NODE_UNIQUE_ID" in process.env} ${typeof socket.address().port}`));
  } else if (kind === "dgram-not-a-worker") {
    require("node:cluster").isWorker = false;
    const socket = require("node:dgram").createSocket("udp4");
    socket.bind(0, "127.0.0.1", () => report(`bound ${typeof socket.address().port}`));
  } else {
    setTimeout(() => report("no listen"), 20);
  }
}
