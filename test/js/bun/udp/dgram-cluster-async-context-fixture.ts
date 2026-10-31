// The AsyncLocalStorage store that 'listening' and 'message' run in for the sockets of a cluster worker.
// A bind that goes through the primary gives the socket the handle the primary sent: node swaps it in
// (replaceHandle() in lib/dgram.js), so the store of createSocket() is not that handle's. An exclusive bind keeps the
// socket's own handle.
import { AsyncLocalStorage } from "node:async_hooks";
import cluster from "node:cluster";
import dgram from "node:dgram";

if (cluster.isPrimary) {
  // A bound descriptor of the primary's for the worker's bind({ fd }).
  const { _createSocketHandle } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const wrap = _createSocketHandle("127.0.0.1", 0, "udp4");
  const worker = cluster.fork();
  // Fail fast instead of hanging the harness.
  const watchdog = setTimeout(() => {
    worker.process.kill("SIGKILL");
    console.error("the worker did not report");
    process.exit(1);
  }, 15_000);
  watchdog.unref();
  worker.on("message", rows => console.log(JSON.stringify(rows)));
  worker.send({ fd: wrap.fd });
  const code = await new Promise(resolve => worker.on("exit", resolve));
  wrap.close();
  if (code !== 0) throw new Error(`worker exited with ${code}`);
} else {
  const storage = new AsyncLocalStorage<string>();
  const store = () => String(storage.getStore());
  process.once("message", ({ fd }: { fd: number }) => {
    const binds: Record<string, dgram.BindOptions> = {
      "shared": { port: 0, address: "127.0.0.1", exclusive: false },
      "the primary's descriptor": { fd },
      "exclusive": { port: 0, address: "127.0.0.1", exclusive: true },
    };
    const rows: Record<string, Record<string, string>> = {};
    let open = Object.keys(binds).length;
    const sender = dgram.createSocket("udp4");
    for (const [name, options] of Object.entries(binds)) {
      const row: Record<string, string> = (rows[name] = {});
      const socket = storage.run("createSocket()", () => dgram.createSocket("udp4"));
      socket.on("listening", () => {
        row["'listening'"] = store();
        sender.send("x", socket.address().port, "127.0.0.1");
      });
      socket.on("message", () => {
        row["'message'"] = store();
        socket.close();
        if (--open > 0) return;
        sender.close();
        process.send!(rows, () => process.exit(0));
      });
      storage.run("bind()", () => socket.bind(options));
    }
  });
}
