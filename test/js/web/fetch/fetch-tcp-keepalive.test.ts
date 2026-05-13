// Verifies that fetch() enables TCP keepalive (SO_KEEPALIVE + TCP_KEEPIDLE)
// on its client sockets, matching Node/undici behavior. Without it, a
// half-open connection (peer silently gone — NAT timeout, network break)
// hangs until an application-level timeout instead of failing at ~70s.
//
// Linux-only: reads /proc/<pid>/net/tcp for the kernel's view of the
// socket's keepalive timer. Other platforms skip.
import { expect, test } from "bun:test";

test.skipIf(process.platform !== "linux")("fetch sockets have TCP keepalive enabled", async () => {
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
  // Await headers + first chunk so the socket is ESTABLISHED and the
  // client's outbound GET has been ACKed (piggybacked on the response)
  // before we read /proc — otherwise a retransmit timer (01) could mask
  // the keepalive timer (02) in the kernel's timer field.
  const resp = await fetch(`http://127.0.0.1:${port}/`);
  const reader = resp.body!.getReader();
  await reader.read();

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

  // Drain the fetch so the server can clean up
  await reader.cancel();

  expect(found).toBe(true);
  // Without SO_KEEPALIVE: "00". With it: "02" (sk_timer / keepalive armed).
  expect(timerActive).toBe("02");
});
