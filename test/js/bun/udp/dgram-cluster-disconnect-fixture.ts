// A cluster worker that binds a shared (non-exclusive) dgram socket and then
// disconnects itself must exit: the shared wrap's close callback drives
// cluster's disconnect refcount (checkWaitingCount).
import cluster from "node:cluster";
import dgram from "node:dgram";

if (cluster.isPrimary) {
  const worker = cluster.fork();
  // Fail fast instead of hanging the (synchronous) toRun() harness matcher.
  const watchdog = setTimeout(() => {
    worker.process.kill("SIGKILL");
    console.error("worker did not exit after disconnect");
    process.exit(1);
  }, 15_000);
  watchdog.unref();
  const code = await new Promise(resolve => worker.on("exit", resolve));
  if (code !== 0) throw new Error(`worker exited with ${code}`);
} else {
  const socket = dgram.createSocket("udp4");
  socket.bind({ port: 0, exclusive: false }, () => {
    cluster.worker!.disconnect();
  });
}
