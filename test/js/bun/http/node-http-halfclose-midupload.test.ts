import { expect, test } from "bun:test";
import http from "node:http";
import type { Socket } from "node:net";

// Staged variant of test/js/bun/test/parallel/
// test-http-should-not-emit-or-throw-error-when-writing-after-socket.end.ts,
// which times out on the Windows agents with no output. Each stage is awaited
// separately so a platform hang names the stage it stalled in instead of
// timing out silently: the server half-closes (res.socket.end()) while the
// client is mid-upload, and a write() after that must succeed silently.
// Teardown is explicit: the half-closed connection is not guaranteed to close
// on its own (node behaves the same - after a raw socket.end() mid-upload no
// peer signal may ever arrive), but destroy must always deliver 'close'.
async function runTeardownStages(bind: string | undefined, url: (port: number) => string) {
  const stages: string[] = [];
  const stage = (name: string) => {
    stages.push(name);
    console.error("STAGE:", name);
  };

  const writeResult = Promise.withResolvers<boolean>();
  const connectionClosed = Promise.withResolvers<void>();
  let socket: Socket | undefined;

  const server = http.createServer((req, res) => {
    stage("request-received");
    socket = req.socket;
    res.writeHead(200, { "Connection": "close" });
    res.socket.end();
    stage("socket-ended");
    res.on("error", writeResult.reject);
    req.socket.on("close", () => {
      stage("connection-closed");
      connectionClosed.resolve();
    });
    try {
      writeResult.resolve(res.write("Hello, world!"));
      stage("write-returned");
    } catch (err) {
      writeResult.reject(err);
    }
  });

  await new Promise<void>(resolve =>
    bind === undefined ? server.listen(0, resolve) : server.listen(0, bind, resolve),
  );
  stage("listening");

  const fetchSettled = fetch(url((server.address() as any).port), {
    method: "POST",
    body: Buffer.allocUnsafe(1024 * 1024 * 10),
  })
    .then(res => res.bytes())
    .then(
      () => stage("fetch-resolved"),
      () => stage("fetch-rejected"),
    );

  const withTimeout = <T>(p: Promise<T>, name: string) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`stage timed out: ${name}; reached: ${stages.join(" -> ")}`)), 8_000),
      ),
    ]);

  try {
    expect(await withTimeout(writeResult.promise, "write-after-end")).toBeTrue();
    await withTimeout(fetchSettled, "fetch-settled");
    // Not server.closeAllConnections(): bun's implementation also stops the
    // server, which makes the disposal/close below reject.
    socket?.destroy();
    await withTimeout(connectionClosed.promise, "connection-closed");
    const serverClosed = new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    await withTimeout(serverClosed, "server-closed");
    expect(stages).toContain("write-returned");
  } finally {
    socket?.destroy();
    server.close();
  }
}

test(
  "write after res.socket.end() mid-upload completes every teardown stage (IPv4 loopback)",
  () => runTeardownStages("127.0.0.1", port => `http://127.0.0.1:${port}`),
  45_000,
);

// The original test-http-should-not-emit-... fetches http://localhost against
// a default-bound (dual-stack) server - the IPv6 loopback on the Windows
// agents - and times out on windows-11-aarch64 while the IPv4 variant above
// passes there. Same family split as the PING-flood probe: if the teardown
// stalls only over the default path, the family is the variable.
test(
  "write after res.socket.end() mid-upload completes every teardown stage (default localhost)",
  () => runTeardownStages(undefined, port => `http://localhost:${port}`),
  45_000,
);

// The organic-close counterpart: no explicit destroy anywhere. The client
// completes its upload, stops reading the response (backpressure), FINs, then
// resets. The server's half-open socket has consumed the FIN, so only the
// kernel can report the reset - this hangs at connection-closed if the event
// layer loses that signal (macOS: no read filter left after the FIN).
test(
  "half-open node:http response socket closes after the peer resets behind pending writes",
  async () => {
    const stages: string[] = [];
    const stage = (name: string) => {
      stages.push(name);
      console.error("STAGE:", name);
    };

    const backpressured = Promise.withResolvers<void>();
    const requestEnded = Promise.withResolvers<void>();
    const connectionClosed = Promise.withResolvers<void>();
    const big = Buffer.alloc(4 * 1024 * 1024, 0x78);

    const server = http.createServer((req, res) => {
      stage("request-received");
      req.resume();
      req.on("end", () => {
        stage("request-ended");
        requestEnded.resolve();
      });
      req.socket.on("close", () => {
        stage("connection-closed");
        connectionClosed.resolve();
      });
      res.writeHead(200);
      const pump = () => {
        while (res.write(big)) {}
      };
      res.on("drain", pump);
      pump();
      backpressured.resolve();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    stage("listening");

    const withTimeout = <T>(p: Promise<T>, name: string) =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`stage timed out: ${name}; reached: ${stages.join(" -> ")}`)), 8_000),
        ),
      ]);

    try {
      const opened = Promise.withResolvers<import("bun").Socket>();
      await Bun.connect({
        hostname: "127.0.0.1",
        port: (server.address() as any).port,
        allowHalfOpen: true,
        socket: {
          open: s => opened.resolve(s),
          data() {},
          end() {},
          error: (_s, e) => opened.reject(e),
          close: () => opened.reject(new Error("peer closed before setup finished")),
        },
      });
      const peer = await opened.promise;
      peer.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello");
      peer.flush();
      peer.pause(); // never read the response: the server's writes stay pending
      await withTimeout(backpressured.promise, "response-backpressured");
      peer.shutdown(); // FIN: the server's half-open socket consumes it
      await withTimeout(requestEnded.promise, "request-ended");
      // The FIN-to-RST gap is where the bug lived; an immediate RST can
      // overtake the FIN and just read as ECONNRESET on the readable side.
      await Bun.sleep(50);
      peer.terminate(); // RST: only the kernel can tell the server now
      await withTimeout(connectionClosed.promise, "connection-closed");
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  },
  45_000,
);
