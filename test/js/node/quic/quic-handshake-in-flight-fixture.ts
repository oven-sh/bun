// Holds a QUIC handshake half way, and meanwhile makes the first lsquic engine of the API named in argv.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { SocketAddress } from "node:net";
import { connect, listen, type SessionOptions } from "node:quic";

const [api, keyPath, certPath] = process.argv.slice(2);
const key = readFileSync(keyPath);
const cert = readFileSync(certPath);
const hostname = "127.0.0.1";

const serve = () =>
  Bun.serve({ hostname, port: 0, tls: { key, cert }, http3: true, fetch: async req => new Response(await req.text()) });
const post = (port: number) =>
  fetch(`https://${hostname}:${port}/`, {
    method: "POST",
    body: "answered",
    protocol: "http3",
    tls: { rejectUnauthorized: false },
  } as RequestInit);
const listenQuic = () =>
  listen(
    session => {
      session.onerror = () => {};
      session.closed.catch(() => {});
    },
    { sni: { "*": { keys: [createPrivateKey(key)], certs: [cert] } }, alpn: ["quic-test"] },
  );

const serverPort = api === "node:quic" ? serve().port! : (await listenQuic()).address!.port;
const serverAnswered = Promise.withResolvers<void>();
let held: Buffer[] | undefined = [];
let clientPort: number;
// fetch() opens another connection if a handshake fails before the request is sent.
const clientConnectionIds = new Set<string>();
const relay = await Bun.udpSocket({
  hostname,
  socket: {
    data(socket, bytes, port) {
      if (port !== serverPort) {
        clientPort = port;
        // RFC 9000 section 17.2: the Source Connection ID of a long header.
        if (bytes[0] & 0x80) {
          const lengthAt = 6 + bytes[5];
          clientConnectionIds.add(bytes.toString("hex", lengthAt + 1, lengthAt + 1 + bytes[lengthAt]));
        }
        socket.send(bytes, serverPort, hostname);
      } else if (held) {
        held.push(Buffer.from(bytes));
        serverAnswered.resolve();
      } else {
        socket.send(bytes, clientPort, hostname);
      }
    },
  },
});

let result: Promise<string>;
if (api === "node:quic") {
  result = post(relay.port).then(res => res.text());
} else {
  const client = await connect(new SocketAddress({ address: hostname, port: relay.port }), {
    alpn: "quic-test",
    verifyPeer: "manual",
    onerror() {},
  } as SessionOptions);
  client.closed.catch(() => {});
  result = client.opened.then(() => "answered");
}
result.catch(serverAnswered.reject);
await serverAnswered.promise;

if (api === "node:quic") {
  await listenQuic();
} else if (api === "Bun.serve") {
  serve();
} else {
  // The HTTP thread has its engine once it sends.
  const sent = Promise.withResolvers<void>();
  const silent = await Bun.udpSocket({ hostname, socket: { data: () => sent.resolve() } });
  post(silent.port).catch(sent.reject);
  await sent.promise;
}

for (const bytes of held) relay.send(bytes, clientPort!, hostname);
held = undefined;

console.log(JSON.stringify({ result: await result.catch(err => err.message), connections: clientConnectionIds.size }));
process.exit(0);
