import { gcAndSweep } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, isLinux, withoutAggressiveGC } from "harness";
import { readFileSync } from "node:fs";

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

  // parseChunk decodes bytes that are not all ASCII to text, then parses the text. TextDecoder and a parse of its text
  // do those two steps, so their time is the yardstick. An all-ASCII line is parsed in place: the ratio to it follows
  // the machine more than the code.
  //
  // The bytes go through simdutf five times and TextDecoder twice, so the ratio rises as simdutf's kernel gets slower.
  // On the SSE4.2 kernel it reaches the bound, so the case needs a CPU with AVX2.
  function hasAVX2() {
    if (!isLinux || process.arch !== "x64") return false;
    try {
      return /^flags\s*:.*\bavx2\b/m.test(readFileSync("/proc/cpuinfo", "utf8"));
    } catch {
      return false;
    }
  }
  test.skipIf(!hasAVX2() || isDebug || isASAN)(
    "a long line with one character outside ASCII takes under twice as long from bytes as from TextDecoder and a parse of its text",
    () => {
      // 900 KB: a call takes under a millisecond, so of 15 calls one runs undisturbed even on a busy machine.
      const bytes = new TextEncoder().encode(
        JSON.stringify("the quick brown fox jumps over the lazy dog. ".repeat(20000) + "\u2014") + "\n",
      );
      const decoder = new TextDecoder();
      // Collecting first keeps a collection out of the measured time, and the call gets the memory the collection
      // freed instead of pages the system has yet to map.
      const timeOf = (parse: () => { values: unknown[] }) => {
        gcAndSweep();
        const began = performance.now();
        const { values } = parse();
        const took = performance.now() - began;
        expect(values.length).toBe(1);
        return took;
      };
      const parseBytes = () => Bun.JSONL.parseChunk(bytes);
      const parseText = () => Bun.JSONL.parseChunk(decoder.decode(bytes));
      let fromBytes = Infinity;
      let fromText = Infinity;
      withoutAggressiveGC(() => {
        for (let run = 0; run < 15; run++) {
          fromBytes = Math.min(fromBytes, timeOf(parseBytes));
          fromText = Math.min(fromText, timeOf(parseText));
        }
      });
      expect(fromBytes / fromText).toBeLessThan(2);
    },
  );
});
