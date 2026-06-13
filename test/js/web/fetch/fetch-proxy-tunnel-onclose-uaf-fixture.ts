// Fixture for fetch-proxy-tunnel-onclose-uaf.test.ts
//
// Reproduces the ProxyTunnel stale-ctx UAF: SSLWrapper.handleReading decodes
// the HTTP response via triggerDataCallback (which completes the request and
// frees the HTTPClient synchronously), then the same handleReading call hits
// an SSL_ERROR_SSL and fires triggerCloseCallback with the stale ctx.
//
// To land the response and the SSL error in one handleReading(), the proxy
// waits until it has forwarded the client's encrypted HTTP request upstream,
// then appends a malformed TLS record to the next server→client chunk (the
// response). SSL_ERROR_SSL — unlike ZERO_RETURN — leaves
// received_ssl_shutdown=false so the keepalive/pool path is taken and the
// HTTPClient is freed before triggerCloseCallback.

import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

const cert = process.env.TLS_CERT!;
const key = process.env.TLS_KEY!;

const backend = tls.createServer({ key, cert }, s => {
  s.on("error", () => {});
  s.once("data", () => {
    // keep-alive so the client pools the tunnel on completion
    s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
  });
});
backend.listen(0, "127.0.0.1");
await once(backend, "listening");
const backendPort = (backend.address() as net.AddressInfo).port;

const proxy = net.createServer(client => {
  let head = Buffer.alloc(0);
  let upstream: net.Socket | undefined;
  client.on("error", () => upstream?.destroy());
  client.on("close", () => upstream?.destroy());
  const onHead = (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]);
    const headerEnd = head.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    client.removeListener("data", onHead);
    const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
    const [, hostPort] = firstLine.split(" ");
    const colon = hostPort!.lastIndexOf(":");
    upstream = net.connect(Number(hostPort!.slice(colon + 1)), hostPort!.slice(0, colon), () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const extra = head.subarray(headerEnd + 4);
      if (extra.length > 0) upstream!.write(extra);

      // Count client→upstream writes. The first carries the TLS client
      // handshake; the second (or later) carries the encrypted HTTP request.
      // Only after the request goes out can the next upstream chunk be the
      // HTTP response.
      let clientWrites = 0;
      let injected = false;
      client.on("data", d => {
        clientWrites++;
        upstream!.write(d);
      });
      upstream!.on("data", d => {
        if (injected) return;
        if (clientWrites >= 2) {
          // Response: append a bogus TLS record so SSL_read errors right
          // after decoding the response in the same BIO fill.
          const bad = Buffer.from([0x80, 0x03, 0x03, 0x00, 0x00]);
          client.write(Buffer.concat([d, bad]));
          injected = true;
          client.end();
          upstream!.destroy();
        } else {
          client.write(d);
        }
      });
    });
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => client.end());
  };
  client.on("data", onHead);
});
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const proxyPort = (proxy.address() as net.AddressInfo).port;

let ok = 0;
let err = 0;
for (let round = 0; round < 4; round++) {
  const batch: Promise<void>[] = [];
  for (let i = 0; i < 32; i++) {
    batch.push(
      fetch(`https://127.0.0.1:${backendPort}/`, {
        proxy: `http://127.0.0.1:${proxyPort}`,
        tls: { rejectUnauthorized: false },
      })
        .then(r => r.text())
        .then(() => {
          ok++;
        })
        .catch(() => {
          err++;
        }),
    );
  }
  await Promise.all(batch);
}
console.log(JSON.stringify({ ok, err }));
backend.close();
proxy.close();
