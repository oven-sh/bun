// A TLS socket over a Duplex that nothing in JS references any more can never
// see another event: every byte it gets comes from the Duplex's listeners. So the
// GC collects it with its TLS engine, as node collects a TLSWrap over a
// JSStream. Nothing here calls destroy().
//
// argv[2] names a case. The case makes its sockets, drops every reference and
// reports how many it saw collected, and the native contexts still live, as JSON.
import * as internals from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { Duplex, duplexPair } from "node:stream";
import tls from "node:tls";

const { TLS_KEY: key, TLS_CERT: cert } = process.env;
const N = 8;

// null on a build that has no counter.
const live = () => internals.duplexTLSInternals?.liveCount() ?? null;
const freed = () => !live();
const wrappers = () => heapStats().objectTypeCounts.TLSSocket ?? 0;
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

let collected = 0;
const registry = new FinalizationRegistry(() => collected++);

// Turns of the event loop, with a full collection each: at most 64, until `done()`.
async function until(done, turns = 64) {
  for (let turn = 0; turn < turns && !done(); turn++) {
    Bun.gc(true);
    await nextTurn();
  }
  return done();
}

// Both ends of a pair, handshaken. Returns the sockets so the case can decide what to keep.
function handshake() {
  const [clientSide, serverSide] = duplexPair();
  const server = new tls.TLSSocket(serverSide, { isServer: true, key, cert });
  const client = tls.connect({ socket: clientSide, rejectUnauthorized: false });
  return new Promise(resolve => client.once("secureConnect", () => resolve({ client, server, clientSide, serverSide })));
}

const cases = {
  // Both ends of every pair, dropped after the handshake.
  "after the handshake": async () => {
    for (let i = 0; i < N; i++) {
      const { client, server } = await handshake();
      registry.register(client, null);
      registry.register(server, null);
    }
    return 2 * N;
  },
  // The engine runs, its ClientHello sits in a stream that never answers.
  "with the handshake pending": async () => {
    for (let i = 0; i < N; i++) {
      const silent = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } });
      const client = tls.connect({ socket: silent, rejectUnauthorized: false });
      registry.register(client, null);
    }
    await nextTurn();
    return N;
  },
  // Dropped in the same turn: the task that starts the engine has not run yet.
  "before the engine starts": async () => {
    for (let i = 0; i < N; i++) {
      const [clientSide] = duplexPair();
      registry.register(tls.connect({ socket: clientSide, rejectUnauthorized: false }), null);
    }
    return N;
  },
  // The transports stay, and so what they feed stays with them. Nothing is collected until they go too.
  "only once the transport goes": async () => {
    const transports = [];
    for (let i = 0; i < N; i++) {
      const { client, server, clientSide, serverSide } = await handshake();
      registry.register(client, null);
      registry.register(server, null);
      transports.push(clientSide, serverSide);
    }
    await until(() => false, 8);
    const held = { collected, live: live(), wrappers: wrappers() };
    transports.length = 0;
    return { of: 2 * N, held };
  },
  // The transport stays with no listener of the socket's, and gets more data once the socket is gone.
  "and the transport stays": async () => {
    const transports = [];
    for (let i = 0; i < N; i++) {
      const { client, server, clientSide, serverSide } = await handshake();
      registry.register(client, null);
      registry.register(server, null);
      clientSide.removeAllListeners();
      serverSide.removeAllListeners();
      transports.push(clientSide, serverSide);
    }
    await until(() => collected === 2 * N && freed());
    for (const transport of transports) transport.push(Buffer.from("late"));
    await nextTurn();
    Bun.gc(true);
    return 2 * N;
  },
};

const result = await cases[process.argv[2]]();
const { of, held } = typeof result === "number" ? { of: result } : result;
await until(() => collected === of && freed());
const report = { collected, of, live: live(), wrappers: wrappers() };
if (held) report.held = held;
console.log(JSON.stringify(report));
