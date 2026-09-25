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
import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";
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

// The record protection keys of a TLS 1.3 traffic secret (RFC 8446, section
// 7.3). `serverHello` starts with the ServerHello record, which names the
// cipher suite.
function trafficKeys(serverHello, secret) {
  const cipherSuite = serverHello.readUInt16BE(44 + serverHello[43]);
  const [hash, cipher, keyLength] = {
    0x1301: ["sha256", "aes-128-gcm", 16],
    0x1302: ["sha384", "aes-256-gcm", 32],
    0x1303: ["sha256", "chacha20-poly1305", 32],
  }[cipherSuite];
  const expandLabel = (label, length) =>
    createHmac(hash, secret)
      .update(
        Buffer.concat([Buffer.from([0, length, 6 + label.length]), Buffer.from("tls13 " + label), Buffer.from([0, 1])]),
      )
      .digest()
      .subarray(0, length);
  return { cipher, key: expandLabel("key", keyLength), iv: expandLabel("iv", 12) };
}

// A close_notify alert as the first record under the server's application
// traffic secret (RFC 8446, section 5.2). A TLS 1.3 server may send records
// under that secret right behind its Finished. OpenSSL and BoringSSL do not
// send this alert during their handshake, so the relay seals it.
function sealedCloseNotify(serverHello, secret) {
  const { cipher, key, iv } = trafficKeys(serverHello, secret);
  const header = Buffer.from([23, 3, 3, 0, 19]);
  const seal = createCipheriv(cipher, key, iv, { authTagLength: 16 });
  seal.setAAD(header);
  return Buffer.concat([header, seal.update(Buffer.from([1, 0, 21])), seal.final(), seal.getAuthTag()]);
}

// The length of the server's first flight: all records up to the one that
// completes its Finished. 0 while `bytes` does not hold the whole flight. The
// relay opens the records under the server's handshake traffic secret to find
// the Finished, so the way TCP splits the flight does not matter.
function flightLength(bytes, secret) {
  let keys;
  let messages = Buffer.alloc(0);
  let sequence = 0;
  for (let at = 0; at + 5 <= bytes.length; ) {
    const end = at + 5 + bytes.readUInt16BE(at + 3);
    if (end > bytes.length) return 0;
    if (bytes[at] === 23) {
      keys ??= trafficKeys(bytes, secret);
      const nonce = Buffer.from(keys.iv);
      nonce[11] ^= sequence++;
      const open = createDecipheriv(keys.cipher, keys.key, nonce, { authTagLength: 16 });
      open.setAAD(bytes.subarray(at, at + 5));
      open.setAuthTag(bytes.subarray(end - 16, end));
      const inner = Buffer.concat([open.update(bytes.subarray(at + 5, end - 16)), open.final()]);
      // A record holds its content, then the content type, then zero padding.
      const contentType = inner.findLastIndex(byte => byte !== 0);
      messages = Buffer.concat([messages, inner.subarray(0, contentType)]);
      for (let message = 0; message + 4 <= messages.length; ) {
        const next = message + 4 + messages.readUIntBE(message + 1, 3);
        if (next > messages.length) break;
        // Handshake message type 20 is Finished.
        if (messages[message] === 20) return end;
        message = next;
      }
    }
    at = end;
  }
  return 0;
}

// A HelloRequest as the first record behind the Finished of a TLS 1.2 server
// that resumed a session with TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 (RFC 5246,
// sections 5, 6.3 and 7.4.1.1, and RFC 5288). `hello` starts with the hello
// record of each side, which carries its random at offset 11.
function sealedHelloRequest(clientHello, serverHello, masterSecret) {
  const seed = Buffer.concat([
    Buffer.from("key expansion"),
    serverHello.subarray(11, 43),
    clientHello.subarray(11, 43),
  ]);
  let a = seed;
  let keyBlock = Buffer.alloc(0);
  while (keyBlock.length < 40) {
    a = createHmac("sha256", masterSecret).update(a).digest();
    keyBlock = Buffer.concat([keyBlock, createHmac("sha256", masterSecret).update(a).update(seed).digest()]);
  }
  // The Finished was record 0 under the server's key, so this is record 1.
  const sequence = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);
  const helloRequest = Buffer.from([0, 0, 0, 0]);
  const seal = createCipheriv(
    "aes-128-gcm",
    keyBlock.subarray(16, 32),
    Buffer.concat([keyBlock.subarray(36, 40), sequence]),
    {
      authTagLength: 16,
    },
  );
  seal.setAAD(Buffer.concat([sequence, Buffer.from([22, 3, 3, 0, helloRequest.length])]));
  const body = Buffer.concat([sequence, seal.update(helloRequest), seal.final(), seal.getAuthTag()]);
  return Buffer.concat([Buffer.from([22, 3, 3, 0, body.length]), body]);
}

// The types of the whole records in `bytes`.
function recordTypes(bytes) {
  const types = [];
  for (let at = 0; at + 5 <= bytes.length && at + 5 + bytes.readUInt16BE(at + 3) <= bytes.length; ) {
    types.push({ 20: "ChangeCipherSpec", 21: "Alert", 22: "Handshake", 23: "ApplicationData" }[bytes[at]]);
    at += 5 + bytes.readUInt16BE(at + 3);
  }
  return types;
}

