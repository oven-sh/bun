// Fixture for the "setSession() after the handshake started" tests in
// node-tls-connect.test.ts and test/js/bun/net/socket.test.ts.
//
// BoringSSL's SSL_set_session may only be called before the handshake starts.
// Upstream enforces that with abort(); Bun patches it to return 0
// (patches/boringssl/set-session-return-0.patch), so setSession() ignores the
// late offer and the connection keeps working.
//
// Each door below reaches setSession() through a different JS entry point with
// the handshake already started. The doors named on the command line run
// together, and the fixture prints one JSON object, door -> result. Without
// the patch the first late call kills the process with SIGABRT and nothing is
// printed. To find which door does it, run them one at a time:
//   bun node-tls-set-session-after-start.fixture.ts node-client
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";

type Result = Record<string, unknown>;

// Read the cert from disk rather than importing "harness": that import costs
// about two seconds under a debug build, most of this fixture's runtime.
const keys = path.join(import.meta.dirname, "fixtures");
const key = fs.readFileSync(path.join(keys, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(keys, "agent1-cert.pem"));

// An echo server for the client-side doors.
// TLS 1.2: a TLS 1.3 getSession() blob taken at secureConnect carries no
// ticket, so BoringSSL never offers it and the legal door could not tell a
// refused offer from an accepted one.
const serverOptions = { key, cert, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } as const;
const server = tls.createServer(serverOptions, socket => {
  socket.on("error", () => {});
  socket.on("data", chunk => socket.write(chunk));
});
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as net.AddressInfo).port;
const clientOptions = { host: "127.0.0.1", port, rejectUnauthorized: false } as const;

// A first connection produces the session every door feeds back in. Only a
// session that parses reaches SSL_set_session.
const first = tls.connect(clientOptions);
await once(first, "secureConnect");
const session = first.getSession()!;
first.destroy();
await once(first, "close");

/** Call setSession() and report whether it threw. */
function attempt(call: () => void): { threw: string | null } {
  try {
    call();
    return { threw: null };
  } catch (e) {
    return { threw: (e as Error).message };
  }
}

/**
 * Has the handshake FINISHED? setServername() throws "Already started." once
 * SSL_is_init_finished() is true, so it separates the two states in which
 * SSL_set_session refuses: a finished handshake, and one still in flight.
 * BoringSSL refuses both (initial_handshake_complete, and hs->state != 0).
 * A Bun socket only.
 */
function handshakeFinished(socket: { setServername(name: string): void }): boolean {
  try {
    socket.setServername("probe.test");
    return false;
  } catch {
    return true;
  }
}

/** Did the offer reach the wire? Only a resumed handshake reports true. */
function reused(socket: { isSessionReused(): boolean }): boolean {
  return socket.isSessionReused();
}

/**
 * Call setSession() on a connected client, then prove the connection still
 * carries data. A refused offer must leave the socket usable.
 */
async function lateOnClient(client: tls.TLSSocket): Promise<Result> {
  const result = attempt(() => client.setSession(session));
  const echoed = new Promise<string>(resolve => client.once("data", d => resolve(String(d))));
  client.write("ping");
  const echo = await Promise.race([echoed, once(client, "close").then(() => "<closed>")]);
  const offered = reused(client);
  client.destroy();
  return { ...result, echo, reused: offered };
}

/** Connect a throwaway node:tls client, for the doors that act on the server side. */
function poke(serverPort: number) {
  const client = tls.connect({ ...clientOptions, port: serverPort });
  client.on("error", () => {});
}

const bunTls = { rejectUnauthorized: false } as const;

