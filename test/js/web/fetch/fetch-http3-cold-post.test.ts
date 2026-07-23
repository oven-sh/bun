import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// A large first request on a cold h3 connection must not starve the client's
// TLS Finished. lsquic invokes on_hsk_done from inside ci_tick's crypto-read
// phase while the 36-byte Finished is still only on the HSK crypto stream's
// frab list; writing the request synchronously from on_new_stream there
// filled the send controller and (when the pacer throttled) left the Finished
// unpacketized, so the server stayed a mini-conn and dropped every 1-RTT
// packet until the handshake timeout. The fix defers the whole request to
// on_write, which lsquic's priority iterator serves after the crypto stream.
//
// The race depends on lsquic's pacer engaging during the initial burst, which
// in turn needs the handshake RTT to exceed a few ms; on an idle machine it
// rarely does, so this test is regression coverage for the fixed code path
// rather than a deterministic reproduction. The lsquic debug trace in the PR
// that introduced this test shows the deadlock directly.
//
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
