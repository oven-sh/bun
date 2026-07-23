// When an async fetch handler rejects and error() returns a Response whose
// body is a ReadableStream, the stream must be allowed to finish.
// Previously handle_reject() fell through to render_missing() while the sink
// was still pumping, which force-ended the exchange after the first
// synchronous chunk (or with an empty Content-Length: 0 body if the stream's
// first pull awaited before enqueuing). With Connection: close the freed
// socket is then written by the orphaned sink: heap-use-after-free under ASAN.
//
// All cases run in one subprocess so a pre-fix ASAN crash is observed as a
// test failure rather than killing the parent runner before junit is written,
// while paying subprocess / server startup once instead of per case.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "serve-error-handler-stream-fixture.ts");
const CHUNKS = 12;
const CHUNK_LEN = 64;

describe("Bun.serve error() returning a streaming Response", () => {
  test("delivers the full stream body for every async-reject shape", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture],
      // Malloc=1 forces system malloc so bmalloc/libpas pools don't mask the
      // UAF from ASAN. bmalloc's SystemHeap is unimplemented on Windows and
      // would RELEASE_BASSERT, so leave bmalloc in place there (no ASAN lane
      // on Windows anyway).
      env: { ...bunEnv, ...(isWindows ? {} : { Malloc: "1" }) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const full = CHUNK_LEN * CHUNKS;
    // On a pre-fix crash stdout is empty and stderr holds the ASAN report;
    // showing stderr in that case makes the failure self-explanatory.
    expect({
      results: stdout === "" ? stderr : JSON.parse(stdout),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      results: [
        // Controls: neither path hits handle_reject()'s fallthrough.
        { path: "/plain", close: false, status: 200, len: full, pulls: CHUNKS + 1 },
        { path: "/sync", close: false, status: 597, len: full, pulls: CHUNKS + 1 },
        // async reject → error() pull-stream: render_missing() must not
        // truncate the body to its synchronous prefix.
        { path: "/async", close: false, status: 597, len: full, pulls: CHUNKS + 1 },
        { path: "/reject", close: false, status: 597, len: full, pulls: CHUNKS + 1 },
        // First pull awaits before enqueuing: the pre-fix fallthrough emptied
        // this to Content-Length: 0.
        { path: "/lazy", close: false, status: 597, len: CHUNK_LEN, pulls: 1 },
        { path: "/direct", close: false, status: 597, len: full, pulls: CHUNKS },
        { path: "/iter", close: false, status: 597, len: full, pulls: CHUNKS },
        // Connection: close — the pre-fix orphaned producer writes to a
        // freed uWS response here, which is the ASAN heap-use-after-free.
        { path: "/async", close: true, status: 597, len: full, pulls: CHUNKS + 1 },
        { path: "/reject", close: true, status: 597, len: full, pulls: CHUNKS + 1 },
        { path: "/lazy", close: true, status: 597, len: CHUNK_LEN, pulls: 1 },
        { path: "/direct", close: true, status: 597, len: full, pulls: CHUNKS },
        { path: "/iter", close: true, status: 597, len: full, pulls: CHUNKS },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
