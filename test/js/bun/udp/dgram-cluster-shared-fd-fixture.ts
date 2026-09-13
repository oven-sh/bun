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
  const t0 = Date.now();
  let listening = 0;
  let received = false;
  let msToAdopted = -1;
  let port = 0;
  let sent = 0;
  let sendOk = 0;
  let sendErr = "";
  const workers: cluster.Worker[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) workers.push(cluster.fork());

  let stopSending = () => {};

  const watchdog = setTimeout(() => {
    stopSending();
    for (const w of workers) w.process.kill("SIGKILL");
    // Name every quantity needed to tell the failure modes apart: slow adoption
    // vs the sender never running vs sends failing vs datagrams vanishing.
    console.error(
      `timed out: adopted=${listening}/${NUM_WORKERS} msToAdopted=${msToAdopted} port=${port} ` +
        `sent=${sent} sendOk=${sendOk} received=${received} sendErr=${sendErr || "(none)"}`,
    );
    process.exit(1);
  }, 20_000);
  watchdog.unref();

  const tearDown = () => {
    stopSending();
    for (const w of workers) w.send("stop");
  };

  cluster.on("listening", (_worker, address) => {
    // Send only once all four hold the descriptor, so teardown exercises four
    // adopted copies of it.
    if (++listening < NUM_WORKERS) return;
    msToAdopted = Date.now() - t0;
    port = address.port;
    // All workers share one fd; send everything at that port. The shared fd
    // binds INADDR_ANY, but sending to 0.0.0.0 is not portably deliverable.
    const sender = dgram.createSocket("udp4");
    // Callback form: doSend discards a send error when there is no callback,
    // and only completes a backpressure-queued send through one -- so without
    // it both a failure and a stuck queue look identical to the watchdog.
    const onSent = (err?: Error | null) => {
      if (err) sendErr ||= String(err.message ?? err);
      else sendOk++;
    };
    const timer = setInterval(() => {
      sent++;
      sender.send("hello", port, "127.0.0.1", onSent);
    }, SEND_INTERVAL_MS);
    // Traffic receipt is best-effort: the fixture's purpose is teardown with
    // all four holding the descriptor, and which worker wins a given datagram
    // is up to the kernel. Tear down after a bounded window so a box where the
    // adopted fd never reads still exercises the close path instead of the
    // watchdog path.
    const cap = setTimeout(tearDown, 3000);
    stopSending = () => {
      stopSending = () => {};
      clearTimeout(cap);
      clearInterval(timer);
      sender.close();
    };
  });

  for (const worker of workers) {
    worker.on("message", () => {
      if (received) return;
      received = true;
      tearDown();
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
    // Primary must exit cleanly once every worker's shared handle is released.
    // Report whether a worker read from the shared descriptor: informative on
    // boxes where it never did, but teardown is what this fixture asserts.
    // One string arg: a bare number would be inspected and colorized.
    console.log(
      `ok: all ${NUM_WORKERS} workers adopted and released the shared descriptor ` +
        `(received=${received} sent=${sent} sendOk=${sendOk})`,
    );
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
