import { expect, it, describe } from "bun:test";
import { gc as gcTrace } from "./gc";

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
      String.fromCharCode(...result)
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
    const result = [
      72, 194, 169, 101, 108, 108, 194, 169, 111, 32, 87, 111, 114, 194, 169,
      108, 100, 33,
    ];
    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(result[i]);
      expect(into[i]).toBe(result[i]);
    }
    expect(encoded.length).toBe(result.length);
    expect(out.written).toBe(result.length);
  });

  it("should encode latin1 text", () => {
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
    await new Promise((resolve) => setTimeout(resolve, 1));
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
    const result = [
      72, 194, 169, 101, 108, 108, 194, 169, 111, 32, 87, 111, 114, 194, 169,
      108, 100, 33,
    ];

    for (let i = 0; i < result.length; i++) {
      expect(encoded[i]).toBe(into[i]);
      expect(encoded[i]).toBe(result[i]);
    }
    expect(encoded.length).toBe(result.length);
    expect(out.written).toBe(encoded.length);
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
        expect(
          new TextDecoder(t.encoding).decode(new Uint8Array(t.input))
        ).toBe(t.expected);
        expect(
          new TextDecoder(t.encoding).decode(
            new Uint16Array(new Uint8Array(t.input).buffer)
          )
        ).toBe(t.expected);
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
