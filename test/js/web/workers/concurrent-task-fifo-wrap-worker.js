let sab;
let received = [];

self.onmessage = e => {
  const msg = e.data;
  if (msg.kind === "init") {
    sab = new Int32Array(msg.sab);
    self.postMessage({ kind: "ready" });
    // Block here until main has posted the entire first burst. This
    // guarantees all N messages are in concurrent_tasks before the next
    // tickConcurrent pops them, so they land in the tasks FIFO as one batch
    // regardless of thread scheduling.
    while (Atomics.load(sab, 3) === 0) {}
    return;
  }
  if (msg.kind === "finalize") {
    self.postMessage({ kind: "done", received: received.slice().sort((a, b) => a - b) });
    return;
  }

  const id = msg.id;
  received.push(id);

  // Messages 0..(reenterDepth-1) each force a reentrant tick() via an
  // HTMLRewriter async element handler. Each level of reentrancy advances the
  // tasks FIFO head by one before the inner tickConcurrent runs, widening the
  // gap between writableSlice(0) and writableLength.
  if (id < msg.reenterDepth) {
    if (id === msg.reenterDepth - 1) {
      // Deepest reentrant level: tell main to post the second burst, then
      // spin until it has. The second burst lands in the worker's
      // concurrent_tasks queue before waitForPromise -> tickConcurrent pops
      // it.
      Atomics.store(sab, 0, 1);
      Atomics.notify(sab, 0);
      while (Atomics.load(sab, 1) === 0) {}
    }
    new HTMLRewriter()
      .on("*", {
        async element() {
          await 0;
        },
      })
      .transform("<b>x</b>");
    if (id === msg.reenterDepth - 1) {
      // waitForPromise has returned: the reentrant tick has processed every
      // task it was going to. Tell main it can send the finalize probe now.
      Atomics.store(sab, 2, 1);
      Atomics.notify(sab, 2);
    }
  }
};
