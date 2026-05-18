import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, withoutAggressiveGC } from "harness";

describe("ArrayBufferSink", () => {
  const fixtures = [
    [
      ["abcdefghijklmnopqrstuvwxyz"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
      "abcdefghijklmnopqrstuvwxyz",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    [
      ["😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋", " Get Emoji — All Emojis", " to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "(rope) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "(array) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
  ] as const;

  for (const [input, expected, label] of fixtures) {
    it(`${JSON.stringify(label)}`, () => {
      const sink = new ArrayBufferSink();
      withoutAggressiveGC(() => {
        for (let i = 0; i < input.length; i++) {
          const el = input[i];
          if (typeof el !== "number") {
            sink.write(el);
          }
        }
      });
      const output = new Uint8Array(sink.end());
      withoutAggressiveGC(() => {
        for (let i = 0; i < expected.length; i++) {
          expect(output[i]).toBe(expected[i]);
        }
      });
      expect(output.byteLength).toBe(expected.byteLength);
    });
  }

  // A huge `highWaterMark` used to reach the allocator (Vec::reserve_exact)
  // and abort the process (SIGABRT) instead of being truncated like Zig does.
  // Spawned in a subprocess because the failure mode is a hard abort.
  describe.each(["2 ** 52", "2 ** 51", "2 ** 53", "2 ** 62", "Number.MAX_SAFE_INTEGER"])(
    "start({ highWaterMark: %s }) does not abort on out-of-range values",
    hwm => {
      it.concurrent("exits cleanly", async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `const s = new Bun.ArrayBufferSink(); s.start({ highWaterMark: ${hwm} }); s.write("ok"); process.stdout.write(new TextDecoder().decode(s.end()));`,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe("ok");
        expect(exitCode).toBe(0);
      });
    },
  );

  // Values inside the i51 range (bit 50 clear) survive truncation unchanged and
  // reach the allocator. `start()` must surface OOM as a JS error (ENOMEM), not
  // abort via `handle_alloc_error`. mimalloc prints its own warnings to stderr
  // when the huge allocation fails — those are expected; the invariant is that
  // the JS error is catchable and the process exits cleanly.
  it.concurrent("start({ highWaterMark: 2 ** 49 }) throws ENOMEM instead of aborting", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const s = new Bun.ArrayBufferSink(); try { s.start({ highWaterMark: 2 ** 49 }); process.stdout.write("no-throw"); } catch (e) { process.stdout.write(e.code ?? e.message); }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("ENOMEM");
    expect(stderr).not.toContain("memory allocation of");
    expect(exitCode).toBe(0);
    expect(proc.signalCode).toBeNull();
  });
});
