import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";

describe("ArrayBufferSink", () => {
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
    it(`${JSON.stringify(label)}`, () => {
      const sink = new ArrayBufferSink();
      for (let i = 0; i < input.length; i++) {
        sink.write(input[i]);
      }
      const output = new Uint8Array(sink.end());
      for (let i = 0; i < expected.length; i++) {
        expect(output[i]).toBe(expected[i]);
      }
      expect(output.byteLength).toBe(expected.byteLength);
    });
  }
});
