import { describe, expect, test } from "bun:test";

test("TextDecoder - Shift_JIS encoding", () => {
  const decoder = new TextDecoder("shift_jis");
  expect(decoder.encoding).toBe("shift_jis");

  // "こんにちは" in Shift_JIS
  const bytes = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
  const result = decoder.decode(bytes);
  expect(result).toBe("こんにちは");
});

test("TextDecoder - EUC-JP encoding", () => {
  const decoder = new TextDecoder("euc-jp");
  expect(decoder.encoding).toBe("euc-jp");

  // "日本語" in EUC-JP
  const bytes = new Uint8Array([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]);
  const result = decoder.decode(bytes);
  expect(result).toBe("日本語");
});

test("TextDecoder - Big5 encoding", () => {
  const decoder = new TextDecoder("big5");
  expect(decoder.encoding).toBe("big5");

  // "你好" in Big5
  const bytes = new Uint8Array([0xa7, 0x41, 0xa6, 0x6e]);
  const result = decoder.decode(bytes);
  expect(result).toBe("你好");
});

test("TextDecoder - EUC-KR encoding", () => {
  const decoder = new TextDecoder("euc-kr");
  expect(decoder.encoding).toBe("euc-kr");

  // "안녕하세요" in EUC-KR
  const bytes = new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4]);
  const result = decoder.decode(bytes);
  expect(result).toBe("안녕하세요");
});

test("TextDecoder - GBK encoding", () => {
  const decoder = new TextDecoder("gbk");
  expect(decoder.encoding).toBe("gbk");

  // "你好世界" in GBK
  const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]);
  const result = decoder.decode(bytes);
  expect(result).toBe("你好世界");
});

test("TextDecoder - GB18030 encoding", () => {
  const decoder = new TextDecoder("gb18030");
  expect(decoder.encoding).toBe("gb18030");

  // "你好" in GB18030 (same as GBK for basic Chinese)
  const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
  const result = decoder.decode(bytes);
  expect(result).toBe("你好");
});

test("TextDecoder - ISO-2022-JP encoding", () => {
  const decoder = new TextDecoder("iso-2022-jp");
  expect(decoder.encoding).toBe("iso-2022-jp");

  // "日本" in ISO-2022-JP (with escape sequences)
  const bytes = new Uint8Array([
    0x1b,
    0x24,
    0x42, // ESC $ B (switch to JIS X 0208)
    0x46,
    0x7c,
    0x4b,
    0x5c, // "日本"
    0x1b,
    0x28,
    0x42, // ESC ( B (switch back to ASCII)
  ]);
  const result = decoder.decode(bytes);
  expect(result).toBe("日本");
});

// A `{stream: true}` decode must carry the codec's partial state (lead byte,
// escape mode, GB18030 first/second/third) across chunk boundaries so that
// concatenating the streamed results equals a single whole decode.
describe("TextDecoder - streaming across chunk boundaries", () => {
  function streamingDecode(encoding: string, bytes: readonly number[], split: readonly number[]): string {
    const d = new TextDecoder(encoding);
    let out = "";
    let off = 0;
    for (let i = 0; i < split.length; i++) {
      const chunk = new Uint8Array(bytes.slice(off, off + split[i]));
      off += split[i];
      out += d.decode(chunk, i < split.length - 1 ? { stream: true } : {});
    }
    return out;
  }

  const cases: Array<[encoding: string, bytes: number[], expected: string, splits: number[][]]> = [
    ["big5", [0xa4, 0x40], "一", [[1, 1]]],
    ["shift_jis", [0x88, 0xea], "一", [[1, 1]]],
    ["gbk", [0xd2, 0xbb], "一", [[1, 1]]],
    ["euc-kr", [0xec, 0xe9], "一", [[1, 1]]],
    // JIS X 0212 plane: 0x8F lead + two trail bytes
    [
      "euc-jp",
      [0x8f, 0xb0, 0xa1],
      "丂",
      [
        [1, 2],
        [2, 1],
        [1, 1, 1],
      ],
    ],
    // 4-byte GB18030 sequence for U+1F4A9
    [
      "gb18030",
      [0x94, 0x39, 0xda, 0x33],
      "💩",
      [
        [2, 2],
        [1, 3],
        [3, 1],
        [1, 1, 1, 1],
      ],
    ],
    // ESC $ B (switch to JIS X 0208) split mid-escape, then "一", then ESC ( B
    [
      "iso-2022-jp",
      [0x1b, 0x24, 0x42, 0x30, 0x6c, 0x1b, 0x28, 0x42],
      "一",
      [
        [1, 7],
        [2, 6],
        [4, 4],
        [3, 2, 3],
      ],
    ],
  ];

  describe.each(cases)("%s", (encoding, bytes, expected, splits) => {
    test("whole decode", () => {
      expect(new TextDecoder(encoding).decode(new Uint8Array(bytes))).toBe(expected);
    });
    for (const split of splits) {
      test(`split ${JSON.stringify(split)}`, () => {
        expect(streamingDecode(encoding, bytes, split)).toBe(expected);
      });
    }
  });

  test("reusing a decoder after a flushing decode starts a fresh stream", () => {
    // End the first stream in JIS X 0208 mode; a fresh stream must start in
    // ASCII so plain ASCII bytes decode as themselves.
    const d = new TextDecoder("iso-2022-jp");
    let first = d.decode(new Uint8Array([0x1b, 0x24, 0x42, 0x30, 0x6c]), { stream: true });
    first += d.decode(new Uint8Array([0x1b, 0x28, 0x42]));
    expect(first).toBe("一");
    expect(d.decode(new Uint8Array([0x41, 0x42, 0x43]))).toBe("ABC");

    // Same for a lead-byte encoding: a buffered lead must not survive a flush.
    const d2 = new TextDecoder("big5");
    expect(d2.decode(new Uint8Array([0xa4]), { stream: true })).toBe("");
    expect(d2.decode(new Uint8Array([0x40]))).toBe("一");
    expect(d2.decode(new Uint8Array([0x40]))).toBe("@");
  });
});

