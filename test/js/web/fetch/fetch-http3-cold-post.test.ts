import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tls } from "harness";
import { join } from "node:path";

// A large first request on a cold h3 connection must not starve the client's
// TLS Finished. lsquic invokes on_hsk_done from inside ci_tick's crypto-read
// phase while the 36-byte Finished is still only on the HSK crypto stream's
// frab list; writing the request synchronously from on_new_stream there
// filled the send controller and (when the pacer throttled) left the Finished
// unpacketized, so the server stayed a mini-conn and dropped every 1-RTT
// packet until the handshake timeout. The fix defers the whole request to
// on_write, which lsquic's priority iterator serves after the crypto stream.

// Deterministic check via the lsquic debug log: on a cold connection the
// 36-byte CRYPTO frame (client Finished) must be generated before the first
// app STREAM frame. Before the fix, on_new_stream wrote the request
// synchronously, so "generated STREAM frame: stream 0" appeared ahead of
// "generated CRYPTO frame: offset: 0, size: 36". After the fix, lsquic's
// priority iterator serves the crypto stream first in on_write, so the order
// flips. This is independent of pacer timing (the STREAM frames go into the
// buffered queue either way; what changes is whether they are generated from
// inside on_new_stream or from on_write after the crypto stream).
// BUN_DEBUG_lsquic is only wired up under BUN_DEBUG.
test.skipIf(!isDebug)("the TLS Finished is packetized before the first app STREAM frame", async () => {
  const fixture = `
    const tls = ${JSON.stringify(tls)};
    await using server = Bun.serve({
      port: 0, hostname: "127.0.0.1", tls, http3: true, http1: false,
      async fetch(req) { return new Response(String((await req.arrayBuffer()).byteLength)); },
    });
    const res = await fetch("https://127.0.0.1:" + server.port + "/", {
      method: "POST",
      body: Buffer.alloc(1_000_000, 0x61),
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    });
    console.log("RESULT", await res.text());
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_DEBUG_lsquic: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Both client and server log to the same process; the client's Finished is
  // the one whose CRYPTO frame is exactly 36 bytes at HSK offset 0.
  const finished = stderr.match(/generated CRYPTO frame: offset: 0, size: 36\b/);
  const firstAppData = stderr.match(/generated STREAM frame: stream 0, offset: 0,/);
  expect(stdout).toBe("RESULT 1000000\n");
  expect(finished).not.toBeNull();
  expect(firstAppData).not.toBeNull();
  expect(finished!.index).toBeLessThan(firstAppData!.index!);
  expect(exitCode).toBe(0);
});

// End-to-end regression coverage: a batch of cold handshakes with a large
// body and a multi-packet header block each complete. The race itself depends
// on lsquic's pacer engaging during the initial burst, which needs the
// handshake RTT to exceed a few ms; on an idle machine it rarely does, so
// this asserts the fixed code path rather than reproducing the deadlock.
// The fixture spawns sixteen subprocess debug builds (each a cold QUIC
// handshake), which cannot fit in the 5 s default.
test("large first request on a cold connection does not strand the TLS Finished", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-http3-cold-post-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
}, 30_000);
