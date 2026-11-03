import http2 from "node:http2";

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
  http2: true,
  http3: true,
  fetch(request: Request) {
    return new Response(`answered ${new URL(request.url).pathname}`);
  },
} as never);
for (const protocol of ["http3", "http2", "http1.1"]) {
  const response = await fetch(`https://127.0.0.1:${server.port}/over-${protocol}`, {
    protocol,
    tls: { rejectUnauthorized: false },
  } as never);
  console.log(response.status, await response.text());
}
server.stop(true);

const plain = http2.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end(`node:http2 answered ${request.url} over HTTP/${request.httpVersion}`);
});
await new Promise<void>(resolve => plain.listen(0, "127.0.0.1", resolve));
const session = http2.connect(`http://127.0.0.1:${(plain.address() as { port: number }).port}`);
const stream = session.request({ ":path": "/from-node" });
let text = "";
stream.setEncoding("utf8").on("data", piece => (text += piece));
await new Promise<void>(resolve => stream.on("end", resolve));
console.log(text);
session.close();
plain.close();
