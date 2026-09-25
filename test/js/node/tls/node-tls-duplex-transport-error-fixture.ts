// Wraps a Duplex in a TLS socket and destroys the Duplex with an error, once
// per case. Prints one line per case: the events that the TLS socket emitted.
// "client" wraps the Duplex with tls.connect(), "server" with
// new tls.TLSSocket(transport, { isServer: true }).
// "early" destroys the Duplex in the tick of the wrap, before the TLS engine
// exists. "late" destroys it once the engine runs: after the ClientHello for a
// client, one event-loop turn after the wrap for a server.
// Every case runs in this one process, and KEY and CERT come from the test: a
// debug build needs seconds to load node:tls or "harness".
import { Duplex } from "node:stream";
import tls from "node:tls";

const { KEY: key, CERT: cert } = process.env;
const cases: Record<string, string[]> = {};
process.on("exit", () => {
  for (const name in cases) console.log(`${name}: ${cases[name].join("|")}`);
});

function run(side: "client" | "server", when: "early" | "late") {
  const seen: string[] = (cases[`${side} ${when}`] = []);
  let started = false;
  const transport = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
      if (started) return;
      started = true;
      if (when === "late") process.nextTick(kill);
    },
  });

  function kill() {
    transport.destroy(new Error("transport failed"));
  }

  const socket =
    side === "client"
      ? tls.connect({ socket: transport, rejectUnauthorized: false })
      : new tls.TLSSocket(transport, { isServer: true, key, cert });
  socket.on("_tlsError", err => seen.push(`_tlsError:${err.message}`));
  socket.on("error", err => seen.push(`error:${err.message}`));
  socket.on("close", hadError => seen.push(`close:${hadError}`));

  // A server writes nothing until its peer does. The task that creates the
  // engine is queued ahead of this one.
  if (side === "server" && when === "late") setImmediate(kill);
  if (when === "early") kill();
}

run("client", "early");
run("client", "late");
run("server", "early");
run("server", "late");
