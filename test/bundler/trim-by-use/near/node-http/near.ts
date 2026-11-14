// node:net and node:tls ask of a socket whether node:http has it
import net from "node:net";
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

const server = net.createServer(plain => {
  const secure = new tls.TLSSocket(plain, { isServer: true, key, cert });
  secure.on("data", bytes => secure.end(`echoed ${bytes}`));
});
server.listen(0, "127.0.0.1", () => {
  const plain = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1", () => {
    const secure = tls.connect({ socket: plain, ca: cert, servername: "localhost" }, () => secure.write("hello"));
    secure.pause().resume();
    secure.on("data", bytes => console.log(String(bytes), secure.authorized, secure.bytesRead, secure.bytesWritten));
    secure.on("close", () => server.close());
  });
});
