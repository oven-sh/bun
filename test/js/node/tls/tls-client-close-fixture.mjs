// How a TLS client's way of closing reaches the server. report(mode, version)
// makes one connection and resolves with what the server and the wire saw.
// node-tls-connect.test.ts runs it in bun and in node, and expects the same
// reports from both.
//
// The server asks for a client certificate and accepts any. A plain TCP relay
// in front of it records what the client sent. The report is about the last
// connection of the mode:
// - `client` lists the first error and the 'close' event of the client.
// - `server` is what the server saw: "secureConnection" with the CN of the
//   client certificate, the data it read and the error of its socket, or
//   "tlsClientError" with the error code.
// - `sentAfterClientHello` says whether the client sent anything after its
//   first record. A client that turns the server down does not.
// - `alerts` counts the client's alert records. A TLS 1.3 alert travels as an
//   application data record of 19 bytes: the alert, the inner content type and
//   the AEAD tag. Nothing else a mode sends has that size.
//
// A mode that ends with "while another TLS socket is backpressured" first
// opens a second TLS connection whose peer stops reading, and writes to it
// until the kernel takes no more.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dirname, "..", "test", "fixtures", "keys");
const pem = name => readFileSync(join(keys, name));

// One application data record that does not decrypt.
const junkRecord = Buffer.concat([Buffer.from([23, 3, 3, 0, 16]), Buffer.alloc(16, 0xa5)]);

function wire(bytes) {
  let alerts = 0;
  for (let at = 0; at + 5 <= bytes.length; at += 5 + bytes.readUInt16BE(at + 3)) {
    const type = bytes[at];
    if (type === 21 || (type === 23 && bytes.readUInt16BE(at + 3) === 19)) alerts++;
  }
  const clientHello = bytes.length >= 5 ? 5 + bytes.readUInt16BE(3) : 0;
  return { sentAfterClientHello: bytes.length > clientHello, alerts };
}

// What a 'secureConnect' listener does with the socket.
const inSecureConnect = {
  "destroy()": socket => socket.destroy(),
  "destroy(error)": socket => socket.destroy(Object.assign(new Error("refused"), { code: "ERR_REFUSED" })),
  "destroy() from process.nextTick": socket => process.nextTick(() => socket.destroy()),
  "destroy() from queueMicrotask": socket => queueMicrotask(() => socket.destroy()),
  "end()": socket => socket.end(),
  "end(data)": socket => socket.end("hello"),
  "write() then destroy()": socket => {
    socket.write("hello");
    socket.destroy();
  },
  "write('') then destroy()": socket => {
    socket.write("");
    socket.destroy();
  },
  "end('') then destroy()": socket => {
    socket.end("");
    socket.destroy();
  },
  "end() then destroy()": socket => {
    socket.end();
    socket.destroy();
  },
  "destroySoon()": socket => socket.destroySoon(),
};

const backpressured = " while another TLS socket is backpressured";