const doors: Record<string, () => Promise<Result>> = {
  // node:tls client, in its own secureConnect handler.
  async "node-client"() {
    const client = tls.connect(clientOptions);
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client);
  },

  // TLS over a user Duplex. A separate SSL owner (the Rust SSLWrapper), not
  // the uSockets socket the other client doors use.
  async "node-duplex"() {
    const raw = net.connect(port, "127.0.0.1");
    await once(raw, "connect");
    const proxy = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        raw.write(chunk, cb);
      },
    });
    raw.on("data", chunk => proxy.push(chunk));
    raw.on("end", () => proxy.push(null));
    const client = tls.connect({ ...clientOptions, socket: proxy });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client);
  },

  // tls.connect({socket}) over an already connected net.Socket: the adopt-TLS
  // path, a third way to reach the same SSL.
  async "node-wrap"() {
    const raw = net.connect(port, "127.0.0.1");
    await once(raw, "connect");
    const client = tls.connect({ ...clientOptions, socket: raw });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client);
  },

  // node:tls server, in the connection handler. The server's handshake is
  // finished by the time that handler runs.
  async "node-server"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    const own = tls.createServer(serverOptions, socket => {
      socket.on("error", () => {});
      resolve({ ...attempt(() => socket.setSession(session)), side: "server" });
    });
    await once(own.listen(0, "127.0.0.1"), "listening");
    poke((own.address() as net.AddressInfo).port);
    return promise;
  },

  // new tls.TLSSocket(socket, {isServer: true}) over an accepted net.Socket:
  // the adopt-TLS path again, in its server role.
  async "node-server-wrap"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    const plain = net.createServer(raw => {
      const secure = new tls.TLSSocket(raw, {
        isServer: true,
        secureContext: tls.createSecureContext(serverOptions),
      });
      secure.on("error", () => {});
      secure.on("secure", () => resolve({ ...attempt(() => secure.setSession(session)), side: "server" }));
    });
    await once(plain.listen(0, "127.0.0.1"), "listening");
    poke((plain.address() as net.AddressInfo).port);
    return promise;
  },

  // Bun.connect, from the handshake handler.
  "bun-connect-handshake"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: bunTls,
      socket: {
        handshake(socket) {
          const finished = handshakeFinished(socket);
          resolve({ ...attempt(() => socket.setSession(session)), finished, reused: reused(socket) });
        },
        data() {},
        error() {},
      },
    });
    return promise;
  },

  // Bun.connect with no handshake handler: open() then fires after the
  // handshake, which is the default timing for this API.
  "bun-connect-open-late"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: bunTls,
      socket: {
        open(socket) {
          const finished = handshakeFinished(socket);
          resolve({ ...attempt(() => socket.setSession(session)), finished, reused: reused(socket) });
        },
        data() {},
        error() {},
      },
    });
    return promise;
  },

  // Bun.listen, from the server's handshake handler.
  "bun-listen-handshake"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: key.toString(), cert: cert.toString() },
      socket: {
        handshake(socket) {
          resolve({ ...attempt(() => socket.setSession(session)), finished: handshakeFinished(socket) });
        },
        data() {},
        error() {},
      },
    });
    poke(listener.port);
    return promise;
  },

  // A handshake that failed: the peer's chain is refused, so the handshake
  // never finishes, but it did start. SSL_is_init_finished() is still 0 here,
  // so a guard built on it alone lets this call through.
  "bun-connect-failed-handshake"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      // No CA for the self-signed chain, and rejectUnauthorized stays on.
      tls: true,
      socket: {
        handshake(socket, success) {
          resolve({ ...attempt(() => socket.setSession(session)), finished: handshakeFinished(socket), success });
        },
        data() {},
        error() {},
        close() {},
      },
    }).catch(() => {});
    return promise;
  },

  // open() with a handshake handler is the legal window, but a write there
  // starts the handshake from inside SSL_write. The call after it is late.
  "bun-connect-open-after-write"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: bunTls,
      socket: {
        open(socket) {
          socket.write("x");
          resolve({ ...attempt(() => socket.setSession(session)), finished: handshakeFinished(socket) });
        },
        handshake() {},
        data() {},
        error() {},
      },
    });
    return promise;
  },

  // socket.upgradeTLS() returns [raw, tls]. Both halves reach the one SSL.
  "bun-upgrade-tls-half": () => upgraded(1),
  "bun-upgrade-raw-half": () => upgraded(0),

  // The legal window: with both open and handshake handlers, open() runs
  // before the ClientHello. This door must keep working.
  "bun-connect-open-legal"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    let offer: Result = {};
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: bunTls,
      socket: {
        open(socket) {
          offer = { ...attempt(() => socket.setSession(session)), finished: handshakeFinished(socket) };
        },
        handshake(socket) {
          resolve({ ...offer, reused: reused(socket) });
          socket.end();
        },
        data() {},
        error() {},
      },
    });
    return promise;
  },
};

async function upgraded(half: 0 | 1): Promise<Result> {
  const { promise, resolve } = Promise.withResolvers<Result>();
  const plain = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: { open() {}, data() {}, error() {} },
  });
  const halves = plain.upgradeTLS({
    tls: bunTls,
    socket: {
      handshake() {
        const socket = halves[half];
        resolve({ ...attempt(() => socket.setSession(session)), finished: handshakeFinished(socket) });
      },
      data() {},
      error() {},
    },
  });
  return promise;
}

const names = process.argv.slice(2);
for (const name of names) if (!doors[name]) throw new Error(`unknown door ${name}`);
const results = await Promise.all(names.map(async name => [name, await doors[name]()] as const));
console.log(JSON.stringify(Object.fromEntries(results)));
process.exit(0);