// Malformed input must not corrupt what follows it, and error recovery must
// match https://encoding.spec.whatwg.org/ exactly. Expectations verified
// against encoding_rs (Firefox's Encoding Standard implementation).
describe("TextDecoder - error recovery", () => {
  const codePoints = (encoding: string, bytes: number[]) =>
    Array.from(new TextDecoder(encoding).decode(new Uint8Array(bytes)), c => c.codePointAt(0));

  // https://encoding.spec.whatwg.org/#euc-jp-decoder step 5.3 clears the jis0212
  // flag unconditionally; an aborted JIS X 0212 sequence must not make the NEXT
  // valid JIS X 0208 pair decode through the wrong index.
  test("EUC-JP: aborted JIS X 0212 sequence does not leak into the next pair", () => {
    // 8F A1 starts a JIS X 0212 sequence; 0x61 aborts it. A1 A1 is then a
    // plain JIS X 0208 pair: pointer 0 is U+3000 IDEOGRAPHIC SPACE.
    expect(codePoints("euc-jp", [0x8f, 0xa1, 0x61, 0xa1, 0xa1])).toEqual([0xfffd, 0x61, 0x3000]);
    // Pointer 3102 differs between the two indexes (U+81D3 in jis0208,
    // U+661E in jis0212), so the leak is silent mojibake, not a U+FFFD.
    expect(codePoints("euc-jp", [0x8f, 0xa1, 0x61, 0xc2, 0xa1])).toEqual([0xfffd, 0x61, 0x81d3]);
  });

  // https://encoding.spec.whatwg.org/#big5-decoder step 3.6: an ASCII trail
  // byte of a pair with no entry in index Big5 is restored to the queue, not
  // consumed by the error.
  test("Big5: ASCII trail byte of an unmapped pair is restored", () => {
    expect(codePoints("big5", [0x81, 0x40, 0x41])).toEqual([0xfffd, 0x40, 0x41]);
    // A non-ASCII trail byte is not restored.
    expect(codePoints("big5", [0x81, 0xa1, 0x41])).toEqual([0xfffd, 0x41]);
  });

  // https://encoding.spec.whatwg.org/#iso-2022-jp-decoder "escape" step 8: an
  // invalid escape suffix is restored to the queue along with the lead and
  // reprocessed, so it produces its own error.
  test("ISO-2022-JP: invalid escape suffix produces its own replacement", () => {
    // ESC $ 0E: not an escape; 0x24 is reprocessed as '$' and 0x0E errors.
    expect(codePoints("iso-2022-jp", [0x1b, 0x24, 0x0e])).toEqual([0xfffd, 0x24, 0xfffd]);
  });

  // https://encoding.spec.whatwg.org/#iso-2022-jp-decoder "escape" step 8: at
  // end-of-queue the escape lead is restored and decoded through the decoder
  // OUTPUT state, not appended verbatim.
  test("ISO-2022-JP: escape lead at end of stream is decoded in the output state", () => {
    // ESC ( I puts the output state in katakana; the restored 0x24 of the
    // truncated ESC $ is then a halfwidth katakana (U+FF64), not "$".
    expect(codePoints("iso-2022-jp", [0x1b, 0x28, 0x49, 0x21, 0x1b, 0x24])).toEqual([0xff61, 0xfffd, 0xff64]);
    // ESC $ B puts the output state in lead byte; the restored 0x24 becomes a
    // lead that itself hits end-of-queue, producing a second replacement.
    expect(codePoints("iso-2022-jp", [0x1b, 0x24, 0x42, 0x1b, 0x24])).toEqual([0xfffd, 0xfffd]);
  });
});
