// When an async fetch handler rejects and error() returns a Response whose
// body is a ReadableStream, the stream must be allowed to finish.
// Previously handle_reject() fell through to render_missing() while the sink
// was still pumping, which force-ended the exchange after the first
// synchronous chunk (or with an empty Content-Length: 0 body if the stream's
// first pull awaited before enqueuing). With Connection: close the freed
// socket is then written by the orphaned sink: heap-use-after-free under ASAN.
//
// Each case runs in a subprocess so a pre-fix ASAN crash is observed as a
// test failure rather than killing the parent runner before junit is written.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "serve-error-handler-stream-fixture.ts");
const CHUNKS = 12;
const CHUNK_LEN = 64;

async function runFixture(path: string, close = false) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, path, ...(close ? ["close"] : [])],
    // Malloc=1 forces system malloc so bmalloc/libpas pools don't mask the
    // UAF from ASAN. bmalloc's SystemHeap is unimplemented on Windows and
    // would RELEASE_BASSERT, so leave bmalloc in place there (no ASAN lane
    // on Windows anyway).
    env: { ...bunEnv, ...(isWindows ? {} : { Malloc: "1" }) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("Bun.serve error() returning a streaming Response", () => {
  // Controls: neither path hits handle_reject()'s fallthrough.
  test.concurrent("control: plain streaming response completes", async () => {
    const { stdout, stderr, exitCode } = await runFixture("/plain");
    expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
      result: { status: 200, len: CHUNK_LEN * CHUNKS, pulls: CHUNKS + 1 },
      exitCode: 0,
    });
  });

  test.concurrent("control: sync throw -> error() stream completes", async () => {
    const { stdout, stderr, exitCode } = await runFixture("/sync");
    expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
      result: { status: 597, len: CHUNK_LEN * CHUNKS, pulls: CHUNKS + 1 },
      exitCode: 0,
    });
  });

  // The bug: async handler rejects, error() body is truncated to its
  // synchronous prefix.
  for (const close of [false, true]) {
    const tag = close ? " (Connection: close)" : "";

    test.concurrent(`async reject -> error() pull-stream completes${tag}`, async () => {
      const { stdout, stderr, exitCode } = await runFixture("/async", close);
      expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
        result: { status: 597, len: CHUNK_LEN * CHUNKS, pulls: CHUNKS + 1 },
        exitCode: 0,
      });
    });

    test.concurrent(`Promise.reject -> error() stream completes${tag}`, async () => {
      const { stdout, stderr, exitCode } = await runFixture("/reject", close);
      expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
        result: { status: 597, len: CHUNK_LEN * CHUNKS, pulls: CHUNKS + 1 },
        exitCode: 0,
      });
    });

    test.concurrent(`async reject -> error() stream whose first pull awaits is not emptied${tag}`, async () => {
      const { stdout, stderr, exitCode } = await runFixture("/lazy", close);
      expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
        result: { status: 597, len: CHUNK_LEN, pulls: 1 },
        exitCode: 0,
      });
    });

    test.concurrent(`async reject -> error() direct stream completes${tag}`, async () => {
      const { stdout, stderr, exitCode } = await runFixture("/direct", close);
      expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
        result: { status: 597, len: CHUNK_LEN * CHUNKS, pulls: CHUNKS },
        exitCode: 0,
      });
    });

    test.concurrent(`async reject -> error() async-iterator body completes${tag}`, async () => {
      const { stdout, stderr, exitCode } = await runFixture("/iter", close);
      expect({ result: stdout === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
        result: { status: 597, len: CHUNK_LEN * CHUNKS, pulls: CHUNKS },
        exitCode: 0,
      });
    });
  }
});
