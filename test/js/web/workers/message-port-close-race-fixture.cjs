// N ports are handed to a worker. For each one the main thread posts K messages and closes its
// end while the worker attaches that port in one of four ways. A barrier on a
// SharedArrayBuffer lines the two threads up per port, and a clock-based delay (argv[4], in
// nanoseconds) moves the close across the attach.
// The worker prints one JSON line when it ends: `bad` counts the ports that did not get their K
// messages and then exactly one 'close'. Nothing calls terminate() or process.exit().
const { Worker, MessageChannel, receiveMessageOnPort, isMainThread, workerData } = require("node:worker_threads");
const fs = require("node:fs");

const SPIN = 20000;
// The fourth kind of port listens for 'close' alone, so it gets nothing to read.
const messagesFor = (i, K) => ((i & 3) === 3 ? 0 : K);

if (isMainThread) {
  const N = +process.argv[2];
  const K = +process.argv[3];
  const sweepNs = +process.argv[4];
  const flag = new Int32Array(new SharedArrayBuffer(16));
  const channels = Array.from({ length: N }, () => new MessageChannel());
  const ports = channels.map(channel => channel.port2);
  const worker = new Worker(__filename, { workerData: { ports, flag, K }, transferList: ports });
  worker.on("error", error => {
    console.log("worker error", error);
    process.exitCode = 3;
  });
  const go = () => {
    if (Atomics.load(flag, 0) !== 1) return setImmediate(go);
    for (let i = 0; i < N; i++) {
      const port = channels[i].port1;
      for (let j = 0; j < messagesFor(i, K); j++) port.postMessage(j);
      // Wait until the worker is at port i, then let it attach.
      for (let n = 0; Atomics.load(flag, 2) < i + 1;) if (++n > SPIN) Atomics.wait(flag, 2, i, 1);
      Atomics.store(flag, 0, i + 2);
      Atomics.notify(flag, 0);
      const until = Bun.nanoseconds() + (((i * 37) % 64) * sweepNs) / 64;
      while (Bun.nanoseconds() < until);
      port.close();
    }
  };
  go();
} else {
  const { ports, flag, K } = workerData;
  const N = ports.length;
  const got = new Array(N).fill(0);
  const closes = new Array(N).fill(0);
  let misordered = 0;
  let afterClose = 0;
  process.on("exit", () => {
    let bad = 0;
    for (let i = 0; i < N; i++) if (got[i] !== messagesFor(i, K) || closes[i] !== 1) bad++;
    fs.writeSync(1, JSON.stringify({ N, bad, misordered, afterClose }) + "\n");
  });
  const onMessage = i => message => {
    if (closes[i]) afterClose++;
    if (message !== got[i]) misordered++;
    got[i]++;
  };
  Atomics.store(flag, 0, 1);
  for (let i = 0; i < N; i++) {
    const port = ports[i];
    Atomics.store(flag, 2, i + 1);
    Atomics.notify(flag, 2);
    for (let n = 0; Atomics.load(flag, 0) < i + 2;) if (++n > SPIN) Atomics.wait(flag, 0, i + 1, 1);
    const onClose = () => closes[i]++;
    switch (i & 3) {
      case 0: {
        port.on("close", onClose);
        port.on("message", onMessage(i));
        break;
      }
      case 1: {
        // One message at a time: the listener removes itself and comes back a turn later.
        const deliver = onMessage(i);
        const take = message => {
          deliver(message);
          port.off("message", take);
          setImmediate(() => port.on("message", take));
        };
        port.on("message", take);
        port.on("close", onClose);
        break;
      }
      case 2: {
        const deliver = onMessage(i);
        port.on("close", onClose);
        const poll = () => {
          let entry;
          while ((entry = receiveMessageOnPort(port)) !== undefined) deliver(entry.message);
          if (!closes[i]) setImmediate(poll);
        };
        poll();
        break;
      }
      default:
        port.on("close", onClose);
    }
  }
}
