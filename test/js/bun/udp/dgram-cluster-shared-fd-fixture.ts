// Multi-worker shared-fd traffic + close: exercises DGRAM_FDS Owned/Adopted
// and SharedHandle teardown. A regression removing the double-close guard
// would EBADF an IPC pipe and hang this fixture.
//
// The invariant is that every worker can read from the one shared descriptor,
// not that any particular datagram lands: UDP may drop, and which of the
// readers wins a given packet is up to the kernel. So the sender retransmits
// on an interval until each worker has reported its first packet, and each
// worker reports exactly once -- a per-packet report makes the run a test of
// IPC throughput rather than of the shared descriptor.
import cluster from "node:cluster";
import dgram from "node:dgram";

const NUM_WORKERS = 4;
const SEND_INTERVAL_MS = 2;

if (cluster.isPrimary) {
  let listening = 0;
  const reported = new Set<number>();
  const workers: cluster.Worker[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) workers.push(cluster.fork());

  const watchdog = setTimeout(() => {
    for (const w of workers) w.process.kill("SIGKILL");
    console.error("timed out: workers that received traffic:", [...reported].join(",") || "(none)");
    process.exit(1);
  }, 30_000);
  watchdog.unref();

  let stopSending = () => {};

  cluster.on("listening", (_worker, address) => {
    if (++listening < NUM_WORKERS) return;
    // All workers share one fd; send everything at that port. The shared fd
    // binds INADDR_ANY, but sending to 0.0.0.0 is not portably deliverable.
    const sender = dgram.createSocket("udp4");
    const timer = setInterval(() => sender.send("hello", address.port, "127.0.0.1"), SEND_INTERVAL_MS);
    stopSending = () => {
      clearInterval(timer);
      sender.close();
    };
  });

  let stopped = false;
  for (const worker of workers) {
    worker.on("message", (msg: { id: number }) => {
      reported.add(msg.id);
      if (reported.size < NUM_WORKERS || stopped) return;
      stopped = true;
      stopSending();
      for (const w of workers) w.send("stop");
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
      console.log("ok: all", NUM_WORKERS, "workers received traffic on the shared descriptor");
      clearTimeout(watchdog);
    }
  });
} else {
  const socket = dgram.createSocket("udp4");
  const id = cluster.worker!.id;
  let announced = false;
  socket.on("message", () => {
    if (announced) return;
    announced = true;
    process.send!({ id });
  });
  let stopping = false;
  process.on("message", msg => {
    if (msg !== "stop" || stopping) return;
    stopping = true;
    socket.close();
    cluster.worker!.disconnect();
  });
  // Non-exclusive: routes through the primary for a shared descriptor.
  socket.bind(0);
}
