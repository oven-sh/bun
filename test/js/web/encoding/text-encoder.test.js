import { describe, expect, it } from "bun:test";
import { gc as gcTrace, withoutAggressiveGC } from "harness";

// UTF-8 reference encoder: lone surrogates become U+FFFD, like TextEncoder.
function utf8Reference(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = (cp - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i++;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }

    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

describe("encodeInto astral characters, lone surrogates and buffer sizing", () => {
  // WHATWG Encoding spec: a code point that doesn't fit in the remaining
  // destination space is left unwritten, and that destination space is left
  // untouched. A previous implementation incorrectly wrote U+FFFD when a
  // valid 4-byte astral character met an exactly-3-byte buffer.
  // A lone surrogate needs 3 bytes for its U+FFFD replacement.
  it.each([
    ["\u{1F600}", 3, { read: 0, written: 0 }, [0xaa, 0xaa, 0xaa]],
    ["\u{1F600}", 4, { read: 2, written: 4 }, [0xf0, 0x9f, 0x98, 0x80]],
    ["\u{1F600}", 2, { read: 0, written: 0 }, [0xaa, 0xaa]],
    ["\uD800", 3, { read: 1, written: 3 }, [0xef, 0xbf, 0xbd]],
    ["\uDC00", 3, { read: 1, written: 3 }, [0xef, 0xbf, 0xbd]],
    ["\uD800", 2, { read: 0, written: 0 }, [0xaa, 0xaa]],
    ["\uDC00", 2, { read: 0, written: 0 }, [0xaa, 0xaa]],
    ["\uD800\uD801", 3, { read: 1, written: 3 }, [0xef, 0xbf, 0xbd]],
    ["a\u{1F600}", 3, { read: 1, written: 1 }, [0x61, 0xaa, 0xaa]],
    ["a\u{1F600}", 4, { read: 1, written: 1 }, [0x61, 0xaa, 0xaa, 0xaa]],
    ["a\u{1F600}", 5, { read: 3, written: 5 }, [0x61, 0xf0, 0x9f, 0x98, 0x80]],
  ])("%j into %i-byte buffer", (input, size, expectedResult, expectedBytes) => {
    const bytes = new Uint8Array(size).fill(0xaa);
    const result = new TextEncoder().encodeInto(input, bytes);
    expect(Array.from(bytes)).toEqual(expectedBytes);
    expect(result).toEqual(expectedResult);
  });
});

describe("TextEncoder", () => {
  it("should handle undefined", () => {
    const encoder = new TextEncoder();
    expect(encoder.encode(undefined)).toEqual(new Uint8Array(0));
    expect(encoder.encode()).toEqual(new Uint8Array(0));
    expect(Array.from(encoder.encode(null))).toEqual([0x6e, 0x75, 0x6c, 0x6c]);
    expect(encoder.encode("")).toEqual(new Uint8Array(0));
  });

  it("should encode latin1 text with non-ascii latin1 characters", () => {
    var text = "H©ell©o Wor©ld!";

    gcTrace(true);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    gcTrace(true);
    const into = new Uint8Array(100);
    const out = encoder.encodeInto(text, into);
    gcTrace(true);

    const result = [72, 194, 169, 101, 108, 108, 194, 169, 111, 32, 87, 111, 114, 194, 169, 108, 100, 33];
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(encoded)).toEqual(result);
    expect(out).toEqual({ read: text.length, written: result.length });
    expect(Array.from(into)).toEqual([...result, ...new Array(100 - result.length).fill(0)]);

    const repeatCount = 16;
    text = "H©ell©o Wor©ld!".repeat(repeatCount);
    const repeatedResult = new Uint8Array(result.length * repeatCount);
    for (let i = 0; i < repeatCount; i++) {
      repeatedResult.set(result, i * result.length);
    }
    expect(encoder.encode(text)).toEqual(repeatedResult);
    const into2 = new Uint8Array(repeatedResult.length);
    expect(encoder.encodeInto(text, into2)).toEqual({ read: text.length, written: repeatedResult.length });
    expect(into2).toEqual(repeatedResult);
  });

  it("should encode latin1 text", () => {
    gcTrace(true);
    const text = "Hello World!";
    const encoder = new TextEncoder();
    gcTrace(true);
    const encoded = encoder.encode(text);
    gcTrace(true);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(encoded)).toEqual([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33]);
    gcTrace(true);

    const cases = [
      ["\u009c\u0097", [194, 156, 194, 151]],
      ["世", [228, 184, 150]],
      // Numbers are stringified. Less than 0, out of range.
      [-1, [45, 49]],
      // Greater than 0x10FFFF, out of range.
      [0x110000, [49, 49, 49, 52, 49, 49, 50]],
      // The Unicode replacement character.
      ["\uFFFD", [239, 191, 189]],
      [String.fromCodePoint(0), [0]],
    ];
    for (const [input, expected] of cases) {
      expect(Array.from(new TextEncoder().encode(input))).toEqual(expected);
    }
  });

  it("should encode long latin1 text", async () => {
    const text = "Hello World!".repeat(1000);
    const encoder = new TextEncoder();
    gcTrace(true);
    const encoded = encoder.encode(text);
    gcTrace(true);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded).toEqual(utf8Reference(text));
    gcTrace(true);
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toBe(text);
    gcTrace();
    await new Promise(resolve => setImmediate(resolve));
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

    const result = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33];
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(encoded)).toEqual(result);
    expect(out).toEqual({ read: text.length, written: result.length });
    expect(Array.from(into.subarray(0, result.length))).toEqual(result);
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

    const result = [72, 194, 169, 101, 108, 108, 194, 169, 111, 32, 87, 111, 114, 194, 169, 108, 100, 33];
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(encoded)).toEqual(result);
    expect(out).toEqual({ read: text.length, written: result.length });
    expect(Array.from(into.subarray(0, result.length))).toEqual(result);

    // 10k calls take the call site through the JIT tiers. Compare in plain JS,
    // an expect() per iteration is slow in debug builds.
    let mismatches = 0;
    withoutAggressiveGC(() => {
      for (let i = 0; i < 10_000; i++) {
        const again = encoder.encodeInto(text, into);
        if (again.read !== out.read || again.written !== out.written) mismatches++;
      }
    });
    expect(mismatches).toBe(0);
    expect(Array.from(into.subarray(0, result.length))).toEqual(result);
  });

  it("should encode utf-16 text", () => {
    var text = `❤️ Red Heart
              ✨ Sparkles
              🔥 Fire
          `;
    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    gcTrace(true);
    const encoded = encoder.encode(text);
    expect(encoded).toEqual(utf8Reference(text));
    expect(decoder.decode(encoded)).toBe(text);
    gcTrace(true);
  });

  // this test is from a web platform test in WebKit
  describe("should use a unicode replacement character for invalid surrogate pairs", () => {
    it.each([
      ["lone surrogate lead", [0x00, 0xd8], "\uFFFD"],
      ["lone surrogate trail", [0x00, 0xdc], "\uFFFD"],
      ["unmatched surrogate lead", [0x00, 0xd8, 0x00, 0x00], "\uFFFD\u0000"],
      ["unmatched surrogate trail", [0x00, 0xdc, 0x00, 0x00], "\uFFFD\u0000"],
      ["swapped surrogate pair", [0x00, 0xdc, 0x00, 0xd8], "\uFFFD\uFFFD"],
    ])("utf-16le - %s", (_, input, expected) => {
      gcTrace(true);
      expect(new TextDecoder("utf-16le").decode(new Uint8Array(input))).toBe(expected);
      expect(new TextDecoder("utf-16le").decode(new Uint16Array(new Uint8Array(input).buffer))).toBe(expected);
      expect(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array(input))).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_ENCODING_INVALID_ENCODED_DATA",
          message: "The encoded data was not valid for encoding utf-16le",
        }),
      );
      gcTrace(true);
    });
  });

  describe("comprehensive invalid UTF-16 edge cases", () => {
    it("should handle trailing unpaired high surrogates", () => {
      const encoder = new TextEncoder();

      // Single trailing high surrogate
      const test1 = "Hello" + String.fromCharCode(0xd800);
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("Hello\uFFFD");

      // Multiple trailing high surrogates
      const test2 = "Hello" + String.fromCharCode(0xd800, 0xd801, 0xdbff);
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("Hello\uFFFD\uFFFD\uFFFD");
    });

    it("should handle trailing unpaired low surrogates", () => {
      const encoder = new TextEncoder();

      // Single trailing low surrogate
      const test1 = "World" + String.fromCharCode(0xdc00);
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("World\uFFFD");

      // Multiple trailing low surrogates
      const test2 = "World" + String.fromCharCode(0xdc00, 0xdc01, 0xdfff);
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("World\uFFFD\uFFFD\uFFFD");
    });

    it("should handle leading unpaired surrogates", () => {
      const encoder = new TextEncoder();

      // Leading high surrogate
      const test1 = String.fromCharCode(0xd800) + "Hello";
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("\uFFFDHello");

      // Leading low surrogate
      const test2 = String.fromCharCode(0xdc00) + "World";
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("\uFFFDWorld");
    });

    it("should handle mixed valid and invalid surrogates", () => {
      const encoder = new TextEncoder();

      // Valid emoji followed by unpaired high surrogate
      const test1 = "🌍" + String.fromCharCode(0xd800);
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("🌍\uFFFD");

      // Unpaired low surrogate followed by valid emoji
      const test2 = String.fromCharCode(0xdc00) + "🌍";
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("\uFFFD🌍");

      // Alternating valid and invalid
      const test3 = "A" + String.fromCharCode(0xd800) + "B" + String.fromCharCode(0xdc00) + "C";
      const encoded3 = encoder.encode(test3);
      const decoded3 = new TextDecoder().decode(encoded3);
      expect(decoded3).toBe("A\uFFFDB\uFFFDC");
    });

    it("should handle strings with only unpaired surrogates", () => {
      const encoder = new TextEncoder();

      // Only unpaired high surrogates
      const test1 = String.fromCharCode(0xd800, 0xd801, 0xd802);
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("\uFFFD\uFFFD\uFFFD");

      // Only unpaired low surrogates
      const test2 = String.fromCharCode(0xdc00, 0xdc01, 0xdc02);
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("\uFFFD\uFFFD\uFFFD");

      // Mixed unpaired surrogates
      const test3 = String.fromCharCode(0xdc00, 0xd800, 0xdc01, 0xd801);
      const encoded3 = encoder.encode(test3);
      const decoded3 = new TextDecoder().decode(encoded3);
      expect(decoded3).toBe("\uFFFD\uD800\uDC01\uFFFD");
    });

    it("should handle invalid surrogate pairs", () => {
      const encoder = new TextEncoder();

      // High surrogate not followed by low surrogate
      const test1 = String.fromCharCode(0xd800, 0x0041); // High surrogate + 'A'
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("\uFFFDA");

      // Low surrogate not preceded by high surrogate
      const test2 = String.fromCharCode(0x0041, 0xdc00); // 'A' + low surrogate
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("A\uFFFD");

      // Two high surrogates in a row
      const test3 = String.fromCharCode(0xd800, 0xd801);
      const encoded3 = encoder.encode(test3);
      const decoded3 = new TextDecoder().decode(encoded3);
      expect(decoded3).toBe("\uFFFD\uFFFD");

      // Two low surrogates in a row
      const test4 = String.fromCharCode(0xdc00, 0xdc01);
      const encoded4 = encoder.encode(test4);
      const decoded4 = new TextDecoder().decode(encoded4);
      expect(decoded4).toBe("\uFFFD\uFFFD");
    });

    it("should handle edge case buffer boundaries with invalid UTF-16", () => {
      const encoder = new TextEncoder();

      // Large string ending with unpaired surrogate
      const ascii = Buffer.alloc(100000, "A").toString();
      const largeStr = ascii + String.fromCharCode(0xd800);
      const encoded = encoder.encode(largeStr);
      const expected = new Uint8Array(100003).fill(0x41);
      expected.set([0xef, 0xbf, 0xbd], 100000);
      expect(encoded).toEqual(expected);
      expect(new TextDecoder().decode(encoded)).toBe(ascii + "\uFFFD");

      // Large string with unpaired surrogates scattered throughout
      let scatteredStr = "";
      for (let i = 0; i < 1000; i++) {
        scatteredStr += "Hello";
        if (i % 100 === 0) {
          scatteredStr += String.fromCharCode(0xd800);
        }
      }
      const encoded2 = encoder.encode(scatteredStr);
      expect(encoded2).toEqual(utf8Reference(scatteredStr));
      expect(new TextDecoder().decode(encoded2)).toBe(scatteredStr.replaceAll("\uD800", "\uFFFD"));
    });

    it("should handle boundary surrogates correctly", () => {
      const encoder = new TextEncoder();

      // Maximum high surrogate
      const test1 = String.fromCharCode(0xdbff);
      const encoded1 = encoder.encode(test1);
      const decoded1 = new TextDecoder().decode(encoded1);
      expect(decoded1).toBe("\uFFFD");

      // Maximum low surrogate
      const test2 = String.fromCharCode(0xdfff);
      const encoded2 = encoder.encode(test2);
      const decoded2 = new TextDecoder().decode(encoded2);
      expect(decoded2).toBe("\uFFFD");

      // Valid surrogate pair at boundaries
      const test3 = String.fromCharCode(0xdbff, 0xdfff); // Maximum valid surrogate pair
      const encoded3 = encoder.encode(test3);
      expect(Array.from(encoded3)).toEqual([0xf4, 0x8f, 0xbf, 0xbf]); // U+10FFFF
      const decoded3 = new TextDecoder().decode(encoded3);
      expect(decoded3).toBe(String.fromCharCode(0xdbff, 0xdfff)); // Should preserve the valid pair

      // Just outside surrogate range (valid BMP characters)
      const test4 = String.fromCharCode(0xd7ff, 0xe000); // Last char before surrogates, first after
      const encoded4 = encoder.encode(test4);
      expect(Array.from(encoded4)).toEqual([0xed, 0x9f, 0xbf, 0xee, 0x80, 0x80]);
      const decoded4 = new TextDecoder().decode(encoded4);
      expect(decoded4).toBe(String.fromCharCode(0xd7ff, 0xe000)); // Should preserve both
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
    const encoded = encoder.encode(text);
    expect(encoded).toEqual(utf8Reference(textReal));
    expect(new TextDecoder().decode(encoded)).toBe(textReal);
  });
});

