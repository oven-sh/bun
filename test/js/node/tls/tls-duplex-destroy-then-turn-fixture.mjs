// The native context of a TLS socket over a stream must not be freed while a
// frame of its TLS engine is on the stack. A callback of the socket only has to
// turn the event loop synchronously for queued tasks to run under such a frame.
// The close can come from the program, the peer or the engine.
//
// argv[2] names a group of cases. Each case reports the number of live native
// contexts at the points its group names. One JSON report per run.
//
// Bun only: `expect().resolves` and `Bun.build` are what turn the event loop.
import * as internals from "bun:internal-for-testing";
import { expect } from "bun:test";
import { Duplex } from "node:stream";
import tls from "node:tls";

const { TLS_KEY: key, TLS_CERT: cert } = process.env;

// Delivers each write to the other side at once. Forwards neither its end nor
// its close: the other side stays open until the case closes it.
class Side extends Duplex {
  other = null;
  cut = false;
  onWrite = null;
  onFinal = null;
  _read() {}
  _write(chunk, encoding, callback) {
    if (!this.cut) this.other.push(chunk);
    this.onWrite?.();
    callback();
  }
  _final(callback) {
    this.onFinal?.();
    callback();
  }
}

function transportPair() {
  const [a, b] = [new Side(), new Side()];
  a.other = b;
  b.other = a;
  return [a, b];
}

// The socket errors of the current case. A case that did not finish reports them.
const errors = [];
const wrap = (side, options) =>
  new tls.TLSSocket(side, { isServer: true, key, cert, ...options }).on("error", error => errors.push(error.code));
const connect = side =>
  tls
    .connect({ socket: side, rejectUnauthorized: false, ALPNProtocols: ["h2"] })
    .on("error", error => errors.push(error.code));

// null on a build that has no counter.
const live = () => internals.duplexTLSInternals?.liveCount() ?? null;

const turns = {
  // Runs the queued tasks, then the microtask that settles the promise.
  matcher: () => expect(new Promise(resolve => queueMicrotask(resolve))).resolves.toBeUndefined(),
  // Bun.build() waits for an async plugin setup() the same way.
  build: () =>
    void Bun.build({
      entrypoints: ["/turn.js"],
      files: { "/turn.js": "" },
      plugins: [{ name: "turn", setup: async () => await null }],
    }),
};

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

// Turns of the event loop, at most 64, until `done()`. Nothing here waits on time.
async function until(done) {
  for (let turn = 0; turn < 64 && !done(); turn++) await nextTurn();
  return done();
}

// A task frees each context after its socket closed.
const settled = async () => (await until(() => live() === 0), live());

// "handshake", "data": the callback closes its own socket, then turns the event loop.
// "waits": the callback only turns the event loop. What closes the socket is named in the case.
// Each case reports the live contexts before the turn, after it (inside the callback), and after every socket closed.
// A case returns the sockets to close when its callback has run.
const callbacks = {
  handshake: {
    "ALPNCallback": c => {
      const server = wrap(c.serverSide, {
        ALPNCallback({ protocols }) {
          c.closeThenTurn(this);
          return protocols[0];
        },
      });
      return [server, connect(c.clientSide)];
    },
    "server 'keylog'": c => {
      const server = wrap(c.serverSide).on("keylog", () => c.closeThenTurn(server));
      return [server, connect(c.clientSide)];
    },
    "client 'secureConnect'": c => {
      const client = connect(c.clientSide).on("secureConnect", () => c.closeThenTurn(client));
      return [wrap(c.serverSide), client];
    },
  },
  data: {
    "server 'data'": c => {
      const server = wrap(c.serverSide).on("data", () => c.closeThenTurn(server));
      const client = connect(c.clientSide).on("secureConnect", () => client.write("x"));
      return [server, client];
    },
    "server 'data', turned by Bun.build()": c => {
      const server = wrap(c.serverSide).on("data", () => c.closeThenTurn(server, turns.build));
      const client = connect(c.clientSide).on("secureConnect", () => client.write("x"));
      return [server, client];
    },
    "client 'data'": c => {
      const server = wrap(c.serverSide);
      const client = connect(c.clientSide)
        .on("secureConnect", () => server.write("x"))
        .on("data", () => c.closeThenTurn(client));
      return [server, client];
    },
    "the transport's write()": c => {
      const server = wrap(c.serverSide);
      const client = connect(c.clientSide).on("secureConnect", () => {
        c.serverSide.onWrite = () => c.closeThenTurn(server);
        server.write("x");
      });
      return [server, client];
    },
  },
  waits: {
    // destroy() in a later turn. The engine ends a transport that is still open, and that runs final().
    "the transport's final(), destroy() in a later turn": c => {
      c.serverSide.destroy = () => c.serverSide;
      c.serverSide.onFinal = () => c.closeThenTurn(null);
      const server = wrap(c.serverSide);
      const client = connect(c.clientSide).on("secureConnect", () => setImmediate(() => server.destroy()));
      return [server, client];
    },
    // The close lands inside the turn, from a microtask.
    "server 'data', the transport closes during the turn": c => {
      const server = wrap(c.serverSide).on("data", () => {
        queueMicrotask(() => c.serverSide.emit("close"));
        c.closeThenTurn(null);
      });
      const client = connect(c.clientSide).on("secureConnect", () => client.write("x"));
      return [server, client];
    },
    // Both sockets are the graph's, and the engine of each one is on the stack: the client's write() delivers the data.
    "server 'data', its Bun.ModuleGraph is disposed": c => {
      const graph = new Bun.ModuleGraph();
      graph.run(() => {
        wrap(c.serverSide).on("data", () => {
          graph.dispose();
          c.closeThenTurn(null);
        });
        const client = connect(c.clientSide).on("secureConnect", () => client.write("x"));
      });
      return [];
    },
  },
};

