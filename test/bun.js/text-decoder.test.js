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
