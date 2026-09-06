// Fixture for the "setSession() after the handshake started" tests in
// node-tls-connect.test.ts and test/js/bun/net/socket.test.ts.
//
// BoringSSL's SSL_set_session abort()s the whole process when the handshake
// state machine has already left its initial state. Each "door" below hands a
// valid serialized session to setSession() on a socket whose handshake has
// started, through a different JS entry point. The expected outcome is a JS
// exception, printed as JSON on stdout, and a normal exit.
import { tls as certs } from "harness";
import { once } from "node:events";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";

const door = process.argv[2];

let session: Buffer;
const server = tls.createServer({ key: certs.key, cert: certs.cert }, socket => {
  if (door === "node-server-secureConnection" && session) {
    report(() => socket.setSession(session));
  }
  socket.on("data", () => {});
  socket.on("error", () => {});
});
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as net.AddressInfo).port;
const clientOptions = { host: "127.0.0.1", port, ca: certs.cert, servername: "localhost" } as const;

// A first connection produces the session blob every door feeds back in.
const first = tls.connect(clientOptions);
await once(first, "secureConnect");
session = first.getSession()!;
first.destroy();
await once(first, "close");

let reported = false;
function report(call: () => void) {
  if (reported) return;
  reported = true;
  let threw: string | null = null;
  try {
    call();
  } catch (e) {
    threw = (e as Error).message;
  }
  console.log(JSON.stringify({ threw }));
  setImmediate(() => process.exit(0));
}

switch (door) {
  case "node-client-secureConnect": {
    const client = tls.connect(clientOptions);
    await once(client, "secureConnect");
    report(() => client.setSession(session));
    break;
  }
  case "node-server-secureConnection": {
    const client = tls.connect(clientOptions);
    await once(client, "secureConnect");
    break;
  }
  case "node-duplex-secureConnect": {
    // TLS over a user Duplex is driven by a separate SSL wrapper, not uSockets.
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
    await once(client, "secureConnect");
    report(() => client.setSession(session));
    break;
  }
  case "bun-connect-handshake": {
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { ca: certs.cert, serverName: "localhost" },
      socket: {
        handshake(socket) {
          report(() => socket.setSession(session));
        },
        data() {},
        error() {},
      },
    });
    break;
  }
  case "bun-connect-open": {
    // With both `open` and `handshake` handlers, `open` fires before the
    // ClientHello is queued. The call is legal there and must keep working.
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { ca: certs.cert, serverName: "localhost" },
      socket: {
        open(socket) {
          report(() => socket.setSession(session));
        },
        handshake() {},
        data() {},
        error() {},
      },
    });
    break;
  }
  case "bun-listen-handshake": {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: certs.key, cert: certs.cert },
      socket: {
        handshake(socket) {
          report(() => socket.setSession(session));
        },
        data() {},
        error() {},
      },
    });
    const client = tls.connect({ ...clientOptions, port: listener.port });
    client.on("error", () => {});
    await once(client, "secureConnect");
    break;
  }
  default:
    throw new Error(`unknown door ${door}`);
}
