// Fixture for fetch-proxy-tunnel-close-uaf.test.ts. Run as a subprocess so the
// parent can strip NO_PROXY/HTTP_PROXY from the environment (loopback proxies
// are otherwise bypassed).
//
// Drives proxied https fetches whose final response bytes and TLS close_notify
// arrive in a single read on Bun's tunnel socket. That makes the inner-TLS
// SSL_read loop return the body, then SSL_ERROR_ZERO_RETURN, inside one
// SSLWrapper::handle_reading: the body flush completes the request and frees the
// HTTPClient, and the close callback that follows in the same dispatch used to
// deref the freed client (heap-use-after-free in ProxyTunnel::on_close).
//
// UAF_MODE=ok       : valid Content-Length body; every fetch must resolve to "ok".
// UAF_MODE=malformed: a broken chunked body coalesced with close_notify; every
//                     fetch must REJECT (the error teardown still has to run, so
//                     the error is not swallowed, does not hang, and does not UAF).
//
// The upstream sends the response then a TLS close_notify, cork-coalesced into
// one write. The CONNECT proxy forwards every chunk as a single write, so the
// coalesced body+close_notify reach Bun in a single recv.
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";

const cert = process.env.UAF_CERT!;
const key = process.env.UAF_KEY!;
const ITERS = Number(process.env.UAF_ITERS ?? 30);
const MODE = process.env.UAF_MODE ?? "ok";

// Prove every iteration actually traversed the CONNECT tunnel: `connects` counts
// proxy -> upstream tunnels opened, `served` counts requests the upstream
// received. The target is loopback-reachable, so without these a regression that
// bypasses the `proxy:` option (direct connection) would produce the same
// resolved/rejected split without ever touching ProxyTunnel.
let connects = 0;
let served = 0;

const upstream = tls.createServer({ key, cert }, sock => {
  sock.once("data", () => {
    served++;
    const res =
      MODE === "malformed"
        ? // Invalid chunk size ("zz" is not hex) -> chunked decode error.
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nzz\r\n"
        : "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
    sock.cork();
    sock.write(res);
    sock.end(); // close_notify right behind the response record
    process.nextTick(() => sock.uncork());
  });
  sock.on("error", () => {});
});
await once(upstream.listen(0, "127.0.0.1"), "listening");
const upPort = (upstream.address() as net.AddressInfo).port;

const proxy = net.createServer(client => {
  // Accumulate until the full CONNECT request line + headers arrive; TCP is a
  // stream, so the request can span reads under load.
  let head = "";
  const onHead = (buf: Buffer) => {
    head += buf.toString("latin1");
    if (!head.includes("\r\n\r\n")) return;
    client.off("data", onHead);
    const m = /^CONNECT\s+([^:]+):(\d+)/.exec(head);
    if (!m) return client.destroy();
    const up = net.connect(Number(m[2]), m[1], () => {
      connects++;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      client.on("data", d => up.write(d));
      // Forward each upstream chunk as a single write. The upstream cork-coalesces
      // the response and its TLS close_notify into one chunk, so that chunk reaches
      // Bun's tunnel socket in one recv (body, then SSL_ERROR_ZERO_RETURN, in one
      // handle_reading). Do not wait for upstream 'end': TLS graceful close
      // half-waits for Bun's close_notify, which never comes (Bun completes on the
      // response itself), so end the client when the upstream socket closes.
      up.on("data", d => client.write(d));
      up.on("end", () => client.end());
      up.on("close", () => client.end());
      up.on("error", () => client.destroy());
    });
    up.on("error", () => client.destroy());
  };
  client.on("data", onHead);
  client.on("error", () => {});
});
await once(proxy.listen(0, "127.0.0.1"), "listening");
const proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

let resolved = 0;
let rejected = 0;
for (let i = 0; i < ITERS; i++) {
  try {
    const r = await fetch(`https://127.0.0.1:${upPort}/`, {
      proxy: proxyUrl,
      tls: { rejectUnauthorized: false },
      keepalive: false,
    });
    if ((await r.text()) === "ok") resolved++;
  } catch {
    rejected++;
  }
}

upstream.close();
proxy.close();
// Print all four counts so the parent asserts the full invariant: connects and
// served == ITERS prove every iteration traversed the tunnel and reached the
// upstream (not a direct connection), and the resolved/rejected split is exact
// (resolved=N/rejected=0 for ok, resolved=0/rejected=N for malformed). A
// proxy/TLS/setup failure shows up as the wrong counts rather than masquerading
// as the expected outcome, a swallowed error (hang) never reaches this line, and
// a heap-use-after-free aborts the process under ASan before it prints.
console.log(
  `PROXY_TUNNEL_CLOSE_UAF connects=${connects} served=${served} resolved=${resolved} rejected=${rejected} of ${ITERS}`,
);
process.exit(0);
