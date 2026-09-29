// A worker reads a cluster-shared descriptor one datagram per receive call, so
// that the workers share the load. The bound of a readable event counts
// datagrams, not receive calls: a backlog of 100 still arrives 32 to an
// iteration of the event loop. The worker queues the backlog on its own socket
// and reports the datagrams of every iteration. The primary prints that report.
import cluster from "node:cluster";
import dgram from "node:dgram";
import { iterateUntil, iterationCounter } from "../../../_util/loop-iterations";

if (cluster.isPrimary) {
  const worker = cluster.fork();
  // Fail fast instead of hanging the harness.
  const watchdog = setTimeout(() => {
    worker.process.kill("SIGKILL");
    console.error("the worker did not report");
    process.exit(1);
  }, 15_000);
  watchdog.unref();
  worker.on("message", report => {
    console.log(JSON.stringify(report));
    worker.send("stop");
  });
  const code = await new Promise(resolve => worker.on("exit", resolve));
  if (code !== 0) throw new Error(`worker exited with ${code}`);
} else {
  const socket = dgram.createSocket("udp4");
  let received = iterationCounter();
  socket.on("message", () => received.count());
  process.on("message", message => {
    if (message !== "stop") return;
    socket.close();
    cluster.worker!.disconnect();
  });

  socket.bind({ port: 0, exclusive: false }, async () => {
    // The shared descriptor binds INADDR_ANY. Sending to 0.0.0.0 is not
    // portably deliverable, loopback is.
    const port = socket.address().port;
    const sender = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data() {}, error() {} } });
    const packets: (string | number)[] = [];
    for (let i = 0; i < 100; i++) packets.push("x", port, "127.0.0.1");

    // The bound shows only when the backlog was queued before the loop polled
    // the socket. A burst that arrived in full without that is sent again.
    for (let attempt = 1; ; attempt++) {
      received = iterationCounter();
      const sent = sender.sendMany(packets);
      if (sent !== 100) throw new Error(`sendMany accepted ${sent} of 100`);
      const finished = await iterateUntil(() => received.total === 100);
      const run = { finished, ...received.summary(), attempt };
      if (!finished || run.max >= 32 || attempt === 20) {
        sender.close();
        process.send!(run);
        return;
      }
    }
  });
}
