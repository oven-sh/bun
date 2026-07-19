import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Child reads all of stdin via Bun.stdin (avoids node:streams so this stays
// hermetic to spawn's stdin handling) and prints the SHA-1 of what it received.
const catScript = "Bun.readableStreamToArrayBuffer(Bun.stdin.stream()).then(b => console.log(Bun.SHA1.hash(b, 'hex')))";

// Bun.spawn copies ArrayBuffer/TypedArray stdin into its own storage before
// writing it to the child. That copy should live in native memory owned by the
// pipe writer, not a JSC-allocated Uint8Array held via a Strong handle: a
// Strong outliving the JS stack is an unnecessary GC root and heap allocation.
//
// Run in a subprocess so the heap baseline is clean. Disable the Linux memfd
// fast path so the pipe writer actually holds the buffer across the async
// write (otherwise the copy is flushed to a memfd synchronously and dropped).
describe("Bun.spawn stdin: ArrayBuffer does not create a JSC Strong for the copied bytes", () => {
  for (const disableMemfd of ["1", "0"]) {
    test(`BUN_FEATURE_FLAG_DISABLE_MEMFD=${disableMemfd}`, async () => {
      const fixture = /* js */ `
        const { heapStats } = require("bun:jsc");

        const protectedU8 = () => heapStats().protectedObjectTypeCounts.Uint8Array ?? 0;
        const liveU8 = () => heapStats().objectTypeCounts.Uint8Array ?? 0;

        Bun.gc(true);
        const protectedBefore = protectedU8();

        // A plain ArrayBuffer (not a Uint8Array) so any Uint8Array we observe
        // afterwards is one Bun allocated internally, not ours.
        const payload = new ArrayBuffer(64 * 1024);
        new Uint8Array(payload).fill(65);
        const expectedHash = Bun.SHA1.hash(payload, "hex");

        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", ${JSON.stringify(catScript)}],
          stdin: payload,
          stdout: "pipe",
          stderr: "inherit",
          env: process.env,
        });

        Bun.gc(true);
        const protectedDuring = protectedU8();
        const liveDuring = liveU8();

        const out = await proc.stdout.text();
        await proc.exited;

        if (out.trim() !== expectedHash) {
          throw new Error("child did not receive stdin intact: " + JSON.stringify(out));
        }

        console.log(JSON.stringify({
          protectedBefore,
          protectedDuring,
          liveDuring,
        }));
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: disableMemfd },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const { protectedBefore, protectedDuring, liveDuring } = JSON.parse(stdout.trim());
      // No Strong root is taken for the copied stdin bytes.
      expect(protectedDuring).toBe(protectedBefore);
      // No internal JSC Uint8Array is allocated for the copy (the user passed a
      // plain ArrayBuffer, so any Uint8Array here is an internal allocation).
      expect(liveDuring).toBe(0);
      expect(exitCode).toBe(0);
    });
  }
});

// Functional coverage independent of node:streams: the bytes the child reads
// from stdin match what the parent passed, for every ArrayBuffer-ish input
// Stdio::extract accepts, under both spawn and spawnSync, with and without the
// Linux memfd fast path.
describe("Bun.spawn stdin: ArrayBuffer bytes reach the child intact", () => {
  const N = 50000;
  const hugeBuf = Buffer.alloc(N * 5, "hello");
  const hugeAB = (() => {
    const ab = new ArrayBuffer(hugeBuf.length);
    new Uint8Array(ab).set(hugeBuf);
    return ab;
  })();
  const expectedHash = Bun.SHA1.hash(hugeBuf, "hex");

  const inputs = [
    ["ArrayBuffer", () => hugeAB],
    ["Uint8Array", () => new Uint8Array(hugeAB)],
    ["Buffer", () => hugeBuf],
    ["DataView", () => new DataView(hugeAB)],
  ] as const;

  describe.each(["1", "0"])("BUN_FEATURE_FLAG_DISABLE_MEMFD=%s", disableMemfd => {
    const env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: disableMemfd };

    for (const [label, mk] of inputs) {
      test.concurrent(`spawn with ${label}`, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", catScript],
          stdin: mk(),
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe(expectedHash);
        expect(exitCode).toBe(0);
      });

      test.concurrent(`spawnSync with ${label}`, () => {
        const { stdout, stderr, exitCode } = Bun.spawnSync({
          cmd: [bunExe(), "-e", catScript],
          stdin: mk(),
          env,
        });
        expect(stderr.toString()).toBe("");
        expect(stdout.toString().trim()).toBe(expectedHash);
        expect(exitCode).toBe(0);
      });
    }
  });
});
