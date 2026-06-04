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
