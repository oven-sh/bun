// Counts the SSL_CTX of this process before any request, and again while `requests` requests with one `tls` option
// are all in flight through a CONNECT proxy, each in a tunnel of its own. Prints `{ before, during, bodies }`.
//
// argv: a JSON object `{ tls, proxyTls, requests, directFirst }`.
import { sslCtxLiveCount } from "bun:internal-for-testing";
import { tls as tlsCert } from "harness";
import { clearProxyEnv, createAdversarialProxy } from "./proxy-stress-helpers";

clearProxyEnv();
const { tls, proxyTls, requests, directFirst } = JSON.parse(process.argv[2]) as {
  tls: Bun.TLSOptions;
  proxyTls: boolean;
  requests: number;
  directFirst: boolean;
};

let arrived = 0;
let hold = false;
const allArrived = Promise.withResolvers<void>();
const release = Promise.withResolvers<void>();
using origin = Bun.serve({
  port: 0,
  tls: tlsCert,
  async fetch() {
    if (hold) {
      if (++arrived === requests) allArrived.resolve();
      await release.promise;
    }
    return new Response("ok");
  },
});
await using proxy = await createAdversarialProxy({ tls: proxyTls });
const url = `https://localhost:${origin.port}/`;

const before = sslCtxLiveCount();
if (directFirst) await (await fetch(url, { tls })).text();
hold = true;
const responses = Array.from({ length: requests }, () => fetch(url, { proxy: proxy.url, tls, keepalive: false }));
await allArrived.promise;
const during = sslCtxLiveCount();
release.resolve();
const bodies = await Promise.all(responses.map(async response => (await response).text()));

console.log(JSON.stringify({ before, during, bodies: [...new Set(bodies)], tunnels: proxy.connectCount() }));
