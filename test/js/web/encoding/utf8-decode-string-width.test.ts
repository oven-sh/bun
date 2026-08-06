// UTF-8 decode should materialize an 8-bit JSC string whenever every decoded
// code point fits in Latin-1 (<= U+00FF), not only when the input is pure
// ASCII. Forcing UTF-16 for accented-Latin text doubles the string's footprint
// and loses JSC's 8-bit fast paths (compare/hash/indexOf, YARR, JSON
// stringifier, re-encode on write).
import { describe, expect, test } from "bun:test";
import "harness";

// "café résumé naïve" — é (U+00E9) and ï (U+00EF) are both <= U+00FF.
const latin1Text = "caf\u00e9 r\u00e9sum\u00e9 na\u00efve";
const latin1Utf8 = new TextEncoder().encode(latin1Text);

// U+00FF is the top of the Latin-1 range; its UTF-8 encoding is C3 BF, the
// highest lead byte that still passes the candidate gate.
const boundaryText = "x\u00ffx";
const boundaryUtf8 = new TextEncoder().encode(boundaryText);

// U+0100 (Ā) is C4 80 — one past the Latin-1 range.
const aboveUtf8 = new TextEncoder().encode("x\u0100x");

// U+2014 (EM DASH) is E2 80 94 — well above Latin-1; typical of real prose.
const emDashUtf8 = new TextEncoder().encode("a\u2014b");

describe("UTF-8 decode picks the narrowest string width", () => {
  describe.each([
    ["Buffer#toString('utf8')", (b: Uint8Array) => Buffer.from(b).toString("utf8")],
    ["Buffer#utf8Slice()", (b: Uint8Array) => (Buffer.from(b) as any).utf8Slice(0, b.length)],
    ["Blob#text()", async (b: Uint8Array) => await new Blob([b]).text()],
    ["Response#text()", async (b: Uint8Array) => await new Response(b).text()],
  ] as const)("%s", (_, decode) => {
    test("accented Latin text stays 8-bit", async () => {
      const s = await decode(latin1Utf8);
      expect(s).toBe(latin1Text);
      expect(s).toBeLatin1String();
    });

    test("U+00FF (C3 BF) stays 8-bit", async () => {
      const s = await decode(boundaryUtf8);
      expect(s).toBe(boundaryText);
      expect(s).toBeLatin1String();
    });

    test("U+0100 (C4 80) is 16-bit", async () => {
      const s = await decode(aboveUtf8);
      expect(s).toBe("x\u0100x");
      expect(s).toBeUTF16String();
    });

    test("em dash is 16-bit", async () => {
      const s = await decode(emDashUtf8);
      expect(s).toBe("a\u2014b");
      expect(s).toBeUTF16String();
    });

    test("pure ASCII stays 8-bit", async () => {
      const s = await decode(new TextEncoder().encode("hello"));
      expect(s).toBe("hello");
      expect(s).toBeLatin1String();
    });

    // Invalid UTF-8 whose bytes are all < 0xC4 must still take the
    // replacement-char path (U+FFFD is not Latin-1), not be misdecoded.
    test("overlong C0 80 under the byte gate decodes to U+FFFD", async () => {
      const s = await decode(Uint8Array.of(0x61, 0xc0, 0x80, 0x62));
      expect(s).toBe("a\ufffd\ufffdb");
      expect(s).toBeUTF16String();
    });

    test("stray continuation byte under the byte gate decodes to U+FFFD", async () => {
      const s = await decode(Uint8Array.of(0x61, 0xa9, 0x62));
      expect(s).toBe("a\ufffdb");
      expect(s).toBeUTF16String();
    });

    test("truncated C3 at end decodes to U+FFFD", async () => {
      const s = await decode(Uint8Array.of(0x61, 0xc3));
      expect(s).toBe("a\ufffd");
      expect(s).toBeUTF16String();
    });

    test("C3 followed by non-continuation decodes to U+FFFD", async () => {
      const s = await decode(Uint8Array.of(0x61, 0xc3, 0x41, 0x62));
      expect(s).toBe("a\ufffdAb");
      expect(s).toBeUTF16String();
    });
  });

  test("Blob#json() over Latin-1-range UTF-8", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ name: latin1Text }));
    const obj = await new Blob([body]).json();
    expect(obj).toEqual({ name: latin1Text });
  });

  test("round-trips every code point U+0080..U+00FF", async () => {
    let text = "";
    for (let cp = 0x80; cp <= 0xff; cp++) text += String.fromCharCode(cp);
    const bytes = new TextEncoder().encode(text);
    const s = Buffer.from(bytes).toString("utf8");
    expect(s).toBe(text);
    expect(s.length).toBe(128);
    expect(s).toBeLatin1String();
  });

  test("large Latin-1-range buffer stays 8-bit", async () => {
    // > 32KB so the external-string path is exercised.
    const unit = new TextEncoder().encode(latin1Text);
    const big = new Uint8Array(unit.length * 2000);
    for (let i = 0; i < 2000; i++) big.set(unit, i * unit.length);
    expect(big.length).toBeGreaterThan(32 * 1024);
    const s = Buffer.from(big).toString("utf8");
    expect(s.length).toBe(latin1Text.length * 2000);
    expect(s.startsWith(latin1Text)).toBe(true);
    expect(s.endsWith(latin1Text)).toBe(true);
    expect(s).toBeLatin1String();
  });

  test("Latin-1 body with one late em dash falls back to 16-bit intact", async () => {
    const head = Buffer.alloc(4000, "\u00e9", "utf8");
    const tail = new TextEncoder().encode("\u2014end");
    const bytes = new Uint8Array(head.length + tail.length);
    bytes.set(head, 0);
    bytes.set(tail, head.length);
    const s = Buffer.from(bytes).toString("utf8");
    expect(s).toBeUTF16String();
    expect(s.endsWith("\u2014end")).toBe(true);
    expect(s.startsWith("\u00e9\u00e9")).toBe(true);
  });
});
