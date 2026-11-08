// A worker's non-exclusive bind() sends the port as it is to the primary, and
// the primary binds the shared descriptor. Node's handle reads that port with
// ToUint32 and keeps the low 16 bits, so each spelling below is the first
// socket's port.
import cluster from "node:cluster";
import dgram from "node:dgram";

if (cluster.isPrimary) {
  // JSON cannot carry the BigInt of the last bind. The structured clone can.
  cluster.setupPrimary({ serialization: "advanced" });
  // The primary is not a worker: this socket binds here, without reuseAddr.
  const held = dgram.createSocket("udp4");
  await new Promise<void>(resolve => held.bind(0, "127.0.0.1", resolve));

  const worker = cluster.fork({ HELD_PORT: String(held.address().port) });
  const watchdog = setTimeout(() => {
    worker.process.kill("SIGKILL");
    console.error("timed out");
    process.exit(1);
  }, 15_000);
  watchdog.unref();
  let reported = false;
  worker.on("message", report => {
    reported = true;
    console.log(report);
    held.close();
    worker.process.kill();
  });
  // A worker that ends before its report fails the fixture at once, not at the watchdog.
  worker.on("exit", (code, signal) => {
    if (reported) return;
    console.error(`the worker ended before its report: code ${code}, signal ${signal}`);
    process.exit(1);
  });
} else {
  // The port the socket listens on, or the code of its 'error'.
  const bind = (port: unknown, reuseAddr: boolean) =>
    new Promise<number | string>(resolve => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr });
      socket.on("error", (error: NodeJS.ErrnoException) => resolve(error.code!));
      socket.bind({ port: port as number, address: "127.0.0.1" }, () => resolve(socket.address().port));
    });

  // reuseAddr: every socket of this loop binds the one port.
  const port = (await bind(0, true)) as number;
  const bound: Record<string, string | number> = {};
  // The primary keys its handles by the port as a string: no two spellings may print alike.
  for (const [spelling, spelled] of [
    ["String(port)", String(port)],
    ['port + ".5"', port + ".5"],
    ["port + 0.25", port + 0.25],
    ["port + 2 ** 32", port + 2 ** 32],
    // Node 26 binds a port that the system picks here: V8 before 15.8 reads a string
    // that is a negative integer as 0 (v8/v8@42bc03b82e). Not mirrored.
    ["String(port - 65536)", String(port - 65536)],
  ] as const) {
    const got = await bind(spelled, true);
    bound[spelling] = got === port ? "port" : got;
  }
  // A port that another socket holds is an error, not a bind of some other port.
  bound["a port that the primary holds"] = await bind(process.env.HELD_PORT, false);
  // Node converts a BigInt port in the primary and throws there. Here the primary
  // converts no port that can throw, so nothing that a worker sends ends it: the
  // port reads as 0. A primary that converted this one would find the port taken.
  const got = await bind(BigInt(process.env.HELD_PORT!), false);
  bound["that port as a BigInt"] = typeof got === "number" ? "a port that the system picks" : got;
  process.send!(JSON.stringify(bound));
}
