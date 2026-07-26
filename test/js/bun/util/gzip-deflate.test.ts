import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// zlib's z_stream.avail_in is a u32. Passing a buffer of exactly 2^32 bytes
// (Bun's own buffer.constants.MAX_LENGTH) to Bun.gzipSync / Bun.deflateSync
// used to wrap `input.len() as u32` to 0, so zlib compressed an empty stream
// and returned a 20-byte (gzip) / 2-byte (deflate) output that round-trips to
// 0 bytes: silent total data loss on a success return.
//
// Peak resident is ~9 GiB (the 4 GiB input plus the ~4 GiB deflateBound()
// scratch Vec). A runner that cannot satisfy that sees the child OOM-killed
// (SIGKILL) or abort in the allocator, which the parent treats as a skip so
// low-memory lanes don't flake; any other non-zero exit is a real failure.
test("Bun.gzipSync / Bun.deflateSync compress a 4 GiB input instead of wrapping avail_in to 0", async () => {
  const script = `
      const zlib = require("node:zlib");
      let b;
      try {
        b = Buffer.alloc(2 ** 32);
      } catch {
        console.log(JSON.stringify("SKIP"));
        process.exit(0);
      }
      b[0] = 0x41;
      b[4_294_967_294] = 0x5a;

      const g = Bun.gzipSync(b);
      const dLen = Bun.deflateSync(b).length;
      b = null;
      Bun.gc(true);

      const rg = zlib.gunzipSync(g);
      console.log(
        JSON.stringify({
          gzip: g.length,
          deflate: dLen,
          rgLen: rg.length,
          rgFirst: rg[0],
          rgSentinel: rg[4_294_967_294],
        }),
      );
    `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const out = JSON.parse(stdout.trim() || "null");
  const oom =
    out === "SKIP" ||
    proc.signalCode === "SIGKILL" ||
    (out === null && /memory allocation of \d+ bytes failed|out of memory|OutOfMemory/i.test(stderr));
  if (oom) {
    console.log(`skipping: child could not allocate ~9 GiB (signal=${proc.signalCode}, exit=${exitCode})`);
    return;
  }

  expect(stderr).toBe("");
  // With the bug: gzip = 20, deflate = 2, rgLen = 0.
  expect(out).toEqual({
    gzip: expect.any(Number),
    deflate: expect.any(Number),
    rgLen: 2 ** 32,
    rgFirst: 0x41,
    rgSentinel: 0x5a,
  });
  expect(out.gzip).toBeGreaterThan(1_000_000);
  expect(out.deflate).toBeGreaterThan(1_000_000);
  expect(exitCode).toBe(0);
}, 300_000);
