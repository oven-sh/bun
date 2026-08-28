// Fixture: server returns a Promise<Response> that never resolves, then the
// client disconnects. Previously the RequestContext leaked because the
// pending-promise ref was only balanced by onResolve/onReject, which never
// fire when the promise is never settled.
//
// We verify the fix by checking server.pendingRequests returns to 0 after
// aborted requests complete their cleanup cycle.
import { connect } from "node:net";
import { tls } from "harness";

const http2 = process.argv.includes("--http2");

let abortCount = 0;
// Resolved from inside fetch() once the abort listener is installed, so the
// client knows it's safe to destroy the socket without racing the setup.
const readySignals: Array<() => void> = [];

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  ...(http2 ? { tls, http2: true } : {}),
  fetch(req) {
    req.signal.addEventListener("abort", () => abortCount++, { once: true });
    readySignals.shift()?.();
    // Never resolves - this is the leak scenario
    return new Promise<Response>(() => {});
  },
});

const port = server.port;

function makeAbortedTcpRequest(): Promise<void> {
  return new Promise(resolve => {
    const { promise: ready, resolve: signalReady } = Promise.withResolvers<void>();
    readySignals.push(signalReady);

    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      // Wait for the server to reach fetch() and install the abort listener
      // before destroying. Without this, a slow CI could destroy the socket
      // before addEventListener runs, and the abort would never be observed.
      ready.then(() => {
        socket.destroy();
        resolve();
      });
    });
    socket.on("error", () => resolve());
  });
}

/** Same scenario over HTTP/2: RST_STREAM the request once fetch() is reached. */
function makeAbortedH2Request(): Promise<void> {
  const { promise: ready, resolve: signalReady } = Promise.withResolvers<void>();
  readySignals.push(signalReady);
  const ac = new AbortController();
  const done = fetch(server.url, { protocol: "http2", tls: { rejectUnauthorized: false }, signal: ac.signal }).then(
    () => {
      throw new Error("request should have been aborted");
    },
    () => {},
  );
  return ready.then(() => {
    ac.abort();
    return done;
  });
}

const ITERATIONS = 100;
for (let i = 0; i < ITERATIONS; i++) {
  await (http2 ? makeAbortedH2Request() : makeAbortedTcpRequest());
}

// Force GC to collect the never-settled Promises. The NativePromiseContext
// cell destructor releases the ref on each RequestContext when the Promise's
// reaction is collected.
for (let i = 0; i < 10 && (server.pendingRequests > 0 || abortCount < ITERATIONS); i++) {
  Bun.gc(true);
  await Bun.sleep(10);
}

const pending = server.pendingRequests;

console.log(JSON.stringify({ pending, abortCount, iterations: ITERATIONS }));

server.stop(true);

if (pending !== 0) {
  console.error(`LEAK: ${pending} RequestContexts were never freed`);
  process.exit(1);
}
if (abortCount !== ITERATIONS) {
  console.error(`Expected ${ITERATIONS} abort events, got ${abortCount}`);
  process.exit(1);
}
process.exit(0);
