import { expect, it, describe } from "bun:test";
import { gc as gcTrace, withoutAggressiveGC } from "./gc";

const getByteLength = (str) => {
  // returns the byte length of an utf8 string
  var s = str.length;
  for (var i = str.length - 1; i >= 0; i--) {
    var code = str.charCodeAt(i);
    if (code > 0x7f && code <= 0x7ff) s++;
    else if (code > 0x7ff && code <= 0xffff) s += 2;
    if (code >= 0xdc00 && code <= 0xdfff) i--; //trail surrogate
  }
  return s;
};

describe("TextDecoder", () => {
  it("should not crash on empty text", () => {
    const decoder = new TextDecoder();
    gcTrace(true);
    const fixtures = [
      new Uint8Array(),
      new Uint8Array([]),
      new Buffer(0),
      new ArrayBuffer(0),
    ];

    for (let input of fixtures) {
      expect(decoder.decode(input)).toBe("");
    }

    // Cause a de-opt
    try {
      decoder.decode([NaN, Symbol("s")]);
    } catch (e) {}

    // DOMJIT test
    for (let i = 0; i < 90000; i++) {
      decoder.decode(fixtures[0]);
    }

    gcTrace(true);
  });
  it("should decode ascii text", () => {
    const decoder = new TextDecoder("latin1");
    gcTrace(true);
    expect(decoder.encoding).toBe("windows-1252");
    gcTrace(true);
    expect(decoder.decode(new Uint8Array([0x41, 0x42, 0x43]))).toBe("ABC");
    gcTrace(true);
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    gcTrace(true);
    expect(decoder.decode(Uint8Array.from(result))).toBe(
      String.fromCharCode(...result),
    );
    gcTrace(true);
  });

  it("should decode unicode text", () => {
    const decoder = new TextDecoder();
    gcTrace(true);
    var text = `❤️ Red Heart`;

    const bytes = [
      226, 157, 164, 239, 184, 143, 32, 82, 101, 100, 32, 72, 101, 97, 114, 116,
    ];
    const decoded = decoder.decode(Uint8Array.from(bytes));
    expect(decoder.encoding).toBe("utf-8");

    gcTrace(true);

    for (let i = 0; i < text.length; i++) {
      expect(decoded.charCodeAt(i)).toBe(text.charCodeAt(i));
    }
    expect(decoded).toHaveLength(text.length);
    gcTrace(true);
  });

  describe("typedArrays", () => {
    var text = `ABC DEF GHI JKL MNO PQR STU VWX YZ ABC DEF GHI JKL MNO PQR STU V`;
    var bytes = new TextEncoder().encode(text);
    var decoder = new TextDecoder();
    for (let TypedArray of [
      Uint8Array,
      Uint16Array,
      Uint32Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Float32Array,
      Float64Array,
      DataView,
      BigInt64Array,
      BigUint64Array,
    ]) {
      it(`should decode ${TypedArray.name}`, () => {
        const decoded = decoder.decode(new TypedArray(bytes.buffer));
        expect(decoded).toBe(text);
      });
    }

    it("DOMJIT call", () => {
      const array = new Uint8Array(bytes.buffer);
      withoutAggressiveGC(() => {
        for (let i = 0; i < 100_000; i++) {
          const decoded = decoder.decode(array);
          expect(decoded).toBe(text);
        }
      });
    });
  });

  it("should decode unicode text with multiple consecutive emoji", () => {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    gcTrace(true);
    var text = `❤️❤️❤️❤️❤️❤️ Red Heart`;

    text += ` ✨ Sparkles 🔥 Fire 😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰`;
    gcTrace(true);
    expect(decoder.decode(encoder.encode(text))).toBe(text);
    gcTrace(true);
    const bytes = new Uint8Array(getByteLength(text) * 8);
    gcTrace(true);
    const amount = encoder.encodeInto(text, bytes);
    gcTrace(true);
    expect(decoder.decode(bytes.subarray(0, amount.written))).toBe(text);
    gcTrace(true);
  });
});

it("truncated sequences", () => {
  const assert_equals = (a, b) => expect(a).toBe(b);

  // Truncated sequences
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0])), "\uFFFD");
  assert_equals(
    new TextDecoder().decode(new Uint8Array([0xf0, 0x9f])),
    "\uFFFD",
  );
  assert_equals(
    new TextDecoder().decode(new Uint8Array([0xf0, 0x9f, 0x92])),
    "\uFFFD",
  );

  // Errors near end-of-queue
  assert_equals(
    new TextDecoder().decode(new Uint8Array([0xf0, 0x9f, 0x41])),
    "\uFFFDA",
  );
  assert_equals(
    new TextDecoder().decode(new Uint8Array([0xf0, 0x41, 0x42])),
    "\uFFFDAB",
  );
  assert_equals(
    new TextDecoder().decode(new Uint8Array([0xf0, 0x41, 0xf0])),
    "\uFFFDA\uFFFD",
  );
  assert_equals(
    new TextDecoder().decode(new Uint8Array([0xf0, 0x8f, 0x92])),
    "\uFFFD\uFFFD\uFFFD",
  );
});
