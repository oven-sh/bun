import { stringsInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  checkEachBlockOffset,
  checkRandom,
  decodeReference,
  type Decoders,
  expectSameText,
  illFormed,
  mulberry32,
  randomInput,
  repeat,
  wellFormed,
} from "./toUTF16Alloc-fixture";

// `bun.strings.toUTF16AllocForReal(..., sentinel = true)` is only called from
// Windows-specific code (`bun build --compile` metadata in `src/windows.zig`),
// so we exercise it directly via an internal binding here.
//
// Previously, the manual-conversion fallback (taken when simdutf rejects the
// input as invalid UTF-8) wrote the null sentinel with
// `output.items[output.items.len] = 0`, which indexes one past the slice
// length: always a bounds-check panic in safe builds, and a heap write past
// the allocation in release builds whenever the ArrayList's capacity equals
// its length.

const { toUTF16AllocSentinel } = stringsInternals;

describe("bun.strings.toUTF16AllocForReal(sentinel=true)", () => {
  test("pure ASCII", () => {
    expect(toUTF16AllocSentinel(Buffer.from("abc"))).toBe("abc");
  });

  test("valid UTF-8 with non-ASCII (simdutf fast path)", () => {
    expect(toUTF16AllocSentinel(Buffer.from("café", "utf8"))).toBe("café");
    expect(toUTF16AllocSentinel(Buffer.from("アプリケーション", "utf8"))).toBe("アプリケーション");
  });

  test("lone continuation byte", () => {
    expect(toUTF16AllocSentinel(new Uint8Array([0x80]))).toBe("\uFFFD");
  });

  test("ASCII prefix then invalid byte (capacity == len at sentinel)", () => {
    // firstNonASCII = 3; simdutf allocates out_length+1 then fails at 0x80;
    // the fallback ArrayList ends up with items.len == capacity after
    // appending U+FFFD, so writing the sentinel must grow the allocation.
    expect(toUTF16AllocSentinel(new Uint8Array([0x61, 0x62, 0x63, 0x80]))).toBe("abc\uFFFD");
  });

  test("multiple invalid sequences ending in non-ASCII", () => {
    expect(toUTF16AllocSentinel(new Uint8Array([0x80, 0x61, 0x80, 0x62, 0x80]))).toBe("\uFFFDa\uFFFDb\uFFFD");
  });

  test("invalid sequence followed by trailing ASCII", () => {
    expect(toUTF16AllocSentinel(new Uint8Array([0x80, 0x61, 0x62, 0x63]))).toBe("\uFFFDabc");
  });
});

