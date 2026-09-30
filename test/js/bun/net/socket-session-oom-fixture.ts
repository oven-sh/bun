// Fixture for the out-of-memory path of the TLS session dispatch Buffer.
//
// on_session/on_keylog allocate a JS Buffer for the payload before calling the
// handler. A throw from that allocation used to escape the dispatch with the
// exception left pending on the VM, so the next native JSC call in the same
// event-loop tick ran with a stale exception (asserts in debug builds,
// misattribution in release). The allocation only fails on JSC heap OOM, so
// the fault injector is the only way here from a test.
//
// The fixed build reports the failure as an unhandled error: the
// uncaughtException handler below receives it, the event loop stays healthy,
// and the process exits cleanly.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { tls as certs } from "harness";

if (!fault.available()) throw new Error("socket fault injection is not available in this build");

const { promise: gotUncaught, resolve: onUncaught } = Promise.withResolvers<Error>();
process.on("uncaughtException", err => {
  // Print every one: the driver asserts exactly one fired.
  console.log("UNCAUGHT: " + String(err));
  onUncaught(err as Error);
});

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: { cert: certs.cert, key: certs.key },
  socket: {
    open(s) {
      // The client only processes the server's NewSessionTicket during a
      // read, so give it something to read.
      s.write("x");
    },
    data() {},
    error() {},
  },
});

// Fire on the first session dispatch only; later dispatches proceed normally.
fault.set({ syscall: "session_buffer", action: "errno", errno: "ENOMEM" });
console.log("ARMED");

const socket = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port,
  tls: { ca: certs.cert, serverName: "localhost" },
  socket: {
    data() {},
    close() {},
    error() {},
    session() {},
  },
});

await gotUncaught;
fault.clear();

// The stale-exception bug corrupts whatever native JSC call runs next in the
// loop; prove the loop still works by finishing a full TCP round trip.
const echo = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(s) {
      s.write("ok");
      s.end();
    },
    data() {},
    error() {},
  },
});
const { promise: roundTrip, resolve: onClose } = Promise.withResolvers<string>();
let received = "";
await Bun.connect({
  hostname: "127.0.0.1",
  port: echo.port,
  socket: {
    data(_s, d) {
      received += d;
    },
    close() {
      onClose(received);
    },
    error() {},
  },
});
console.log("ROUNDTRIP: " + (await roundTrip));

socket.end();
server.stop(true);
echo.stop(true);
process.exit(0);
