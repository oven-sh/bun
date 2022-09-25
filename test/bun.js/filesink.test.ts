import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";

describe("FileSink", () => {
  const fixtures = [
    [
      ["abcdefghijklmnopqrstuvwxyz"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
      "abcdefghijklmnopqrstuvwxyz",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      new TextEncoder().encode(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      ),
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    [
      ["😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode(
        "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"
      ),
      "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        "abcdefghijklmnopqrstuvwxyz",
        "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
      ],
      new TextEncoder().encode(
        "abcdefghijklmnopqrstuvwxyz" +
          "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"
      ),
      "abcdefghijklmnopqrstuvwxyz" +
        "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        "abcdefghijklmnopqrstuvwxyz",
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      new TextEncoder().encode(
        "abcdefghijklmnopqrstuvwxyz" +
          "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"
      ),
      "(rope) " +
        "abcdefghijklmnopqrstuvwxyz" +
        "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      new TextEncoder().encode(
        "abcdefghijklmnopqrstuvwxyz" +
          "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"
      ),
      "(array) " +
        "abcdefghijklmnopqrstuvwxyz" +
        "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
  ];

  for (const [input, expected, label] of fixtures) {
    it(`${JSON.stringify(label)}`, async () => {
      const path = `/tmp/bun-test-${Bun.hash(label).toString(10)}.txt`;
      try {
        require("fs").unlinkSync(path);
      } catch (e) {}

      const sink = Bun.file(path).writer();
      for (let i = 0; i < input.length; i++) {
        sink.write(input[i]);
      }
      await sink.end();

      const output = new Uint8Array(await Bun.file(path).arrayBuffer());
      for (let i = 0; i < expected.length; i++) {
        expect(output[i]).toBe(expected[i]);
      }
      expect(output.byteLength).toBe(expected.byteLength);
    });

    it(`flushing -> ${JSON.stringify(label)}`, async () => {
      const path = `/tmp/bun-test-${Bun.hash(label).toString(10)}.txt`;
      try {
        require("fs").unlinkSync(path);
      } catch (e) {}

      const sink = Bun.file(path).writer();
      for (let i = 0; i < input.length; i++) {
        sink.write(input[i]);
        await sink.flush();
      }
      await sink.end();

      const output = new Uint8Array(await Bun.file(path).arrayBuffer());
      for (let i = 0; i < expected.length; i++) {
        expect(output[i]).toBe(expected[i]);
      }
      expect(output.byteLength).toBe(expected.byteLength);
    });

    it(`highWaterMark -> ${JSON.stringify(label)}`, async () => {
      const path = `/tmp/bun-test-${Bun.hash(label).toString(10)}.txt`;
      try {
        require("fs").unlinkSync(path);
      } catch (e) {}

      const sink = Bun.file(path).writer({ highWaterMark: 1 });
      for (let i = 0; i < input.length; i++) {
        sink.write(input[i]);
        await sink.flush();
      }
      await sink.end();

      const output = new Uint8Array(await Bun.file(path).arrayBuffer());
      for (let i = 0; i < expected.length; i++) {
        expect(output[i]).toBe(expected[i]);
      }
      expect(output.byteLength).toBe(expected.byteLength);
    });
  }
});
