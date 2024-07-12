const assert = require("assert");
const cluster = require("cluster");
const net = require("net");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("exit", (code, signal) => {
    assert.strictEqual(code, 0, `Worker exited with an error code: ${code}`);
    assert(!signal, `Worker exited by a signal: ${signal}`);
    server.close();
  });

  const server = net.createServer(socket => {
    worker.send("handle", socket);
  });

  server.listen(0, () => {
    worker.send({ message: "listen", port: server.address().port });
  });
} else {
  process.on("message", (msg, handle) => {
    if (msg.message && msg.message === "listen") {
      assert(msg.port);
      const client1 = net.connect(
        {
          host: "localhost",
          port: msg.port,
        },
        () => {
          const client2 = net.connect(
            {
              host: "localhost",
              port: msg.port,
            },
            () => {
              client1.on("close", onclose);
              client2.on("close", onclose);
              client1.end();
              client2.end();
            },
          );
        },
      );
      let waiting = 2;
      const onclose = () => {
        if (--waiting === 0) cluster.worker.disconnect();
      };
    } else {
      process.send("reply", handle);
    }
  });
}
