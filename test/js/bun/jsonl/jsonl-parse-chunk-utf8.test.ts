import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, isLinux } from "harness";

describe("Bun.JSONL.parseChunk on UTF-8 bytes", () => {
  const pieces = [
    "",
    "a",
    "\u00e9",
    "\u00ff",
    "\u0100",
    "\u07ff",
    "\u0800",
    "\u2014",
    "\uffff",
    "\u{10000}",
    "\u{1f600}",
    "\u{10ffff}",
    "\u00e9\u2014\u{1f600}",
  ];

  test("characters of one to four bytes at every distance from the start", () => {
    for (const piece of pieces) {
      for (let before = 0; before < 70; before++) {
        const text = "x".repeat(before) + piece + "y".repeat(17) + piece;
        const result = Bun.JSONL.parseChunk(new TextEncoder().encode(JSON.stringify({ text }) + "\n"));
        expect(result.values).toEqual([{ text }]);
        expect(result.done).toBe(true);
      }
    }
  });

  test("bytes that are not UTF-8 read as TextDecoder reads them", () => {
    const broken = [
      [0xff],
      [0xc3],
      [0xe2, 0x80],
      [0xf0, 0x9f, 0x98],
      [0xed, 0xa0, 0x80],
      [0xc0, 0xaf],
      [0xf4, 0x90, 0x80, 0x80],
      [0x80],
    ];
    for (const bytes of broken) {
      for (let before = 0; before < 40; before++) {
        const inner = [
          ...new TextEncoder().encode("x".repeat(before) + "\u2014"),
          ...bytes,
          ...new TextEncoder().encode("tail"),
        ];
        const line = new Uint8Array([0x22, ...inner, 0x22, 0x0a]);
        expect(Bun.JSONL.parseChunk(line).values).toEqual([new TextDecoder().decode(new Uint8Array(inner))]);
      }
    }
  });

  test("`read` counts bytes where characters take several", () => {
    const first = JSON.stringify({ text: "\u2014 \u{1f600} caf\u00e9" });
    const bytes = new TextEncoder().encode(first + "\n" + '{"cut":');
    const result = Bun.JSONL.parseChunk(bytes);
    expect(result.values.length).toBe(1);
    expect(new TextDecoder().decode(bytes.subarray(result.read)).trimStart()).toBe('{"cut":');
  });

  test.skipIf(!isLinux || process.arch !== "x64" || isDebug || isASAN)(
    "one character outside ASCII does not make a long text several times as slow",
    () => {
      const line = (last: string) =>
        new TextEncoder().encode(
          JSON.stringify("the quick brown fox jumps over the lazy dog. ".repeat(180000) + last) + "\n",
        );
      const fastestOf = (bytes: Uint8Array) => {
        let fastest = Infinity;
        for (let run = 0; run < 15; run++) {
          const began = performance.now();
          expect(Bun.JSONL.parseChunk(bytes).values.length).toBe(1);
          fastest = Math.min(fastest, performance.now() - began);
        }
        return fastest;
      };
      expect(fastestOf(line("\u2014")) / fastestOf(line(""))).toBeLessThan(4.5);
    },
  );
});

describe("texts of parsed JSON whose source holds a character outside Latin-1", () => {
  const long = "the quick brown fox jumps over the lazy dog, again and again and again";
  const latin1 = "caf\u00e9 " + long;
  const wide = "\u2014 " + long;
  const source = JSON.stringify({ long, latin1, wide });

  function check(parsed: { long: string; latin1: string; wide: string }) {
    expect(parsed).toEqual({ long, latin1, wide });
    expect(estimateShallowMemoryUsageOf(parsed.long)).toBe(
      estimateShallowMemoryUsageOf(JSON.parse(JSON.stringify(long))),
    );
    expect(estimateShallowMemoryUsageOf(parsed.latin1)).toBe(
      estimateShallowMemoryUsageOf(JSON.parse(JSON.stringify(latin1))),
    );
    expect(estimateShallowMemoryUsageOf(parsed.wide)).toBeGreaterThan(estimateShallowMemoryUsageOf(parsed.long) * 1.5);
  }

  test("JSON.parse keeps a text of Latin-1 characters in one byte a character", () => {
    check(JSON.parse(source));
  });

  test("Bun.JSONL.parseChunk does too", () => {
    check(Bun.JSONL.parseChunk(new TextEncoder().encode(source + "\n")).values[0] as any);
  });
});