// The length of the first flight of a TLS 1.2 server that resumes a session:
// ServerHello, ChangeCipherSpec, Finished. 0 for any other start.
function resumedFlightLength(bytes) {
  if (recordTypes(bytes).slice(0, 3).join() !== "Handshake,ChangeCipherSpec,Handshake") return 0;
  let at = 0;
  for (let record = 0; record < 3; record++) at += 5 + bytes.readUInt16BE(at + 3);
  return at;
}

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
  "destroySoon()": socket => socket.destroySoon(),
};

// A second TLS connection of this process.
async function secondConnection() {
  const server = tls.createServer({ key: pem("agent1-key.pem"), cert: pem("agent1-cert.pem") }, socket => {
    socket.on("error", () => {});
    socket.resume();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const socket = tls.connect({
    host: "127.0.0.1",
    port: server.address().port,
    ca: pem("ca1-cert.pem"),
    servername: "agent1",
  });
  socket.on("error", () => {});
  await once(socket, "secureConnect");
  return {
    socket,
    close() {
      socket.destroy();
      server.close();
    },
  };
}

const helloRequestMode = "a HelloRequest behind the server's Finished";

export async function report(mode, version) {
  const second =
    mode === "checkServerIdentity function that writes to another TLS socket" ? await secondConnection() : null;
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
    ciphers: mode === helloRequestMode ? "ECDHE-RSA-AES128-GCM-SHA256" : undefined,
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
  // The server derives its secrets before it sends the flight they protect.
  const secrets = {};
  server.on("keylog", line => {
    const [label, , secret] = line.toString().trim().split(" ");
    secrets[label] = Buffer.from(secret, "hex");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  // What the relay puts behind the server's Finished, in the same write.
  const behindFinished = {
    "a junk record behind the server's Finished": () => junkRecord,
    "a close_notify behind the server's Finished": flight => sealedCloseNotify(flight, secrets.SERVER_TRAFFIC_SECRET_0),
  }[mode];

  let fromClient = [];
  // What the client sent behind the HelloRequest, once its new ClientHello is in.
  const behindHelloRequest = Promise.withResolvers();
  const relay = net.createServer(downstream => {
    fromClient = [];
    let flight = behindFinished ? Buffer.alloc(0) : null;
    let resumedFlight = mode === helloRequestMode ? Buffer.alloc(0) : null;
    let frozenAt = -1;
    const upstream = net.connect(server.address().port, "127.0.0.1");
    downstream.on("data", chunk => {
      fromClient.push(chunk);
      if (frozenAt < 0) return void upstream.write(chunk);
      // The new ClientHello is the one long record. It leaves last.
      const sent = Buffer.concat(fromClient).subarray(frozenAt);
      for (let at = 0; at + 5 <= sent.length; at += 5 + sent.readUInt16BE(at + 3)) {
        if (sent.readUInt16BE(at + 3) > 100 && at + 5 + sent.readUInt16BE(at + 3) <= sent.length) {
          behindHelloRequest.resolve(recordTypes(sent));
        }
      }
    });
    upstream.on("data", chunk => {
      if (frozenAt >= 0) return;
      if (resumedFlight) {
        resumedFlight = Buffer.concat([resumedFlight, chunk]);
        const length = resumedFlightLength(resumedFlight);
        if (length) {
          const sent = Buffer.concat(fromClient);
          frozenAt = sent.length;
          const helloRequest = sealedHelloRequest(sent, resumedFlight, secrets.CLIENT_RANDOM);
          return void downstream.write(Buffer.concat([resumedFlight.subarray(0, length), helloRequest]));
        }
        // A full handshake starts with three handshake records. Only the
        // first flight of a connection can be a resumed one.
        if (recordTypes(resumedFlight).length < 3) return;
        chunk = resumedFlight;
        resumedFlight = null;
      }
      if (flight) {
        flight = Buffer.concat([flight, chunk]);
        const length = flightLength(flight, secrets.SERVER_HANDSHAKE_TRAFFIC_SECRET);
        if (!length) return;
        chunk = Buffer.concat([flight.subarray(0, length), behindFinished(flight), flight.subarray(length)]);
        flight = null;
      }
      downstream.write(chunk);
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
    case "a close_notify behind the server's Finished":
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
    case helloRequestMode: {
      // The relay keeps what the client sends from here on, so the server sees no more of it.
      const socket = tls.connect(await resume(accepted), () => client.push(`reused:${socket.isSessionReused()}`));
      closed = watch(socket);
      client.push(...(await behindHelloRequest.promise));
      socket.destroy();
      break;
    }
    case "tls.connect({ socket }) and a destroy() of that socket": {
      // The raw socket closes its handle two loop turns after its destroy().
      const raw = net.connect(port, "127.0.0.1");
      raw.on("error", () => {});
      await once(raw, "connect");
      closed = watch(tls.connect({ ...accepted, socket: raw }, () => raw.destroy()));
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
