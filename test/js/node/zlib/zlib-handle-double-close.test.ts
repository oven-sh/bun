import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Calling `_handle.close()` twice on a brotli/zstd stream must be a no-op,
// matching the deflate/gzip handle behavior. The first close() sets
// `mode = NONE` and frees the native encoder/decoder state; a second close()
// previously fell through to `unreachable!()` in Context::deinit_state() and
// aborted the process.

describe.concurrent("zlib native handle double close()", () => {
  test.each([
    ["createBrotliCompress"],
    ["createBrotliDecompress"],
    ["createZstdCompress"],
    ["createZstdDecompress"],
    ["createGzip"],
    ["createGunzip"],
  ])("%s", async factory => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const zlib = require("zlib");
          const stream = zlib.${factory}();
          const h = stream._handle;
          h.close();
          h.close();
          h.close();
          console.log("OK");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "OK", stderr: "", exitCode: 0 });
  });
});
