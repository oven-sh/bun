import { expect, test } from "bun:test";
import http from "node:http";

// Staged variant of test/js/bun/test/parallel/
// test-http-should-not-emit-or-throw-error-when-writing-after-socket.end.ts,
// which times out on the Windows agents with no output. Each stage is awaited
// separately so a platform hang names the stage it stalled in instead of
// timing out silently: the server half-closes (res.socket.end()) while the
// client is mid-upload, a write() after that must succeed silently, the
// client's failed upload must not strand the connection, and server.close()
// must complete once the connection dies.
test("write after res.socket.end() mid-upload completes every teardown stage", async () => {
  const stages: string[] = [];
  const stage = (name: string) => {
    stages.push(name);
    console.error("STAGE:", name);
  };

  const writeResult = Promise.withResolvers<boolean>();
  const connectionClosed = Promise.withResolvers<void>();

  const server = http.createServer((req, res) => {
    stage("request-received");
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

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  stage("listening");

  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const fetchSettled = fetch(url, {
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

  expect(await withTimeout(writeResult.promise, "write-after-end")).toBeTrue();
  await withTimeout(fetchSettled, "fetch-settled");
  await withTimeout(connectionClosed.promise, "connection-closed");
  const serverClosed = new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
  await withTimeout(serverClosed, "server-closed");
  expect(stages).toContain("write-returned");
}, 45_000);
