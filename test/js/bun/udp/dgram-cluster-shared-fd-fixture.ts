// Multi-worker shared-fd traffic + close: exercises DGRAM_FDS Owned/Adopted
// and SharedHandle teardown. Unlike Node's test-cluster-dgram-1 this does not
// assert per-worker counts — Bun batches recvmmsg so distribution is uneven.
import cluster from "node:cluster";
import dgram from "node:dgram";

const NUM_WORKERS = 4;
const TOTAL_PACKETS = 40;

if (cluster.isPrimary) {
  let listening = 0;
  let received = 0;
  const workers: cluster.Worker[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) workers.push(cluster.fork());

  const watchdog = setTimeout(() => {
    for (const w of workers) w.process.kill("SIGKILL");
    console.error("timed out: workers received", received, "of", TOTAL_PACKETS);
    process.exit(1);
  }, 30_000);
  watchdog.unref();

  cluster.on("listening", (_worker, address) => {
    if (++listening < NUM_WORKERS) return;
    // All workers share one fd; send everything at that port. The shared fd
    // binds INADDR_ANY, but sending to 0.0.0.0 is not portably deliverable.
    const sender = dgram.createSocket("udp4");
    let sent = 0;
    (function next() {
      sender.send("hello", address.port, "127.0.0.1", () => {
        if (++sent < TOTAL_PACKETS) next();
        else sender.close();
      });
    })();
  });

  for (const worker of workers) {
    worker.on("message", (msg: { got: number }) => {
      received += msg.got;
      if (received >= TOTAL_PACKETS) {
        for (const w of workers) w.send("stop");
      }
    });
  }

  let exited = 0;
  cluster.on("exit", (_worker, code) => {
    if (code !== 0) {
      console.error("worker exited with", code);
      process.exit(1);
    }
    if (++exited === NUM_WORKERS) {
      // Primary must exit cleanly once every worker's shared handle is released.
      console.log("ok: workers received", received, "packets across", NUM_WORKERS, "workers");
      clearTimeout(watchdog);
    }
  });
} else {
  const socket = dgram.createSocket("udp4");
  let got = 0;
  socket.on("message", () => {
    got++;
    process.send!({ got: 1 });
  });
  process.on("message", msg => {
    if (msg === "stop") {
      socket.close();
      cluster.worker!.disconnect();
    }
  });
  // Non-exclusive: routes through the primary for a shared descriptor.
  socket.bind(0);
}
