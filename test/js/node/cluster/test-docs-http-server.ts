import { isBroken, isWindows } from "harness";
import assert from "node:assert";
import cluster from "node:cluster";
import http from "node:http";
import { availableParallelism } from "node:os";

if (isWindows && isBroken) {
  console.log("Skipping on Windows because it does not work when there are more than 1 CPU");
  process.exit(0);
}

const numCPUs = availableParallelism();
let workers = 0;

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("message", (_, msg) => {
    assert.strictEqual(msg, "hello");
    workers += 1;
  });
  cluster.on("exit", (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
  });
  process.on("exit", code => {
    assert.strictEqual(code, 0);
    assert.strictEqual(workers, numCPUs);
  });
} else {
  // Workers can share any TCP connection
  // In this case it is an HTTP server
  const server = http
    .createServer((req, res) => {
      res.writeHead(200);
      res.end("hello world\n");
    })
    .listen(8000, () => {
      process.send("hello");
      server.close();

      process.disconnect();
    });

  console.log(`Worker ${process.pid} started`);
}
