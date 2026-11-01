import tls from "node:tls";

const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsQw5C2LT40FXa7TR
A8GG8SBy2jpXwp1/1C/e0LJ+4C2hRANCAAS8unCZfee7/NWNozJWd8egIu9xCFKa
uXanGlc2FWwpK+uz7JKnKQa2pZ/wEFq7wXG50L5JJfBisYZnn8pSF3rZ
-----END PRIVATE KEY-----
`;
const cert = `-----BEGIN CERTIFICATE-----
MIIBPjCB5aADAgECAgkAswvxD+a9HdwwCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJ
bG9jYWxob3N0MCAXDTI2MTAxNzE5MzAyOFoYDzIxMjYwOTIzMTkzMDI4WjAUMRIw
EAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAS8unCZ
fee7/NWNozJWd8egIu9xCFKauXanGlc2FWwpK+uz7JKnKQa2pZ/wEFq7wXG50L5J
JfBisYZnn8pSF3rZox4wHDAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYI
KoZIzj0EAwIDSAAwRQIhAJgYLk7C/yTba2rAlGW6Xv4JCRb5DeQ2NdmN78N7kj6q
AiAO7OnjTNLRBP1TU0RvKDr2CO+zKxDWkvVLzGAxkCy1yw==
-----END CERTIFICATE-----
`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  tls: { key, cert },
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response(`served over ${new URL(request.url).protocol}`);
  },
  websocket: {
    message(socket, message) {
      socket.send(`echoed ${message}`);
    },
  },
});
const response = await fetch(`https://127.0.0.1:${server.port}/`, { tls: { ca: cert } } as never);
console.log(response.status, await response.text());
console.log(
  await fetch(`https://127.0.0.1:${server.port}/`).then(
    () => "trusted",
    (error: Error & { code?: string }) => error.code,
  ),
);

const overWebSocket = Promise.withResolvers<string>();
const webSocket = new WebSocket(`wss://127.0.0.1:${server.port}/`, { tls: { ca: cert } } as never);
webSocket.onopen = () => webSocket.send("over wss");
webSocket.onmessage = event => overWebSocket.resolve(String(event.data));
webSocket.onerror = () => overWebSocket.resolve("failed");
console.log(await overWebSocket.promise);
webSocket.close();
server.stop(true);

const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: { key, cert },
  socket: {
    data(socket, bytes) {
      socket.write(`echoed ${bytes}`);
    },
  },
});
const answered = Promise.withResolvers<string>();
const socket = await Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  tls: { ca: cert },
  socket: {
    handshake(socket, authorized) {
      socket.write(`authorized ${authorized}`);
    },
    data(_socket, bytes) {
      answered.resolve(bytes.toString());
    },
  },
});
console.log(await answered.promise, socket.getTLSVersion());
const peer = socket.getPeerX509Certificate()!;
console.log(peer.subject, peer.subjectAltName, peer.publicKey.asymmetricKeyType);
socket.end();

const fromNode = Promise.withResolvers<string>();
const nodeSocket = tls.connect({ host: "127.0.0.1", port: listener.port, ca: cert }, () =>
  nodeSocket.write(`node:tls ${nodeSocket.authorized}`),
);
nodeSocket.on("data", bytes => fromNode.resolve(`${bytes} ${nodeSocket.getCipher().standardName.startsWith("TLS_")}`));
nodeSocket.on("error", error => fromNode.resolve(String(error)));
console.log(await fromNode.promise);
nodeSocket.destroy();
listener.stop(true);
console.log(tls.rootCertificates.length > 100);