describe("TextEncoder every code point", () => {
  const encoder = new TextEncoder();
  // U+FEFF is one of the code points under test, so the decoder must not strip it as a BOM.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const utf8Length = cp => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  const hex = cp => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

  // One code point per string: the first and last code point of every UTF-8 length,
  // the edges of the surrogate range, the BOM and U+FFFD itself.
  const boundaries = [
    [0x0000, [0x00]],
    [0x007f, [0x7f]],
    [0x0080, [0xc2, 0x80]],
    [0x00ff, [0xc3, 0xbf]],
    [0x0100, [0xc4, 0x80]],
    [0x07ff, [0xdf, 0xbf]],
    [0x0800, [0xe0, 0xa0, 0x80]],
    [0xd7ff, [0xed, 0x9f, 0xbf]],
    [0xd800, [0xef, 0xbf, 0xbd]],
    [0xdbff, [0xef, 0xbf, 0xbd]],
    [0xdc00, [0xef, 0xbf, 0xbd]],
    [0xdfff, [0xef, 0xbf, 0xbd]],
    [0xe000, [0xee, 0x80, 0x80]],
    [0xfeff, [0xef, 0xbb, 0xbf]],
    [0xfffd, [0xef, 0xbf, 0xbd]],
    [0xffff, [0xef, 0xbf, 0xbf]],
    [0x10000, [0xf0, 0x90, 0x80, 0x80]],
    [0x10ffff, [0xf4, 0x8f, 0xbf, 0xbf]],
  ];
  for (const [cp, bytes] of boundaries) {
    it(`${hex(cp)} alone`, () => {
      const text = String.fromCodePoint(cp);
      const isLoneSurrogate = cp >= 0xd800 && cp <= 0xdfff;
      const dest = new Uint8Array(4).fill(0xaa);
      const encoded = encoder.encode(text);
      expect({
        encoded: Array.from(encoded),
        encodeInto: encoder.encodeInto(text, dest),
        dest: Array.from(dest),
        decoded: decoder.decode(encoded),
      }).toEqual({
        encoded: bytes,
        encodeInto: { read: text.length, written: bytes.length },
        dest: [...bytes, ...new Array(4 - bytes.length).fill(0xaa)],
        decoded: isLoneSurrogate ? "\uFFFD" : text,
      });
    });
  }

  it("should encode all 0x110000 code points like the fixture, 1024 at a time", async () => {
    // utf8-encoding-fixture.bin has one 4-byte slot per code point: its UTF-8 bytes,
    // left-aligned and zero-padded. The slots of the surrogates D800-DFFF hold U+FFFD.
    const fixture = new Uint8Array(await Bun.file(import.meta.dir + "/utf8-encoding-fixture.bin").arrayBuffer());
    expect(fixture.length).toBe(0x110000 * 4);

    // Pack the slots into one UTF-8 byte stream.
    const stream = new Uint8Array(0x80 + 0x780 * 2 + 0xf800 * 3 + 0x100000 * 4);
    for (let cp = 0, offset = 0; cp < 0x110000; cp++) {
      const slot = cp * 4;
      for (let j = 0; j < utf8Length(cp); j++) stream[offset++] = fixture[slot + j];
    }

    // UTF-16 code units of every code point, in order.
    const units = new Uint16Array(0x10000 + 0x100000 * 2);
    for (let cp = 0, i = 0; cp < 0x110000; cp++) {
      if (cp < 0x10000) {
        units[i++] = cp;
      } else {
        units[i++] = 0xd800 + ((cp - 0x10000) >> 10);
        units[i++] = 0xdc00 + ((cp - 0x10000) & 0x3ff);
      }
    }

    // Chunks of 1024 put the high surrogates D800-DBFF and the low surrogates DC00-DFFF
    // in two separate strings. Next to each other, DBFF DC00 would form a valid pair.
    const CHUNK = 1024;
    let unitOffset = 0;
    let byteOffset = 0;
    for (let first = 0; first < 0x110000; first += CHUNK) {
      const unitCount = first < 0x10000 ? CHUNK : 2 * CHUNK;
      const text = String.fromCharCode.apply(null, units.subarray(unitOffset, unitOffset + unitCount));
      let byteCount = 0;
      for (let cp = first; cp < first + CHUNK; cp++) byteCount += utf8Length(cp);
      const expected = stream.subarray(byteOffset, byteOffset + byteCount);
      unitOffset += unitCount;
      byteOffset += byteCount;

      const encoded = encoder.encode(text);
      const dest = new Uint8Array(byteCount);
      const encodeInto = encoder.encodeInto(text, dest);
      const decoded = decoder.decode(encoded);
      const label = `${hex(first)} to ${hex(first + CHUNK - 1)}`;
      expect({ encoded, encodeInto, dest, decoded, reencoded: encoder.encode(decoded) }, label).toEqual({
        encoded: expected,
        encodeInto: { read: unitCount, written: byteCount },
        dest: expected,
        decoded: text.toWellFormed(),
        reencoded: expected,
      });
    }
    expect(unitOffset).toBe(units.length);
    expect(byteOffset).toBe(stream.length);
    // There is no code point 0x110000, so the loop above saw all of them.
    expect(() => String.fromCodePoint(0x110000)).toThrow(RangeError);
  });
});