// `toUTF16Alloc` is the UTF-8 decoder of `Buffer#toString`, `TextDecoder`,
// `fs.readFile`, `Blob#text` and `Response#text`. simdutf converts the text
// and stops at an ill-formed sequence. The decoder keeps what simdutf
// converted, and a scalar loop decodes the rest.
describe("bun.strings.toUTF16Alloc with ill-formed sequences", () => {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const fatalDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  const decoders: Decoders = {
    "Buffer#toString": input => input.toString("utf8"),
    "sentinel": input => toUTF16AllocSentinel(input),
    "TextDecoder": input => decoder.decode(input),
  };

  test.each(wellFormed)("an ill-formed sequence at each offset of a SIMD block of %s", character => {
    expect(checkEachBlockOffset(character, decoders)).toBeGreaterThan(0);
  });

  test("random text with ill-formed sequences decodes like the WHATWG decoder", () => {
    checkRandom(240, decoders, (input, errors, expected, what) => {
      if (errors === 0) expectSameText(fatalDecoder.decode(input), expected, `fatal TextDecoder, ${what}`);
      else expect(() => fatalDecoder.decode(input), `fatal TextDecoder, ${what}`).toThrow(TypeError);
    });
  });

  // simdutf has one kernel for each instruction set, and each kernel writes
  // the text in front of an ill-formed sequence with its own code. A machine
  // selects one kernel: these run the others that it has.
  function otherKernels(): string[] {
    if (process.arch !== "x64") return [];
    const kernels = ["westmere"];
    try {
      const flags = /^flags\s*:(.*)$/m.exec(readFileSync("/proc/cpuinfo", "utf8"))?.[1].split(" ") ?? [];
      if (["avx2", "bmi1", "bmi2"].every(flag => flags.includes(flag))) kernels.push("haswell");
    } catch {}
    return kernels;
  }

  test.concurrent.each(otherKernels())("the %s kernel of simdutf gives the same text", async kernel => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "toUTF16Alloc-fixture.ts")],
      env: { ...bunEnv, SIMDUTF_FORCE_IMPLEMENTATION: kernel },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // 19 sequences at 147 offsets, and 80 random inputs.
    expect(stdout.trim() || stderr).toBe(JSON.stringify({ checked: 19 * 147 + 80 }));
    expect(exitCode).toBe(0);
  });

  test("text between ill-formed sequences that are far apart", () => {
    for (const character of wellFormed) {
      const width = Buffer.byteLength(character);
      // Counts of characters.
      const runs = [0, 1, 90, 3, 700, 40_000, 5, 300_000 / width, 2].map(Math.floor);
      const parts: Buffer[] = [];
      let expected = "";
      runs.forEach((count, i) => {
        const bad = illFormed[(i * 5 + width) % illFormed.length];
        parts.push(Buffer.alloc(count * width, character), bad.bytes);
        expected += repeat(character, count) + bad.text;
      });
      const input = Buffer.concat(parts);
      for (const [name, decode] of Object.entries(decoders)) {
        expectSameText(decode(input), expected, `${name}, ${character}`);
      }
    }
  });

  // simdutf counts no unit for a continuation byte with no lead, so its
  // U+FFFD takes the room of a later character, and the output must grow.
  test("a continuation byte with no lead in front of more text", () => {
    for (const character of wellFormed) {
      for (const [before, after] of [
        [10_000, 100],
        [0, 3],
        [70, 70_000],
      ]) {
        const width = Buffer.byteLength(character);
        const input = Buffer.concat([
          Buffer.alloc(before * width, character),
          Buffer.from([0x80]),
          Buffer.alloc(after * width, character),
        ]);
        const expected = repeat(character, before) + "\ufffd" + repeat(character, after);
        for (const [name, decode] of Object.entries(decoders)) {
          expectSameText(decode(input), expected, `${name}, ${before} and ${after} of ${character}`);
        }
      }
    }
  });

  test("each API gives the same text", async () => {
    using dir = tempDir("utf8-ill-formed", {});
    const path = join(String(dir), "input.txt");
    for (let seed = 1; seed <= 24; seed++) {
      const random = mulberry32(seed + 20_000);
      const input = randomInput(random, 200 + Math.floor(random() * 30000), [0.0005, 0.01, 0.3][seed % 3]);
      const expected = decodeReference(input).text;
      writeFileSync(path, input);
      expectSameText(readFileSync(path, "utf8"), expected, `readFileSync, seed ${seed}`);
      expectSameText(await Bun.file(path).text(), expected, `Bun.file().text(), seed ${seed}`);
      expectSameText(await new Blob([input]).text(), expected, `Blob#text, seed ${seed}`);
      expectSameText(await new Response(input).text(), expected, `Response#text, seed ${seed}`);
      expectSameText(input.utf8Slice(0, input.length), expected, `Buffer#utf8Slice, seed ${seed}`);
      const decoder = new StringDecoder("utf8");
      expectSameText(decoder.write(input) + decoder.end(), expected, `StringDecoder, seed ${seed}`);
    }
  });

  // The decoder keeps the buffer that simdutf wrote the text in. It once
  // allocated a second one, with a unit for each byte of the input. ASAN's
  // limit for one allocation tells the two apart: 6 MiB of 3-byte characters
  // decode to 4 MiB of UTF-16, and a unit for each byte is 12 MiB.
  test.skipIf(!isASAN)("an ill-formed sequence costs no buffer with a unit for each input byte", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const text = Buffer.alloc(6 * 1024 * 1024, "世");
        const cut = text.subarray(0, text.length - 1);
        const report = decode => {
          try {
            const decoded = decode();
            return [decoded.length, decoded.charCodeAt(decoded.length - 2), decoded.charCodeAt(decoded.length - 1)];
          } catch (e) {
            return e.code ?? e.name;
          }
        };
        console.log(JSON.stringify([report(() => cut.toString("utf8")), report(() => new TextDecoder().decode(cut))]));
        `,
      ],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=8", "detect_leaks=0"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const decoded = [2 * 1024 * 1024, 0x4e16, 0xfffd];
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([decoded, decoded]);
    expect(exitCode).toBe(0);
  });
});
