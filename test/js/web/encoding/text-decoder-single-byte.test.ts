import { expect, test } from "bun:test";

test("TextDecoder - IBM866 encoding", () => {
  const decoder = new TextDecoder("ibm866");
  expect(decoder.encoding).toBe("ibm866");

  // "Привет" in IBM866
  const bytes = new Uint8Array([0x8f, 0xe0, 0xa8, 0xa2, 0xa5, 0xe2]);
  const result = decoder.decode(bytes);
  expect(result).toBe("Привет");
});

test("TextDecoder - ISO-8859-3 encoding", () => {
  const decoder = new TextDecoder("iso-8859-3");
  expect(decoder.encoding).toBe("iso-8859-3");

  // "Ħello" (with Maltese H with stroke)
  const bytes = new Uint8Array([0xa1, 0x65, 0x6c, 0x6c, 0x6f]);
  const result = decoder.decode(bytes);
  expect(result).toBe("Ħello");
});

test("TextDecoder - ISO-8859-6 encoding", () => {
  const decoder = new TextDecoder("iso-8859-6");
  expect(decoder.encoding).toBe("iso-8859-6");

  // Test with known character: 0xC7 = U+0627 (Arabic Letter Alef)
  const bytes = new Uint8Array([0xc7]);
  const result = decoder.decode(bytes);
  expect(result.charCodeAt(0)).toBe(0x0627);
});

test("TextDecoder - ISO-8859-7 encoding", () => {
  const decoder = new TextDecoder("iso-8859-7");
  expect(decoder.encoding).toBe("iso-8859-7");

  // "Γειά" in Greek
  const bytes = new Uint8Array([0xc3, 0xe5, 0xe9, 0xdc]);
  const result = decoder.decode(bytes);
  expect(result).toBe("Γειά");
});

test("TextDecoder - ISO-8859-8 encoding", () => {
  const decoder = new TextDecoder("iso-8859-8");
  expect(decoder.encoding).toBe("iso-8859-8");

  // "שלום" in Hebrew
  const bytes = new Uint8Array([0xf9, 0xec, 0xe5, 0xed]);
  const result = decoder.decode(bytes);
  expect(result).toBe("שלום");
});

test("TextDecoder - ISO-8859-8-I encoding", () => {
  const decoder = new TextDecoder("iso-8859-8-i");
  expect(decoder.encoding).toBe("iso-8859-8-i");

  // Same as ISO-8859-8 but with logical ordering
  const bytes = new Uint8Array([0xf9, 0xec, 0xe5, 0xed]);
  const result = decoder.decode(bytes);
  expect(result).toBe("שלום");
});

test("TextDecoder - windows-874 encoding", () => {
  const decoder = new TextDecoder("windows-874");
  expect(decoder.encoding).toBe("windows-874");

  // Thai text "สวัสดี"
  const bytes = new Uint8Array([0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5]);
  const result = decoder.decode(bytes);
  expect(result).toBe("สวัสดี");
});

test("TextDecoder - windows-1253 encoding", () => {
  const decoder = new TextDecoder("windows-1253");
  expect(decoder.encoding).toBe("windows-1253");

  // Greek "Καλημέρα"
  const bytes = new Uint8Array([0xca, 0xe1, 0xeb, 0xe7, 0xec, 0xdd, 0xf1, 0xe1]);
  const result = decoder.decode(bytes);
  expect(result).toBe("Καλημέρα");
});

test("TextDecoder - windows-1255 encoding", () => {
  const decoder = new TextDecoder("windows-1255");
  expect(decoder.encoding).toBe("windows-1255");

  // Hebrew "שלום"
  const bytes = new Uint8Array([0xf9, 0xec, 0xe5, 0xed]);
  const result = decoder.decode(bytes);
  expect(result).toBe("שלום");
});

test("TextDecoder - windows-1257 encoding", () => {
  const decoder = new TextDecoder("windows-1257");
  expect(decoder.encoding).toBe("windows-1257");

  // Lithuanian "Labas"
  const bytes = new Uint8Array([0x4c, 0x61, 0x62, 0x61, 0x73]);
  const result = decoder.decode(bytes);
  expect(result).toBe("Labas");
});

test("TextDecoder - KOI8-U encoding", () => {
  const decoder = new TextDecoder("koi8-u");
  expect(decoder.encoding).toBe("koi8-u");

  // Ukrainian "Привіт"
  const bytes = new Uint8Array([0xf0, 0xd2, 0xc9, 0xd7, 0xa6, 0xd4]);
  const result = decoder.decode(bytes);
  expect(result).toBe("Привіт");
});

test("TextDecoder - x-user-defined encoding", () => {
  const decoder = new TextDecoder("x-user-defined");
  expect(decoder.encoding).toBe("x-user-defined");

  // Maps bytes 0x80-0xFF to U+F780-U+F7FF
  const bytes = new Uint8Array([0x41, 0x80, 0x81, 0xff]);
  const result = decoder.decode(bytes);
  expect(result).toBe("A\uF780\uF781\uF7FF");
});

test("TextDecoder - replacement encoding", () => {
  const decoder = new TextDecoder("replacement");
  expect(decoder.encoding).toBe("replacement");

  // All input should result in replacement character
  const bytes = new Uint8Array([0x41, 0x42, 0x43]);
  const result = decoder.decode(bytes);
  expect(result).toBe("\uFFFD");
});

const cp = (...codes: number[]) => String.fromCharCode(...codes);

test("TextDecoder - ISO-8859-2 encoding", () => {
  const decoder = new TextDecoder("iso-8859-2");
  expect(decoder.encoding).toBe("iso-8859-2");
  expect(new TextDecoder("latin2").encoding).toBe("iso-8859-2");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x017c, 0x010e, 0x00df));
});

