// The server of a cluster worker has the keepAlive options. The primary accepts a connection and hands it to the
// worker, which prints what the kernel has for that socket.
import cluster from "node:cluster";
import net from "node:net";
import { keepAliveOf } from "./node-net-keepalive-kernel";

if (cluster.isPrimary) {
  cluster.schedulingPolicy = cluster.SCHED_RR;
  const worker = cluster.fork();
  let client: net.Socket | undefined;
  worker.on("message", (message: { port?: number }) => {
    if (message.port) {
      client = net.connect(message.port, "127.0.0.1");
      client.on("error", error => {
        console.error(error);
        process.exit(1);
      });
      return;
    }
    console.log(JSON.stringify(message));
    client!.destroy();
    worker.kill();
  });
  worker.on("exit", () => process.exit(0));
} else {
  const server = net.createServer({ keepAlive: true, keepAliveInitialDelay: 5000 }, socket => {
    const fromTheServer = keepAliveOf(socket);
    // @ts-expect-error `@types/node` has the two parameters of Node.js v26.3.0 only
    socket.setKeepAlive(true, 6000, 3000, 7);
    const interval = keepAliveOf(socket);
    // @ts-expect-error
    socket.setKeepAlive({ enable: false });
    process.send!({ fromTheServer, interval, off: keepAliveOf(socket) });
  });
  server.listen(0, "127.0.0.1", () => process.send!({ port: (server.address() as net.AddressInfo).port }));
}
