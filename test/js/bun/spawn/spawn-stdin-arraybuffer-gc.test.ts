import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// Child reads all of stdin via Bun.stdin (avoids node:streams so this stays
// hermetic to spawn's stdin handling) and prints the SHA-1 of what it received.
const catScript = "Bun.readableStreamToArrayBuffer(Bun.stdin.stream()).then(b => console.log(Bun.SHA1.hash(b, 'hex')))";

// BUN_FEATURE_FLAG_DISABLE_MEMFD is Linux-only (can_use_memfd() is a constant
// false elsewhere), so on macOS/Windows both values exercise the same path.
const memfdMatrix = isLinux ? ["1", "0"] : ["1"];

// Bun.spawn copies ArrayBuffer/TypedArray stdin into its own storage before
// writing it to the child. That copy should live in native memory owned by the
// pipe writer, not a JSC-allocated Uint8Array held via a Strong handle: a
// Strong outliving the JS stack is an unnecessary GC root and heap allocation.
//
// Run in a subprocess so the heap baseline is clean. Disable the Linux memfd
// fast path so the pipe writer actually holds the buffer across the async
// write (otherwise the copy is flushed to a memfd synchronously and dropped).
describe("Bun.spawn stdin: ArrayBuffer does not create a JSC Strong for the copied bytes", () => {
  for (const disableMemfd of memfdMatrix) {
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
          protectedDelta: protectedDuring - protectedBefore,
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
      if (exitCode !== 0) throw new Error(`fixture failed (exit ${exitCode}):\n${stderr}\n${stdout}`);

      // No Strong root is taken for the copied stdin bytes (protectedDelta 0),
      // and no internal JSC Uint8Array is allocated for the copy (the user
      // passed a plain ArrayBuffer, so liveDuring counts only Bun-internal
      // Uint8Arrays).
      expect(JSON.parse(stdout.trim())).toEqual({
        protectedDelta: 0,
        liveDuring: 0,
      });
    });
  }
});

// Functional coverage independent of node:streams: the bytes the child reads
// from stdin match what the parent passed, for every ArrayBuffer-ish input
// Stdio::extract accepts, under both spawn and spawnSync, with and without the
// Linux memfd fast path. The memfd decision is made by the process calling
// Bun.spawn, so the flag must be set on an intermediate subprocess (not on the
// leaf child) for it to take effect.
describe("Bun.spawn stdin: ArrayBuffer bytes reach the child intact", () => {
  const fixture = /* js */ `
    const catScript = ${JSON.stringify(catScript)};
    const hugeBuf = Buffer.alloc(50000 * 5, "hello");
    const ab = new ArrayBuffer(hugeBuf.length);
    new Uint8Array(ab).set(hugeBuf);

    const inputs = {
      ArrayBuffer: ab,
      Uint8Array: new Uint8Array(ab),
      Buffer: hugeBuf,
      DataView: new DataView(ab),
    };

    const results = {};
    const procs = [];
    for (const [label, stdin] of Object.entries(inputs)) {
      const proc = Bun.spawn({
        cmd: [process.execPath, "-e", catScript],
        stdin,
        stdout: "pipe",
        stderr: "inherit",
        env: process.env,
      });
      procs.push(
        Promise.all([proc.stdout.text(), proc.exited]).then(([out]) => {
          results["spawn:" + label] = out.trim();
        }),
      );
    }
    await Promise.all(procs);

    for (const [label, stdin] of Object.entries(inputs)) {
      const { stdout } = Bun.spawnSync({
        cmd: [process.execPath, "-e", catScript],
        stdin,
        env: process.env,
      });
      results["spawnSync:" + label] = stdout.toString().trim();
    }

    console.log(JSON.stringify(results));
  `;

  const hash = Bun.SHA1.hash(Buffer.alloc(50000 * 5, "hello"), "hex");
  const expected = Object.fromEntries(
    ["ArrayBuffer", "Uint8Array", "Buffer", "DataView"].flatMap(label => [
      [`spawn:${label}`, hash],
      [`spawnSync:${label}`, hash],
    ]),
  );

  for (const disableMemfd of memfdMatrix) {
    test.concurrent(`BUN_FEATURE_FLAG_DISABLE_MEMFD=${disableMemfd}`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: disableMemfd },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`fixture failed (exit ${exitCode}):\n${stderr}\n${stdout}`);

      expect(JSON.parse(stdout.trim())).toEqual(expected);
    });
  }
});
