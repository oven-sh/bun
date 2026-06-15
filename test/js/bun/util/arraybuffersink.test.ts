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

  it("start({ highWaterMark: Number.MAX_SAFE_INTEGER }) does not abort", async () => {
    const src = `
      const sink = new Bun.ArrayBufferSink();
      sink.start({ highWaterMark: Number.MAX_SAFE_INTEGER });
      sink.write("hello");
      process.stdout.write(new Uint8Array(sink.end()));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("hello");
    expect(stderr).not.toContain("memory allocation");
    expect(exitCode).toBe(0);
  });

  it.each([2 ** 50, 2 ** 51, 2 ** 52, -1])("start({ highWaterMark: %p }) is clamped and writable", hwm => {
    const sink = new ArrayBufferSink();
    sink.start({ highWaterMark: hwm });
    sink.write("ok");
    expect(new TextDecoder().decode(new Uint8Array(sink.end()))).toBe("ok");
  });
});
