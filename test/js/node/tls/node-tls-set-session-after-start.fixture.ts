// Fixture for the "setSession() after the handshake started" tests in node-tls-connect.test.ts and
// test/js/bun/net/socket.test.ts. BoringSSL's SSL_set_session abort()s once the handshake has started.
// Each door named on the command line reaches setSession() through a different entry point; the
// fixture prints one JSON object, door -> result.
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";

type Result = Record<string, unknown>;

const keys = path.join(import.meta.dirname, "fixtures");
const key = fs.readFileSync(path.join(keys, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(keys, "agent1-cert.pem"));

// TLS 1.2: a TLS 1.3 getSession() taken at secureConnect has no ticket, so it is never offered.
const serverOptions = { key, cert, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } as const;
const server = tls.createServer(serverOptions, socket => {
  socket.on("error", () => {});
  socket.on("data", chunk => socket.write(chunk));
});
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as net.AddressInfo).port;
const clientOptions = { host: "127.0.0.1", port, rejectUnauthorized: false } as const;

const first = tls.connect(clientOptions);
await once(first, "secureConnect");
const session = first.getSession()!;
first.destroy();
await once(first, "close");

function attempt(call: () => void): { threw: string | null } {
  try {
    call();
    return { threw: null };
  } catch (e) {
    return { threw: (e as Error).message };
  }
}

/** A Bun socket's setServername() throws once the handshake has finished: separates "finished" from "in flight". */
function handshakeFinished(socket: { setServername(name: string): void }): boolean {
  try {
    socket.setServername("probe.test");
    return false;
  } catch {
    return true;
  }
}

/** The connection must still carry data after the refused offer. */
async function lateOnClient(
  client: tls.TLSSocket,
  result = attempt(() => (client as any).setSession(session)),
): Promise<Result> {
  const echoed = new Promise<string>(resolve => client.once("data", d => resolve(String(d))));
  client.write("ping");
  const echo = await Promise.race([echoed, once(client, "close").then(() => "<closed>")]);
  const offered = client.isSessionReused();
  client.destroy();
  return { ...result, echo, reused: offered };
}

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

  // TLS over a user Duplex: a separate SSL owner (the Rust SSLWrapper).
  async "node-duplex"() {
    const client = tls.connect({ ...clientOptions, socket: await duplexTo(port) });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client);
  },

  // The wrapper hands over its ClientHello: the handshake is in flight.
  async "node-duplex-in-flight"() {
    let result: { threw: string | null } | undefined;
    let client: tls.TLSSocket | undefined;
    const socket = await duplexTo(
      port,
      () => client && (result ??= attempt(() => (client as any).setSession(session))),
    );
    client = tls.connect({ ...clientOptions, socket });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client, result);
  },

  // From callbacks that run while BoringSSL is still inside the handshake or a read.
  "node-keylog": () => fromEvent("keylog", {}),
  "node-keylog-duplex": async () => fromEvent("keylog", { socket: await duplexTo(port) }),
  "node-session-event": () => fromEvent("session", {}),
  "node-session-event-duplex": async () => fromEvent("session", { socket: await duplexTo(port) }),
  async "node-check-server-identity"() {
    let result: { threw: string | null } | undefined;
    const client: tls.TLSSocket = tls.connect({
      ...clientOptions,
      ca: fs.readFileSync(path.join(keys, "ca1-cert.pem")),
      rejectUnauthorized: true,
      checkServerIdentity() {
        result = attempt(() => (client as any).setSession(session));
        return undefined;
      },
    });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client, result);
  },

  async "node-client-tls13"() {
    const own = tls.createServer({ key, cert, minVersion: "TLSv1.3" }, socket => {
      socket.on("error", () => {});
      socket.on("data", chunk => socket.write(chunk));
    });
    await once(own.listen(0, "127.0.0.1"), "listening");
    const client = tls.connect({ ...clientOptions, port: (own.address() as net.AddressInfo).port });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client);
  },

  // tls.connect({ socket }) over a connected net.Socket: the adopt-TLS path.
  async "node-wrap"() {
    const raw = net.connect(port, "127.0.0.1");
    await once(raw, "connect");
    const client = tls.connect({ ...clientOptions, socket: raw });
    client.on("error", () => {});
    await once(client, "secureConnect");
    return lateOnClient(client);
  },

  // node:tls server, in the connection handler.
  async "node-server"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    const own = tls.createServer(serverOptions, socket => {
      socket.on("error", () => {});
      resolve({ ...attempt(() => (socket as any).setSession(session)), side: "server" });
    });
    await once(own.listen(0, "127.0.0.1"), "listening");
    poke((own.address() as net.AddressInfo).port);
    return promise;
  },

  // new tls.TLSSocket(socket, { isServer: true }): the adopt-TLS path as a server.
  async "node-server-wrap"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    const plain = net.createServer(raw => {
      const secure = new tls.TLSSocket(raw, {
        isServer: true,
        secureContext: tls.createSecureContext(serverOptions),
      });
      secure.on("error", () => {});
      secure.on("secure", () => resolve({ ...attempt(() => (secure as any).setSession(session)), side: "server" }));
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
          resolve({ ...attempt(() => socket.setSession(session)), finished, reused: socket.isSessionReused() });
        },
        data() {},
        error() {},
      },
    });
    return promise;
  },

  // Bun.connect with no handshake handler: open() fires after the handshake.
  "bun-connect-open-late"() {
    const { promise, resolve } = Promise.withResolvers<Result>();
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: bunTls,
      socket: {
        open(socket) {
          const finished = handshakeFinished(socket);
          resolve({ ...attempt(() => socket.setSession(session)), finished, reused: socket.isSessionReused() });
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

  // The peer's chain is refused: the handshake started but SSL_is_init_finished() stays 0.
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

  // A write in the otherwise legal window starts the handshake from inside SSL_write.
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

  // The legal window: with both open and handshake handlers, open() runs before the ClientHello.
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
          resolve({ ...offer, reused: socket.isSessionReused() });
          socket.end();
        },
        data() {},
        error() {},
      },
    });
    return promise;
  },
};

async function duplexTo(port: number, onWrite?: () => void): Promise<Duplex> {
  const raw = net.connect(port, "127.0.0.1");
  await once(raw, "connect");
  const proxy = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      onWrite?.();
      raw.write(chunk, cb);
    },
  });
  raw.on("data", chunk => proxy.push(chunk));
  raw.on("end", () => proxy.push(null));
  return proxy;
}

async function fromEvent(event: "keylog" | "session", options: tls.ConnectionOptions): Promise<Result> {
  const client = tls.connect({ ...clientOptions, ...options });
  client.on("error", () => {});
  const { promise, resolve } = Promise.withResolvers<{ threw: string | null }>();
  client.once(event, () => resolve(attempt(() => (client as any).setSession(session))));
  const [result] = await Promise.all([promise, once(client, "secureConnect")]);
  return lateOnClient(client, result);
}

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