async function runCallback(arrange) {
  const report = {};
  errors.length = 0;
  const [serverSide, clientSide] = transportPair();
  // A context that nothing holds: the turn frees it, which shows that the turn ran the queued tasks.
  const canary = wrap(new Side());
  await nextTurn();
  const c = { serverSide, clientSide };
  c.closeThenTurn = (socket, turn = turns.matcher) => {
    if ("before" in report) return;
    // The peer learns nothing of the close, so its context stays for the whole turn.
    serverSide.cut = clientSide.cut = true;
    report.before = live();
    canary.destroy();
    socket?.destroy();
    turn();
    report.afterTurn = live();
  };
  const sockets = [canary, ...arrange(c)];
  if (!(await until(() => "afterTurn" in report))) report.errors = [...errors];
  for (const socket of sockets) socket.destroy();
  report.afterClose = await settled();
  return report;
}

async function handshake() {
  errors.length = 0;
  const [serverSide, clientSide] = transportPair();
  const sockets = [wrap(serverSide), connect(clientSide)];
  let secure = false;
  sockets[1].once("secureConnect", () => (secure = true));
  await until(() => secure);
  return { sockets, open: secure ? live() : [...errors] };
}

// "ends": the ways a connection ends. Each case returns the live contexts while its connection is open,
// and the report adds what is left after it ended.
const ends = {
  "destroy() before the engine starts": async () => {
    const socket = wrap(new Side());
    const open = live();
    socket.destroy();
    return { open };
  },
  "destroy() twice": async () => {
    const { sockets, open } = await handshake();
    for (const socket of [...sockets, ...sockets]) socket.destroy();
    return { open };
  },
  "end() on both sides": async () => {
    const { sockets, open } = await handshake();
    for (const socket of sockets) socket.end();
    return { open };
  },
  // The engine never starts, and the socket reports nothing.
  "a string from the transport before the engine starts": async () => {
    const side = new Side();
    side.setEncoding("utf8");
    side.push("not a buffer");
    wrap(side);
    return { open: live() };
  },
  // The task that starts the engine is released, not run.
  "its Bun.ModuleGraph is disposed before the engine starts": async () => {
    const graph = new Bun.ModuleGraph();
    graph.run(() => wrap(new Side()));
    const open = live();
    graph.dispose();
    return { open };
  },
  // That task is released inside the turn, under the listener. A string from the transport then reaches nobody.
  "its Bun.ModuleGraph is disposed under the transport's 'end', before the engine starts": async () => {
    const report = { graphErrors: [] };
    const graph = new Bun.ModuleGraph({ onError: error => report.graphErrors.push(error.code) });
    const side = new Side();
    side.push(null);
    graph.run(() =>
      wrap(side).on("readable", () => {
        report.open = live();
        graph.dispose();
        turns.matcher();
        report.afterTurn = live();
        side.emit("data", "a string after the release");
      }),
    );
    await until(() => "afterTurn" in report);
    return report;
  },
  // The task that frees the context is queued when the graph stops.
  "destroy(), then its Bun.ModuleGraph is disposed in the same turn": async () => {
    const graph = new Bun.ModuleGraph();
    const socket = graph.run(() => wrap(new Side()));
    await nextTurn();
    const open = live();
    socket.destroy();
    graph.dispose();
    return { open };
  },
};

const keepAlive = setInterval(() => {}, 1 << 30);
const group = process.argv[2];
const report = {};
if (group === "ends") {
  for (const [name, end] of Object.entries(ends)) report[name] = { ...(await end()), ended: await settled() };
} else {
  for (const [name, arrange] of Object.entries(callbacks[group])) report[name] = await runCallback(arrange);
}
console.log(JSON.stringify(report));
clearInterval(keepAlive);
