import { expect, test } from "bun:test";

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
