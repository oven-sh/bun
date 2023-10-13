import { expect, it, describe } from "bun:test";
import { gc as gcTrace, withoutAggressiveGC } from "harness";

const getByteLength = str => {
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

it("not enough space for replacement character", () => {
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(2);
  const result = encoder.encodeInto("\udc00", bytes);
  expect(result.read).toBe(0);
  expect(result.written).toBe(0);
  expect(Array.from(bytes)).toEqual([0x00, 0x00]);
});

describe("TextEncoder", () => {
  it("should encode latin1 text with non-ascii latin1 characters", () => {
    var text = "H©ell©o Wor©ld!";

    gcTrace(true);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    gcTrace(true);
    const into = new Uint8Array(100);
    const out = encoder.encodeInto(text, into);
    gcTrace(true);
    expect(out.read).toBe(text.length);

    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [72, 194, 169, 101, 108, 108, 194, 169, 111, 32, 87, 111, 114, 194, 169, 108, 100, 33];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
      expect(into[i]).toBe(result[i]);
    }
    expect(encoded.length).toBe(result.length);
    expect(out.written).toBe(result.length);

    const repeatCOunt = 16;
    text = "H©ell©o Wor©ld!".repeat(repeatCOunt);
    const byteLength = getByteLength(text);
    const encoded2 = encoder.encode(text);
    expect(encoded2.length).toBe(byteLength);
    const into2 = new Uint8Array(byteLength);
    const out2 = encoder.encodeInto(text, into2);
    expect(out2.read).toBe(text.length);
    expect(out2.written).toBe(byteLength);
    expect(into2).toEqual(encoded2);
    const repeatedResult = new Uint8Array(byteLength);
    for (let i = 0; i < repeatCOunt; i++) {
      repeatedResult.set(result, i * result.length);
    }
    expect(into2).toEqual(repeatedResult);
  });

  it("should encode latin1 text", async () => {
    gcTrace(true);
    const text = "Hello World!";
    const encoder = new TextEncoder();
    gcTrace(true);
    const encoded = encoder.encode(text);
    gcTrace(true);
    expect(encoded instanceof Uint8Array).toBe(true);
    expect(encoded.length).toBe(text.length);
    gcTrace(true);
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
    }

    let t = [
      {
        str: "\u009c\u0097",
        expected: [194, 156, 194, 151],
      },
      {
        str: "世",
        expected: [228, 184, 150],
      },
      // Less than 0, out of range.
      {
        str: -1,
        expected: [45, 49],
      },
      // Greater than 0x10FFFF, out of range.
      {
        str: 0x110000,
        expected: [49, 49, 49, 52, 49, 49, 50],
      },
      // The Unicode replacement character.
      {
        str: "\uFFFD",
        expected: [239, 191, 189],
      },
    ];
    for (let { str, expected } of t) {
      let utf8 = new TextEncoder().encode(str);
      expect([...utf8]).toEqual(expected);
    }

    expect([...new TextEncoder().encode(String.fromCodePoint(0))]).toEqual([0]);

    const fixture = new Uint8Array(await Bun.file(import.meta.dir + "/utf8-encoding-fixture.bin").arrayBuffer());
    const length = 0x110000;
    let textEncoder = new TextEncoder();
    let textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
    let encodeOut = new Uint8Array(length * 4);
    let encodeIntoOut = new Uint8Array(length * 4);
    let encodeIntoBuffer = new Uint8Array(4);
    let encodeDecodedOut = new Uint8Array(length * 4);
    for (let i = 0, offset = 0; i < length; i++, offset += 4) {
      const s = String.fromCodePoint(i);
      const u = textEncoder.encode(s);
      encodeOut.set(u, offset);

      textEncoder.encodeInto(s, encodeIntoBuffer);
      encodeIntoOut.set(encodeIntoBuffer, offset);

      const decoded = textDecoder.decode(encodeIntoBuffer);
      const encoded = textEncoder.encode(decoded);
      encodeDecodedOut.set(encoded, offset);
    }

    expect(encodeOut).toEqual(fixture);
    expect(encodeIntoOut).toEqual(fixture);
    expect(encodeOut).toEqual(encodeIntoOut);
    expect(encodeDecodedOut).toEqual(encodeOut);
    expect(encodeDecodedOut).toEqual(encodeIntoOut);
    expect(encodeDecodedOut).toEqual(fixture);

    expect(() => textEncoder.encode(String.fromCodePoint(length + 1))).toThrow();
  });

  it("should encode long latin1 text", async () => {
    const text = "Hello World!".repeat(1000);
    const encoder = new TextEncoder();
    gcTrace(true);
    const encoded = encoder.encode(text);
    gcTrace(true);
    expect(encoded instanceof Uint8Array).toBe(true);
    expect(encoded.length).toBe(text.length);
    gcTrace(true);
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toBe(text);
    gcTrace();
    await new Promise(resolve => setTimeout(resolve, 1));
    gcTrace();
    expect(decoded).toBe(text);
  });

  it("should encode latin1 rope text", () => {
    var text = "Hello";
    text += " ";
    text += "World!";

    gcTrace(true);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    gcTrace(true);
    const into = new Uint8Array(100);
    const out = encoder.encodeInto(text, into);
    gcTrace(true);
    expect(out.read).toBe(text.length);
    expect(out.written).toBe(encoded.length);
    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
      expect(encoded[i]).toBe(into[i]);
    }
    expect(encoded.length).toBe(getByteLength(text));
  });

  it("should encode latin1 rope text with non-ascii latin1 characters", () => {
    var text = "H©ell©o";
    text += " ";
    text += "Wor©ld!";

    gcTrace(true);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    gcTrace(true);
    const into = new Uint8Array(100);
    const out = encoder.encodeInto(text, into);
    gcTrace(true);
    expect(out.read).toBe(text.length);

    expect(encoded instanceof Uint8Array).toBe(true);
    const result = [72, 194, 169, 101, 108, 108, 194, 169, 111, 32, 87, 111, 114, 194, 169, 108, 100, 33];

    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(into[i]);
      expect(encoded[i]).toBe(result[i]);
    }
    expect(encoded.length).toBe(result.length);
    expect(out.written).toBe(encoded.length);

    withoutAggressiveGC(() => {
      for (let i = 0; i < 10_000; i++) {
        expect(encoder.encodeInto(text, into)).toEqual(out);
      }
    });
  });

  it("should encode utf-16 text", () => {
    var text = `❤️ Red Heart
              ✨ Sparkles
              🔥 Fire
          `;
    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    gcTrace(true);
    expect(decoder.decode(encoder.encode(text))).toBe(text);
    gcTrace(true);
  });

  // this test is from a web platform test in WebKit
  describe("should use a unicode replacement character for invalid surrogate pairs", () => {
    var bad = [
      {
        encoding: "utf-16le",
        input: [0x00, 0xd8],
        expected: "\uFFFD",
        name: "lone surrogate lead",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xdc],
        expected: "\uFFFD",
        name: "lone surrogate trail",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xd8, 0x00, 0x00],
        expected: "\uFFFD\u0000",
        name: "unmatched surrogate lead",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xdc, 0x00, 0x00],
        expected: "\uFFFD\u0000",
        name: "unmatched surrogate trail",
      },
      {
        encoding: "utf-16le",
        input: [0x00, 0xdc, 0x00, 0xd8],
        expected: "\uFFFD\uFFFD",
        name: "swapped surrogate pair",
      },
    ];

    bad.forEach(function (t) {
      it(t.encoding + " - " + t.name, () => {
        gcTrace(true);
        expect(new TextDecoder(t.encoding).decode(new Uint8Array(t.input))).toBe(t.expected);
        expect(new TextDecoder(t.encoding).decode(new Uint16Array(new Uint8Array(t.input).buffer))).toBe(t.expected);
        gcTrace(true);
      });
      //   test(function () {
      //     assert_throws_js(TypeError, function () {
      //       new TextDecoder(t.encoding, { fatal: true }).decode(
      //         new Uint8Array(t.input)
      //       );
      //     });
      //   }, t.encoding + " - " + t.name + " (fatal flag set)");
    });
  });

  it("should encode utf-16 rope text", () => {
    gcTrace(true);
    var textReal = `❤️ Red Heart ✨ Sparkles 🔥 Fire`;

    var a = textReal.split("");
    var text = "";
    for (let j of a) {
      text += j;
    }

    var encoder = new TextEncoder();
    expect(new TextDecoder().decode(encoder.encode(text))).toBe(textReal);
  });
});
