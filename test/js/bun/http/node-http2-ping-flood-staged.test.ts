import { expect, test } from "bun:test";
import { isIPv6 } from "harness";
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

async function runFloodStages(host: string | undefined) {
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

  await new Promise<void>(resolve =>
    host === undefined ? server.listen(0, resolve) : server.listen(0, host, resolve),
  );
  stage("listening");

  const client =
    host === undefined
      ? net.connect((server.address() as any).port)
      : net.connect((server.address() as any).port, host);
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
        setTimeout(() => reject(new Error(`stage timed out: ${name}; reached: ${stages.join(" -> ")}`)), 10_000),
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
}

test("PING flood tears the session down at every stage (IPv4 loopback)", () => runFloodStages("127.0.0.1"), 45_000);

// The vendored test-http2-ping-flood.js floods over the default-host connect
// path, which resolves to the IPv6 loopback on the Windows agents - and times
// out there while the IPv4 variant passes. If the v6 loopback absorbs the
// flood without ever jamming, no queue-depth guard (ours or nghttp2's) can
// trip; this subtest measures whether the family is the variable.
test.skipIf(!isIPv6())(
  "PING flood tears the session down at every stage (IPv6 loopback)",
  () => runFloodStages("::1"),
  45_000,
);

// The vendored test's exact connection shape: dual-stack listener
// (listen(0) binds ::) with the default-host client connect - the
// v4-mapped-over-dual path, distinct from both pure-family variants above.
test("PING flood tears the session down at every stage (dual-stack default)", () => runFloodStages(undefined), 45_000);