test("TextDecoder - ISO-8859-4 encoding", () => {
  const decoder = new TextDecoder("iso-8859-4");
  expect(decoder.encoding).toBe("iso-8859-4");
  expect(new TextDecoder("latin4").encoding).toBe("iso-8859-4");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x014b, 0x012a, 0x00df));
});

test("TextDecoder - ISO-8859-5 encoding", () => {
  const decoder = new TextDecoder("iso-8859-5");
  expect(decoder.encoding).toBe("iso-8859-5");
  expect(new TextDecoder("cyrillic").encoding).toBe("iso-8859-5");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x041f, 0x042f, 0x043f));
});

test("TextDecoder - ISO-8859-10 encoding", () => {
  const decoder = new TextDecoder("iso-8859-10");
  expect(decoder.encoding).toBe("iso-8859-10");
  expect(new TextDecoder("latin6").encoding).toBe("iso-8859-10");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x014b, 0x00cf, 0x00df));
});

test("TextDecoder - ISO-8859-13 encoding", () => {
  const decoder = new TextDecoder("iso-8859-13");
  expect(decoder.encoding).toBe("iso-8859-13");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x00e6, 0x013b, 0x00df));
});

test("TextDecoder - ISO-8859-14 encoding", () => {
  const decoder = new TextDecoder("iso-8859-14");
  expect(decoder.encoding).toBe("iso-8859-14");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x1e61, 0x00cf, 0x00df));
});

test("TextDecoder - ISO-8859-15 encoding", () => {
  const decoder = new TextDecoder("iso-8859-15");
  expect(decoder.encoding).toBe("iso-8859-15");
  expect(new TextDecoder("l9").encoding).toBe("iso-8859-15");
  expect(decoder.decode(new Uint8Array([0xa4]))).toBe("\u20ac");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x00bf, 0x00cf, 0x00df));
});

test("TextDecoder - ISO-8859-16 encoding", () => {
  const decoder = new TextDecoder("iso-8859-16");
  expect(decoder.encoding).toBe("iso-8859-16");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x017c, 0x00cf, 0x00df));
});

test("TextDecoder - KOI8-R encoding", () => {
  const decoder = new TextDecoder("koi8-r");
  expect(decoder.encoding).toBe("koi8-r");
  expect(new TextDecoder("koi8").encoding).toBe("koi8-r");
  expect(decoder.decode(new Uint8Array([0xbf, 0xcf, 0xdf]))).toBe(cp(0x00a9, 0x043e, 0x044a));
});

test("TextDecoder - macintosh encoding", () => {
  const decoder = new TextDecoder("macintosh");
  expect(decoder.encoding).toBe("macintosh");
  expect(new TextDecoder("x-mac-roman").encoding).toBe("macintosh");
  expect(decoder.decode(new Uint8Array([0x80, 0xbf, 0xcf]))).toBe(cp(0x00c4, 0x00f8, 0x0153));
});

test("TextDecoder - x-mac-cyrillic encoding", () => {
  const decoder = new TextDecoder("x-mac-cyrillic");
  expect(decoder.encoding).toBe("x-mac-cyrillic");
  expect(new TextDecoder("x-mac-ukrainian").encoding).toBe("x-mac-cyrillic");
  expect(decoder.decode(new Uint8Array([0x80, 0xbf, 0xcf]))).toBe(cp(0x0410, 0x045a, 0x0455));
});

test("TextDecoder - windows-1250 encoding", () => {
  const decoder = new TextDecoder("windows-1250");
  expect(decoder.encoding).toBe("windows-1250");
  expect(new TextDecoder("cp1250").encoding).toBe("windows-1250");
  expect(decoder.decode(new Uint8Array([0x80, 0xbf, 0xcf]))).toBe(cp(0x20ac, 0x017c, 0x010e));
});

test("TextDecoder - windows-1251 encoding", () => {
  const decoder = new TextDecoder("windows-1251");
  expect(decoder.encoding).toBe("windows-1251");
  expect(new TextDecoder("cp1251").encoding).toBe("windows-1251");
  expect(decoder.decode(new Uint8Array([0x80, 0xbf, 0xcf]))).toBe(cp(0x0402, 0x0457, 0x041f));
});

test("TextDecoder - windows-1254 encoding", () => {
  const decoder = new TextDecoder("windows-1254");
  expect(decoder.encoding).toBe("windows-1254");
  expect(new TextDecoder("iso-8859-9").encoding).toBe("windows-1254");
  expect(new TextDecoder("latin5").encoding).toBe("windows-1254");
  expect(decoder.decode(new Uint8Array([0x80, 0xcf, 0xdf]))).toBe(cp(0x20ac, 0x00cf, 0x00df));
});

test("TextDecoder - windows-1256 encoding", () => {
  const decoder = new TextDecoder("windows-1256");
  expect(decoder.encoding).toBe("windows-1256");
  expect(new TextDecoder("cp1256").encoding).toBe("windows-1256");
  expect(decoder.decode(new Uint8Array([0x80, 0xbf, 0xcf]))).toBe(cp(0x20ac, 0x061f, 0x062f));
});

test("TextDecoder - windows-1258 encoding", () => {
  const decoder = new TextDecoder("windows-1258");
  expect(decoder.encoding).toBe("windows-1258");
  expect(new TextDecoder("cp1258").encoding).toBe("windows-1258");
  expect(decoder.decode(new Uint8Array([0x80, 0xcf, 0xdf]))).toBe(cp(0x20ac, 0x00cf, 0x00df));
});
