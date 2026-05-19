// https://github.com/oven-sh/bun/issues/20642
// Worker processes must exit after cluster.worker.disconnect() when they
// have an active net.Server. Previously the faux round-robin handle's
// owner_symbol was not shared with net, so Worker#_disconnect could never
// find the owning server to close, its waitingCount never reached zero,
// and process.disconnect() was never called.
import cluster from "cluster";
import net from "net";

if (cluster.isPrimary) {
  let exited = 0;
  const total = 2;

  for (let i = 0; i < total; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    if (code !== 0 || signal) {
      console.error(`worker ${worker.process.pid} bad exit code=${code} signal=${signal}`);
      process.exit(1);
    }
    exited++;
    console.log(`[master] worker ${worker.process.pid} exited`);
    if (exited === total) {
      console.log("[master] all workers exited");
    }
  });
} else {
  const server = net.createServer(socket => {
    socket.write(`hello from worker ${process.pid}\n`);
    socket.end();
  });

  server.listen(0, () => {
    const address = server.address();
    if (!address || typeof address !== "object") throw new Error("no address");
    console.log(`[worker ${process.pid}] listening`);
    const client = net.connect(address.port, () => {
      client.on("data", () => {});
      client.on("end", () => {
        console.log(`[worker ${process.pid}] disconnecting`);
        cluster.worker!.disconnect();
        server.close();
      });
    });
  });
}