describe("TextEncoder latin1 ASCII fast path boundaries", () => {
  const encoder = new TextEncoder();

  const flatten = s => {
    s.charCodeAt(0);
    return s;
  };

  it("should encode all-ASCII strings of every length around the SIMD/SWAR thresholds", () => {
    for (const len of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 1024, 4096]) {
      const text = flatten("abcdefgh".repeat(Math.ceil(len / 8) + 1).slice(0, len));
      const encoded = encoder.encode(text);
      expect({ len, bytes: Array.from(encoded) }).toEqual({ len, bytes: Array.from(utf8Reference(text)) });
    }
  });

  it("should encode latin1 strings with a non-ASCII byte at every boundary position", () => {
    for (const len of [1, 7, 8, 9, 16, 31, 32, 63, 64, 65, 100, 128, 200]) {
      for (const pos of new Set([0, 1, 6, 7, 8, 9, 15, 16, 31, 32, 62, 63, 64, 65, len - 2, len - 1])) {
        if (pos < 0 || pos >= len) continue;
        const text = flatten("a".repeat(pos) + "©" + "b".repeat(len - pos - 1));
        const encoded = encoder.encode(text);
        const expected = utf8Reference(text);
        expect({ len, pos, bytes: Array.from(encoded) }).toEqual({ len, pos, bytes: Array.from(expected) });

        const dest = new Uint8Array(expected.length);
        const result = encoder.encodeInto(text, dest);
        expect({ len, pos, read: result.read, written: result.written, bytes: Array.from(dest) }).toEqual({
          len,
          pos,
          read: text.length,
          written: expected.length,
          bytes: Array.from(expected),
        });
      }
    }
  });

  it("should encode latin1 strings made entirely of non-ASCII characters", () => {
    for (const len of [1, 8, 16, 64, 100, 1025]) {
      const text = flatten("©ÿé".repeat(Math.ceil(len / 3)).slice(0, len));
      const encoded = encoder.encode(text);
      expect(Array.from(encoded)).toEqual(Array.from(utf8Reference(text)));
      expect(encoded.length).toBe(2 * len);
    }
  });

  it("encodeInto should not write past `written` when the destination is too small", () => {
    const text = flatten("abcdefgh©xyz");
    const dest = new Uint8Array(16).fill(0xaa);
    const result = encoder.encodeInto(text, dest.subarray(0, 9));
    expect(result).toEqual({ read: 8, written: 8 });
    expect(Array.from(dest.subarray(0, 8))).toEqual(Array.from(utf8Reference("abcdefgh")));
    expect(Array.from(dest.subarray(8))).toEqual(new Array(8).fill(0xaa));
  });

  it("encodeInto should stop cleanly mid-ASCII-run when the destination is smaller than the input", () => {
    const text = flatten("a".repeat(150));
    const dest = new Uint8Array(200).fill(0xaa);
    const result = encoder.encodeInto(text, dest.subarray(0, 70));
    expect(result).toEqual({ read: 70, written: 70 });
    expect(Array.from(dest.subarray(0, 70))).toEqual(new Array(70).fill(0x61));
    expect(Array.from(dest.subarray(70))).toEqual(new Array(130).fill(0xaa));
  });
});

