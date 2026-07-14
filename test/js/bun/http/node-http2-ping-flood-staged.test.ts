import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

// Staged variant of the vendored test-http2-ping-flood.js, which times out on
// the windows-11-aarch64 agent with no output across four attempts. Same
// contract - a client that floods PINGs without reading must get the session
// torn down (outbound-ACK flood guard) - but each stage is awaited under its
// own deadline so a platform hang reports the reached-stage list instead of a
// silent timeout.
const kClientMagic = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const kSettings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
const kPing = Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);

test("PING flood tears the session down at every stage", async () => {
  const stages: string[] = [];
  const stage = (name: string) => {
    stages.push(name);
    console.error("STAGE:", name);
  };

  const sessionSeen = Promise.withResolvers<http2.ServerHttp2Session>();
  const sessionErrored = Promise.withResolvers<Error>();
  const sessionClosed = Promise.withResolvers<void>();

  const server = http2.createServer();
  server.on("session", session => {
    stage("session");
    sessionSeen.resolve(session);
    session.on("error", e => {
      stage("session-error");
      sessionErrored.resolve(e as Error);
    });
    session.on("close", () => {
      stage("session-close");
      sessionClosed.resolve();
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  stage("listening");

  const client = net.connect((server.address() as any).port, "127.0.0.1");
  client.on("error", () => {});
  let interval: ReturnType<typeof setInterval> | undefined;
  const startFlood = () => {
    interval = setInterval(() => {
      for (let n = 0; n < 10000; n++) client.write(kPing);
    }, 1);
  };
  client.on("connect", () => {
    client.write(kClientMagic, () => client.write(kSettings, startFlood));
  });

  const withTimeout = <T>(p: Promise<T>, name: string) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`stage timed out: ${name}; reached: ${stages.join(" -> ")}`)),
          10_000,
        ),
      ),
    ]);

  try {
    await withTimeout(sessionSeen.promise, "session");
    const err: any = await withTimeout(sessionErrored.promise, "session-error");
    expect(err.code).toBe("ERR_HTTP2_ERROR");
    expect(err.message).toContain("Flooding was detected");
    await withTimeout(sessionClosed.promise, "session-close");
  } finally {
    if (interval) clearInterval(interval);
    client.destroy();
    server.close();
  }
  expect(stages).toContain("session-close");
}, 45_000);
