// Server for bun-serve-date.test.ts. PROTOCOL picks what it speaks: "http1.1" is plain HTTP,
// "http2" is TLS with ALPN h2, and "http3" is QUIC with no TCP listener at all. Every response
// carries x-now, this process's clock when the handler returned it. Prints the port on stdout
// once listening and stops on stdin EOF.
const protocol = process.env.PROTOCOL;

const server = Bun.serve({
  port: 0,
  tls: protocol === "http1.1" ? undefined : { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! },
  http2: protocol === "http2",
  http3: protocol === "http3",
  http1: protocol !== "http3",
  fetch(req) {
    // Holds the event loop until the second has changed, so nothing scheduled on the loop can
    // run before the response is written.
    if (new URL(req.url).pathname === "/block") Bun.sleepSync(1200);
    return new Response("ok", { headers: { "x-now": String(Date.now()) } });
  },
});

console.log(server.port);

// stop(true) sends CONNECTION_CLOSE, so the test's pooled QUIC session is dropped and not left
// retransmitting to a dead port. The timer gives the kernel a tick to deliver that datagram.
process.stdin.on("end", () => {
  server.stop(true);
  setTimeout(() => process.exit(0), 100);
});
process.stdin.resume();