describe("TextEncoder rope fast path", () => {
  const encoder = new TextEncoder();

  it("should encode ropes built from large ASCII segments", () => {
    let text = "";
    let expected = "";
    for (let i = 0; i < 16; i++) {
      const segment = String.fromCharCode(0x41 + i).repeat(100 + i);
      text += segment;
      expected += segment;
    }
    const encoded = encoder.encode(text);
    expect(encoded).toEqual(utf8Reference(expected));
    expect(new TextDecoder().decode(encoded)).toBe(expected);
  });

  it("should encode ropes whose segments contain non-ASCII latin1 characters", () => {
    for (const where of ["start", "middle", "end"]) {
      let text = "";
      const segments = ["x".repeat(80), "y".repeat(13), "z".repeat(200)];
      if (where === "start") segments[0] = "©" + segments[0];
      if (where === "middle") segments[1] = segments[1] + "é" + segments[1];
      if (where === "end") segments[2] = segments[2] + "ÿ";
      for (const segment of segments) {
        text += segment;
      }
      const encoded = encoder.encode(text);
      const expected = utf8Reference(segments.join(""));
      expect({ where, bytes: Array.from(encoded) }).toEqual({ where, bytes: Array.from(expected) });
    }
  });

  it("should encode a large repeated rope identically to its resolved copy", () => {
    const rope = "Hello World!".repeat(1024);
    const resolved = "Hello World!".repeat(1024);
    resolved.charCodeAt(0);
    const fromRope = encoder.encode(rope);
    const fromResolved = encoder.encode(resolved);
    expect(fromRope).toEqual(utf8Reference(resolved));
    expect(fromRope).toEqual(fromResolved);
    expect(new TextDecoder().decode(fromRope)).toBe(resolved);
  });
});

describe("TextEncoder UTF-16 exact-size path", () => {
  const encoder = new TextEncoder();

  it("should encode long valid UTF-16 strings of varying lengths", () => {
    // "n💕ó" is 4 UTF-16 code units. 16 and 17 repeats sit on either side of the
    // 64-unit cutoff between the stack buffer path and the exact-size path.
    for (const repeat of [1, 16, 17, 32, 170, 171, 512, 600, 5000]) {
      const text = "n💕ó".repeat(repeat);
      const encoded = encoder.encode(text);
      expect({ repeat, bytes: encoded.length }).toEqual({ repeat, bytes: 7 * repeat });
      expect(encoded).toEqual(utf8Reference(text));
      expect(new TextDecoder().decode(encoded)).toBe(text);
    }
  });

  it("should encode long UTF-16 strings containing unpaired surrogates", () => {
    for (const repeat of [1, 100, 1000]) {
      for (const lone of ["\ud800", "\udc00"]) {
        const text = ("ab💕" + lone + "cd").repeat(repeat);
        const encoded = encoder.encode(text);
        const expected = utf8Reference(text);
        expect(encoded.length).toBe(expected.length);
        expect(encoded).toEqual(expected);
      }
    }
  });
});