// A TLS connection of this process whose peer is a TCP relay. `stall()` makes
// the relay stop reading and writes 32 MB: the kernel takes a part, and the
// rest of the sealed records waits in the TLS layer.
async function secondConnection() {
  const server = tls.createServer({ key: pem("agent1-key.pem"), cert: pem("agent1-cert.pem") }, socket => {
    socket.on("error", () => {});
    socket.resume();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  let downstream;
  const relay = net.createServer(socket => {
    downstream = socket;
    const upstream = net.connect(server.address().port, "127.0.0.1");
    downstream.on("data", chunk => upstream.write(chunk));
    upstream.on("data", chunk => downstream.write(chunk));
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
    downstream.on("close", () => upstream.destroy());
  });
  await once(relay.listen(0, "127.0.0.1"), "listening");
  const socket = tls.connect({
    host: "127.0.0.1",
    port: relay.address().port,
    ca: pem("ca1-cert.pem"),
    servername: "agent1",
  });
  socket.on("error", () => {});
  await once(socket, "secureConnect");
  return {
    socket,
    stall() {
      downstream.pause();
      socket.write(Buffer.alloc(32 * 1024 * 1024));
    },
    close() {
      socket.destroy();
      downstream.destroy();
      relay.close();
      server.close();
    },
  };
}

export async function report(fullMode, version) {
  const mode = fullMode.endsWith(backpressured) ? fullMode.slice(0, -backpressured.length) : fullMode;
  const second =
    mode !== fullMode || mode === "checkServerIdentity function that writes to another TLS socket"
      ? await secondConnection()
      : null;
  if (mode !== fullMode) second.stall();
  // agent1 is signed by ca1 and names only "agent1".
  let serverSaw = Promise.withResolvers();
  const server = tls.createServer({
    key: pem("agent1-key.pem"),
    cert: pem("agent1-cert.pem"),
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: version,
    maxVersion: version,
    ALPNProtocols: mode === "http2.connect" ? ["h2"] : undefined,
  });
  server.on("secureConnection", socket => {
    // BoringSSL sends its TLS 1.3 tickets with the first write of the server.
    if (mode === "destroy() on a resumed session") socket.write("x");
    const peerCN = socket.getPeerCertificate()?.subject?.CN ?? null;
    let data = "";
    let error = null;
    socket.on("data", chunk => (data += chunk));
    socket.on("error", err => (error = err.code));
    socket.on("close", () => serverSaw.resolve({ event: "secureConnection", peerCN, data, error }));
  });
  server.on("tlsClientError", error => serverSaw.resolve({ event: "tlsClientError", code: error.code }));
  await once(server.listen(0, "127.0.0.1"), "listening");

  let fromClient = [];
  const relay = net.createServer(downstream => {
    fromClient = [];
    let serverChunks = 0;
    const upstream = net.connect(server.address().port, "127.0.0.1");
    downstream.on("data", chunk => {
      fromClient.push(chunk);
      upstream.write(chunk);
    });
    upstream.on("data", chunk => {
      // The server's first chunk is its whole flight, up to its Finished.
      const junk = mode === "a junk record behind the server's Finished" && serverChunks++ === 0;
      downstream.write(junk ? Buffer.concat([chunk, junkRecord]) : chunk);
    });
    downstream.on("end", () => upstream.end());
    upstream.on("end", () => downstream.end());
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
  });
  await once(relay.listen(0, "127.0.0.1"), "listening");

  const port = relay.address().port;
  // `servername: "agent1"` is the name the certificate carries.
  const accepted = {
    host: "127.0.0.1",
    port,
    ca: pem("ca1-cert.pem"),
    servername: "agent1",
    key: pem("agent3-key.pem"),
    cert: pem("agent3-cert.pem"),
  };
  const refused = { ...accepted, servername: "not-agent1" };
  const pinnedKeyError = () => Object.assign(new Error("not the pinned key"), { code: "ERR_PINNED_KEY" });

  let client = [];
  function watch(socket) {
    // node reports the junk record too, after the error of the refusal.
    socket.on("error", error => client.some(event => event.startsWith("error:")) || client.push(`error:${error.code}`));
    return new Promise(resolve =>
      socket.on("close", hadError => {
        client.push(`close:${hadError}`);
        resolve();
      }),
    );
  }

  // A full handshake that keeps its session, then the options of a second one.
  async function resume(second) {
    const first = tls.connect(accepted);
    const firstClosed = watch(first);
    // A TLS 1.3 ticket arrives after the handshake, so the socket has to read.
    first.resume();
    const [session] = await once(first, "session");
    first.end();
    await Promise.all([firstClosed, serverSaw.promise]);
    client = [];
    serverSaw = Promise.withResolvers();
    return { ...second, session };
  }

  let closed;
  switch (mode) {
    case "checkServerIdentity":
    case "a junk record behind the server's Finished":
      closed = watch(tls.connect(refused));
      break;
    case "checkServerIdentity function":
      closed = watch(tls.connect({ ...accepted, checkServerIdentity: pinnedKeyError }));
      break;
    case "checkServerIdentity function that writes to another TLS socket": {
      const checkServerIdentity = () => {
        second.socket.write("checked");
        return pinnedKeyError();
      };
      closed = watch(tls.connect({ ...accepted, checkServerIdentity }));
      break;
    }
    case "destroy() on a resumed session": {
      const socket = tls.connect(await resume(accepted), () => {
        client.push(`reused:${socket.isSessionReused()}`);
        socket.destroy();
      });
      closed = watch(socket);
      break;
    }
    case "tls.connect({ socket })": {
      const raw = net.connect(port, "127.0.0.1");
      raw.on("error", () => {});
      await once(raw, "connect");
      closed = watch(tls.connect({ ...refused, socket: raw }));
      break;
    }
    case "https.request": {
      const request = https.request({ ...refused, agent: false });
      closed = new Promise(resolve =>
        request.on("error", error => {
          client.push(`error:${error.code}`);
          resolve();
        }),
      );
      request.end();
      break;
    }
    case "http2.connect": {
      const session = http2.connect(`https://127.0.0.1:${port}`, refused);
      session.on("error", error => client.push(`error:${error.code}`));
      closed = new Promise(resolve => session.on("close", resolve));
      break;
    }
    default: {
      const act = inSecureConnect[mode];
      if (!act) throw new Error(`unknown mode ${mode}`);
      const socket = tls.connect(accepted, () => act(socket));
      closed = watch(socket);
    }
  }

  const [saw] = await Promise.all([serverSaw.promise, closed]);
  second?.close();
  relay.close();
  server.close();
  return { client, server: saw, ...wire(Buffer.concat(fromClient)) };
}
