// Multi-worker shared-fd traffic + close: exercises DGRAM_FDS Owned/Adopted
// and SharedHandle teardown. A regression removing the double-close guard
// would EBADF an IPC pipe and hang this fixture.
//
// Every worker adopting the primary's one descriptor is deterministic, so all
// four must reach 'listening' before anything is sent. Which worker then wins a
// given datagram is not: all four poll the same descriptor and the kernel
// arbitrates with no fairness promise, so demanding that each one receive hangs
// (on darwin x64 a worker stayed silent across ~15k retransmits; a fixed packet
// total stalled the same way). Traffic is asserted where it is guaranteed --
// the descriptor is readable from a worker -- and teardown, the point of the
// fixture, still runs with all four holding it.
import cluster from "node:cluster";
import dgram from "node:dgram";

const NUM_WORKERS = 4;
const SEND_INTERVAL_MS = 2;

if (cluster.isPrimary) {
  let listening = 0;
  let received = false;
  const workers: cluster.Worker[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) workers.push(cluster.fork());

  let stopSending = () => {};

  const watchdog = setTimeout(() => {
    stopSending();
    for (const w of workers) w.process.kill("SIGKILL");
    console.error(`timed out: ${listening}/${NUM_WORKERS} workers adopted, traffic received: ${received}`);
    process.exit(1);
  }, 20_000);
  watchdog.unref();

  cluster.on("listening", (_worker, address) => {
    // Send only once all four hold the descriptor, so teardown exercises four
    // adopted copies of it.
    if (++listening < NUM_WORKERS) return;
    // All workers share one fd; send everything at that port. The shared fd
    // binds INADDR_ANY, but sending to 0.0.0.0 is not portably deliverable.
    const sender = dgram.createSocket("udp4");
    const timer = setInterval(() => sender.send("hello", address.port, "127.0.0.1"), SEND_INTERVAL_MS);
    stopSending = () => {
      stopSending = () => {};
      clearInterval(timer);
      sender.close();
    };
  });

  for (const worker of workers) {
    worker.on("message", () => {
      if (received) return;
      received = true;
      stopSending();
      for (const w of workers) w.send("stop");
    });
  }

  let exited = 0;
  cluster.on("exit", (worker, code) => {
    // exitedAfterDisconnect separates a clean close+disconnect from an EBADF'd
    // IPC pipe: that bails out through child.ts's unexpected-disconnect path,
    // which also exits 0. Code alone would pass the double-close regression.
    if (code !== 0 || !worker.exitedAfterDisconnect) {
      console.error("worker exited with", code, "exitedAfterDisconnect:", worker.exitedAfterDisconnect);
      process.exit(1);
    }
    if (++exited < NUM_WORKERS) return;
    if (!received) {
      console.error("workers exited without reading from the shared descriptor");
      process.exit(1);
    }
    // Primary must exit cleanly once every worker's shared handle is released.
    // One string arg: a bare number would be inspected and colorized.
    console.log(`ok: all ${NUM_WORKERS} workers adopted and released the shared descriptor`);
    clearTimeout(watchdog);
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
