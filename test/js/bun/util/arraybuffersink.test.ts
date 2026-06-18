import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";
import { withoutAggressiveGC } from "harness";

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
});

describe("ArrayBufferSink shared/resizable input (stable bytes)", () => {
  // Shared and resizable backing stores are snapshotted before the sink reads
  // them, so the written bytes are exactly the requested view range. The 0xff
  // guard bytes around the view must never appear in the output.
  function sabView(offset: number, bytes: number[]) {
    const sab = new SharedArrayBuffer(offset + bytes.length + 4);
    const all = new Uint8Array(sab);
    all.fill(0xff);
    all.set(bytes, offset);
    return new Uint8Array(sab, offset, bytes.length);
  }

  // A resizable (but non-shared) ArrayBuffer hits the same snapshot branch as a
  // SharedArrayBuffer: the production guard is `(buffer.shared || buffer.resizable)`.
  function resizableView(offset: number, bytes: number[]) {
    const ab = new ArrayBuffer(offset + bytes.length + 4, {
      maxByteLength: offset + bytes.length + 16,
    });
    const all = new Uint8Array(ab);
    all.fill(0xff);
    all.set(bytes, offset);
    return new Uint8Array(ab, offset, bytes.length);
  }

  it("writes a nonzero-offset Uint8Array(SAB) view", () => {
    const sink = new ArrayBufferSink();
    const wrote = sink.write(sabView(9, [1, 2, 3, 4, 5]));
    const out = new Uint8Array(sink.end());
    expect(wrote).toBe(5);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("writes a raw SharedArrayBuffer", () => {
    const sab = new SharedArrayBuffer(4);
    new Uint8Array(sab).set([10, 20, 30, 40]);
    const sink = new ArrayBufferSink();
    const wrote = sink.write(sab);
    const out = new Uint8Array(sink.end());
    expect(wrote).toBe(4);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
  });

  it("accepts a zero-length SharedArrayBuffer view", () => {
    const sink = new ArrayBufferSink();
    const wrote = sink.write(new Uint8Array(new SharedArrayBuffer(8), 4, 0));
    const out = new Uint8Array(sink.end());
    expect(wrote).toBe(0);
    expect(out.byteLength).toBe(0);
  });

  it("writes a nonzero-offset Uint8Array(resizable ArrayBuffer) view", () => {
    const sink = new ArrayBufferSink();
    const wrote = sink.write(resizableView(7, [11, 22, 33, 44]));
    const out = new Uint8Array(sink.end());
    expect(wrote).toBe(4);
    expect(Array.from(out)).toEqual([11, 22, 33, 44]);
  });
});
