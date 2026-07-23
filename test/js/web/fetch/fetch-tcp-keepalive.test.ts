// Verifies that fetch() enables TCP keepalive (SO_KEEPALIVE + TCP_KEEPIDLE)
// on its client sockets, matching Node/undici behavior, and that
// `keepalive: false` (the existing RequestInit option that also disables
// HTTP connection pooling) skips it. node:http forwards `agent.keepAlive`
// to fetch's `keepalive`, so the same gate covers Node compat.
//
// Linux-only: reads /proc/<pid>/net/tcp for the kernel's view of the
// socket's keepalive timer. Other platforms skip.
import { expect, test } from "bun:test";
import http from "node:http";

const linuxOnly = test.skipIf(process.platform !== "linux");

// Spin up a server that holds the response open, run the request via
// `startRequest`, and return the kernel timer field for the client
// socket. The server is fresh per call so the connection pool can't
// reuse a socket from a previous test (different port → different key).
async function probeClientSocket(startRequest: (url: string) => Promise<{ drain: () => Promise<void> }>) {
  // Server that holds the connection open so the client socket stays
  // ESTABLISHED long enough to inspect.
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Keep the response streaming so the client socket stays open
      // while we inspect /proc/net/tcp from the client side.
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("hold"));
            await Bun.sleep(500);
            controller.close();
          },
        }),
      );
    },
  });

  const port = server.port;
  const { drain } = await startRequest(`http://127.0.0.1:${port}/`);

  // Parse /proc/self/net/tcp: find ESTABLISHED (state 01) socket with
  // remote port = server.port. Column 5 is the timer field
  // "<timer_active>:<jiffies_until_expiry>". Per net/ipv4/tcp_ipv4.c
  // get_tcp4_sock(): 0=no timer, 1=retransmit, 4=zero-window probe,
  // 2=sk_timer armed — which is the keepalive timer on an idle
  // established socket. Empirically: without SO_KEEPALIVE this field is
  // "00:00000000"; with it, "02:<jiffies>".
  const tcp = await Bun.file("/proc/self/net/tcp").text();
  const portHex = port.toString(16).toUpperCase().padStart(4, "0");
  let found = false;
  let timerActive = "";
  for (const line of tcp.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [, remote, state, , timer] = cols.slice(1, 6);
    // remote = server port. state 01 = ESTABLISHED. The client socket's
    // remote_address is the server; the server's listening socket has
    // state 0A and the server's accepted socket has the client port in
    // remote — so this matches only the client side.
    if (state === "01" && remote.endsWith(":" + portHex)) {
      found = true;
      timerActive = timer.split(":")[0];
    }
  }

  await drain();
  expect(found).toBe(true);
  return timerActive;
}

// Await headers + first chunk so the socket is ESTABLISHED and the
// client's outbound GET has been ACKed (piggybacked on the response)
// before we read /proc — otherwise a retransmit timer (01) could mask
// the keepalive timer (02) in the kernel's timer field.
async function fetchAndHold(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const reader = resp.body!.getReader();
  await reader.read();
  return { drain: () => reader.cancel() };
}

linuxOnly("fetch sockets have TCP keepalive enabled", async () => {
  const timerActive = await probeClientSocket(url => fetchAndHold(url));
  // Without SO_KEEPALIVE: "00". With it: "02" (sk_timer / keepalive armed).
  expect(timerActive).toBe("02");
});

linuxOnly("fetch keepalive: false skips SO_KEEPALIVE (matches undici options.keepAlive)", async () => {
  const timerActive = await probeClientSocket(url => fetchAndHold(url, { keepalive: false }));
  expect(timerActive).toBe("00");
});

linuxOnly("node:http with non-keepalive Agent skips SO_KEEPALIVE", async () => {
  // `agent: false` constructs a fresh `new Agent()` whose `keepAlive`
  // defaults to false; _http_client.ts forwards that as fetch
  // `keepalive: false`.
  const timerActive = await probeClientSocket(async url => {
    const { promise, resolve, reject } = Promise.withResolvers<http.IncomingMessage>();
    const req = http.get(url, { agent: false }, resolve);
    req.on("error", reject);
    const res = await promise;
    await new Promise<void>(r => res.once("data", () => r()));
    return {
      drain: async () => {
        res.destroy();
        req.destroy();
      },
    };
  });
  expect(timerActive).toBe("00");
});

linuxOnly("node:http globalAgent (keepAlive: true) enables SO_KEEPALIVE", async () => {
  const timerActive = await probeClientSocket(async url => {
    const { promise, resolve, reject } = Promise.withResolvers<http.IncomingMessage>();
    const req = http.get(url, resolve);
    req.on("error", reject);
    const res = await promise;
    await new Promise<void>(r => res.once("data", () => r()));
    return {
      drain: async () => {
        res.destroy();
        req.destroy();
      },
    };
  });
  expect(timerActive).toBe("02");
});
