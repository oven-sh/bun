// Correctness tests for the SIMD source-map mappings decoder
// (src/jsc/bindings/highway_sourcemap.cpp). The SIMD path is enabled for
// mappings >= 128 bytes; every case here is parsed twice (once normally,
// once with BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP=1 to force the scalar
// decode) and the full mapping list must be byte-identical.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Encode a single i32 as a source-map VLQ (sign-magnitude, 5-bit groups with
// a continuation bit, standard base64 alphabet). Matches
// src/base64/lib.rs::vlq::VLQ::encode.
function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq !== 0) digit |= 32;
    out += BASE64[digit];
  } while (vlq !== 0);
  return out;
}

function encodeSegment(fields: number[]): string {
  return fields.map(encodeVlq).join("");
}

type Entry = {
  generatedLine: number | null;
  generatedColumn: number | null;
  originalLine: number | null;
  originalColumn: number | null;
  originalSource: string | null;
  name: string | null;
};

type Dump = { entries: Entry[]; origins: Array<string | null>; error: string | null; debug: string };

// A child constructs the SourceMap and dumps findEntry results (and the
// file name findOrigin gives) at every probe point. It reads one case per
// line of stdin (a payload can be tens of KiB) and answers with one RESULT
// line. Scoped debug logs (BUN_DEBUG_SourceMap) go to stdout before it.
const RESULT = "\x01result ";
const dumpScript = `
  const { SourceMap } = require("node:module");
  for await (const line of console) {
    if (!line) continue;
    const { payload, probes } = JSON.parse(line);
    let error = null;
    let entries = [];
    let origins = [];
    try {
      const map = new SourceMap(payload);
      for (const [l, c] of probes) {
        const e = map.findEntry(l, c);
        entries.push({
          generatedLine: e.generatedLine ?? null,
          generatedColumn: e.generatedColumn ?? null,
          originalLine: e.originalLine ?? null,
          originalColumn: e.originalColumn ?? null,
          originalSource: e.originalSource ?? null,
          name: e.name ?? null,
        });
        origins.push(map.findOrigin(l, c).fileName ?? null);
      }
    } catch (err) {
      error = String(err);
    }
    await Bun.write(Bun.stdout, ${JSON.stringify(RESULT)} + JSON.stringify({ entries, origins, error }) + "\\n");
  }
`;

// One child with the SIMD path and one without serve every case. A debug
// build takes about half a second to start, and a pair of children per
// test, all started at once, ran every test past the default timeout.
function startDecoder(disableSimd: boolean) {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", dumpScript],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP: disableSimd ? "1" : undefined,
      // Debug builds only: the SourceMap scoped log shows whether the SIMD
      // path ran (see assertSimdMatchesScalar).
      BUN_DEBUG_SourceMap: isDebug ? "1" : undefined,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const waiting: Array<PromiseWithResolvers<Dump>> = [];
  let stopped: Error | undefined;
  const exited = (async () => {
    const stderr = proc.stderr.text();
    const utf8 = new TextDecoder();
    let partial = "";
    let debug: string[] = [];
    for await (const chunk of proc.stdout) {
      const lines = (partial + utf8.decode(chunk, { stream: true })).split("\n");
      partial = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith(RESULT)) {
          debug.push(line);
          continue;
        }
        waiting.shift()!.resolve({ ...JSON.parse(line.slice(RESULT.length)), debug: debug.join("\n") });
        debug = [];
      }
    }
    const result = { exitCode: await proc.exited, stderr: await stderr };
    // A child that stops early fails the cases that wait for it, and the
    // ones that come later.
    stopped = new Error(`the child exited: ${JSON.stringify(result)}`);
    for (const { reject } of waiting) reject(stopped);
    return result;
  })();
  return {
    decode(request: object): Promise<Dump> {
      if (stopped) return Promise.reject(stopped);
      const result = Promise.withResolvers<Dump>();
      waiting.push(result);
      proc.stdin.write(JSON.stringify(request) + "\n");
      proc.stdin.flush();
      return result.promise;
    },
    close() {
      proc.stdin.end();
      return exited;
    },
  };
}

let decoders: Record<"simd" | "scalar", ReturnType<typeof startDecoder>>;
beforeAll(() => {
  decoders = { simd: startDecoder(false), scalar: startDecoder(true) };
});
afterAll(async () => {
  const [simd, scalar] = await Promise.all([decoders.simd.close(), decoders.scalar.close()]);
  expect({ simd, scalar }).toMatchObject({ simd: { exitCode: 0 }, scalar: { exitCode: 0 } });
});

function dumpMappings(
  mappings: string,
  sourcesLen: number,
  namesLen: number,
  probes: Array<[number, number]>,
  disableSimd: boolean,
): Promise<Dump> {
  const sources = Array.from({ length: sourcesLen }, (_, i) => `s${i}.js`);
  const names = Array.from({ length: namesLen }, (_, i) => `n${i}`);
  return decoders[disableSimd ? "scalar" : "simd"].decode({
    payload: { version: 3, sources, names, mappings },
    probes,
  });
}

// Build a mappings string from a list of generated lines, each a list of
// [genColDelta, srcIdxDelta, origLineDelta, origColDelta, nameIdxDelta?]
// segments. Returns probe points at every segment's ABSOLUTE
// (generatedLine, generatedColumn) so findEntry hits it exactly: `probes`
// for the 4- and 5-field segments, `oneFieldProbes` for the [genColDelta]
// ones.
function build(lines: number[][][]): {
  mappings: string;
  probes: Array<[number, number]>;
  oneFieldProbes: Array<[number, number]>;
  sourcesLen: number;
  namesLen: number;
} {
  const parts: string[] = [];
  const probes: Array<[number, number]> = [];
  const oneFieldProbes: Array<[number, number]> = [];
  let srcMax = 0;
  let nameMax = 0;
  let src = 0;
  let name = 0;
  for (let li = 0; li < lines.length; li++) {
    let genCol = 0;
    const segs: string[] = [];
    for (const seg of lines[li]) {
      segs.push(encodeSegment(seg));
      genCol += seg[0];
      if (seg.length >= 4) {
        src += seg[1];
        srcMax = Math.max(srcMax, src);
        probes.push([li, genCol]);
      } else {
        oneFieldProbes.push([li, genCol]);
      }
      if (seg.length >= 5) {
        name += seg[4];
        nameMax = Math.max(nameMax, name);
      }
    }
    parts.push(segs.join(","));
  }
  return {
    mappings: parts.join(";"),
    probes,
    oneFieldProbes,
    sourcesLen: srcMax + 1,
    namesLen: nameMax + 1,
  };
}

async function assertSimdMatchesScalar(
  label: string,
  mappings: string,
  sourcesLen: number,
  namesLen: number,
  probes: Array<[number, number]>,
) {
  const [simd, scalar] = await Promise.all([
    dumpMappings(mappings, sourcesLen, namesLen, probes, false),
    dumpMappings(mappings, sourcesLen, namesLen, probes, true),
  ]);
  expect({ label, error: simd.error }).toEqual({ label, error: scalar.error });
  expect({ label, entries: simd.entries }).toEqual({ label, entries: scalar.entries });
  expect({ label, origins: simd.origins }).toEqual({ label, origins: scalar.origins });
  // Prove the SIMD path actually ran (debug builds only: the scoped log is
  // compiled out of release). Guards against the feature flag or threshold
  // silently routing both children through the scalar path.
  if (isDebug) {
    expect({ label, simdRan: simd.debug.includes("simd consumed") }).toEqual({ label, simdRan: true });
    expect({ label, scalarRan: scalar.debug.includes("simd consumed") }).toEqual({ label, scalarRan: false });
  }
  return { ...scalar, simdDebug: simd.debug };
}

// The entry of a 1-field segment: its generated position and nothing else.
function unmapped(generatedLine: number, generatedColumn: number): Entry {
  return { generatedLine, generatedColumn, originalLine: null, originalColumn: null, originalSource: null, name: null };
}

function mapped(
  generatedLine: number,
  generatedColumn: number,
  originalLine: number,
  originalColumn: number,
  name: string | null = null,
): Entry {
  return { generatedLine, generatedColumn, originalLine, originalColumn, originalSource: "s0.js", name };
}

// The kernel leaves less than one block (64 bytes at most) to the scalar
// loop unless it bails. Debug builds log how far it got.
function expectKernelDecodedAllBlocks(label: string, simdDebug: string) {
  if (!isDebug) return;
  const [consumed, total] = simdDebug
    .match(/simd consumed (\d+)\/(\d+)/)!
    .slice(1)
    .map(Number);
  expect({ label, leftToScalar: total - consumed < 64 }).toEqual({ label, leftToScalar: true });
}

describe.concurrent("SourceMap SIMD mappings decode", () => {
  test("all 1-char 4-field segments (the 76% case)", async () => {
    // 200 segments of (4 one-char fields + comma) on one line so the SIMD
    // path sees many full blocks. Deltas cycle through the whole 1-char
    // VLQ range.
    const segs: number[][] = [];
    for (let i = 0; i < 200; i++) {
      segs.push([1 + (i % 14), 0, i % 3, (i % 5) + 1]);
    }
    const { mappings, probes, sourcesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("all-1-char", mappings, sourcesLen, 0, probes);
    expect(scalar.error).toBeNull();
    expect(scalar.entries.length).toBe(200);
    // Spot-check the last probe so a silently-empty map fails.
    expect(scalar.entries[199].generatedLine).toBe(0);
    expect(scalar.entries[199].originalSource).toBe("s0.js");
  });

  test("mixed 1/2/3-char VLQs in each of the four positions", async () => {
    // |v| in [0,15] -> 1 char, [16,511] -> 2 chars, [512,16383] -> 3 chars.
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      const gc = [3, 40, 600][i % 3];
      const ol = [0, 1, 33, 0][i % 4];
      const doc = [2, 100, 700, 5][i % 4];
      segs.push([gc, 0, ol, doc]);
    }
    const { mappings, probes, sourcesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("mixed-vlq-widths", mappings, sourcesLen, 0, probes);
    expect(scalar.error).toBeNull();
    expect(scalar.entries.length).toBe(120);
  });

  test("2-char VLQ in each of the five positions (Masked-VByte shuffle)", async () => {
    // Each segment has exactly one 2-char VLQ, rotating through all five
    // field positions, so every kShufTable entry with a single set bit
    // (cont = 1<<k for k in 0..4) is exercised.
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      const f = [1, 0, 0, 1, 0];
      f[i % 5] = 40; // 2-char VLQ
      if (i % 5 !== 4) f.pop(); // 4-field unless the 2-char is the name
      segs.push(f);
    }
    const { mappings, probes, sourcesLen, namesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("shuffle-single-2char", mappings, sourcesLen, namesLen, probes);
    expect(scalar.error).toBeNull();
    expect(scalar.entries.length).toBe(120);
  });

  test("5-field segments with names", async () => {
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      segs.push([2, 0, 0, 1, i === 0 ? 0 : 1]);
    }
    const { mappings, probes, sourcesLen, namesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("5-field", mappings, sourcesLen, namesLen, probes);
    expect(scalar.error).toBeNull();
    // Name index accumulates across segments.
    expect(scalar.entries[0].name).toBe("n0");
    expect(scalar.entries[119].name).toBe("n119");
  });

  test("interleaved 4- and 5-field segments", async () => {
    // 4-field segments between 5-field ones carry the PREVIOUS name index
    // forward (scalar parser doesn't reset it).
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      if (i % 3 === 0) segs.push([2, 0, 0, 1, i === 0 ? 0 : 1]);
      else segs.push([2, 0, 0, 1]);
    }
    const { mappings, probes, sourcesLen, namesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("4-5-mixed", mappings, sourcesLen, namesLen, probes);
    expect(scalar.error).toBeNull();
  });

  test("all-4-field map with non-empty names: every row has name: null", async () => {
    // The SIMD pre-pass promotes to WithNames up front when allow_names,
    // so when the scalar loop resumes for the <N-byte tail (which it
    // always does) it appends into a WithNames list. Without an explicit
    // -1 those tail rows would store name_index=0 (the initial
    // accumulator) and resolve to names[0] instead of null.
    const segs: number[][] = [];
    for (let i = 0; i < 200; i++) segs.push([1, 0, 0, 1]);
    const { mappings, probes, sourcesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    // Non-empty names array but no 5-field segment: every row must be null.
    const scalar = await assertSimdMatchesScalar("all-4-field-with-names", mappings, sourcesLen, 3, probes);
    expect(scalar.error).toBeNull();
    expect(scalar.entries.length).toBe(200);
    for (let i = 0; i < 200; i++) {
      expect({ i, name: scalar.entries[i].name }).toEqual({ i, name: null });
    }
  });

  test("4-field rows before the first 5-field segment keep name: null", async () => {
    // WithoutNames -> WithNames promotion: scalar copies pre-promotion rows
    // with name_index = -1 (to_named()), so rows before the first 5-field
    // segment resolve to name: null, and 4-field rows AFTER it carry the
    // previous 5-field's name forward. The first 5-field is placed in the
    // same SIMD chunk as the preceding 4-field rows so the backfill path
    // is exercised.
    const segs: number[][] = [];
    for (let i = 0; i < 80; i++) segs.push([1, 0, 0, 1]);
    segs.push([1, 0, 0, 1, 0]); // first 5-field at index 80
    for (let i = 0; i < 60; i++) segs.push([1, 0, 0, 1]);
    const { mappings, probes, sourcesLen, namesLen } = build([segs]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("name-promotion", mappings, sourcesLen, namesLen, probes);
    expect(scalar.error).toBeNull();
    expect(scalar.entries[0].name).toBeNull();
    expect(scalar.entries[79].name).toBeNull();
    expect(scalar.entries[80].name).toBe("n0");
    expect(scalar.entries[81].name).toBe("n0");
    expect(scalar.entries[139].name).toBe("n0");
  });

  test("1-field (generated-column-only) segments are entries without an original position", async () => {
    // Interleave 1-field and 4-field so the generated column a 4-field
    // segment lands on depends on the preceding 1-field deltas.
    const lines: number[][][] = [[]];
    for (let i = 0; i < 150; i++) {
      lines[0].push([3]); // 1-field
      lines[0].push([2, 0, 0, 1]); // 4-field
    }
    const { mappings, probes, oneFieldProbes, sourcesLen } = build(lines);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("1-field-interleaved", mappings, sourcesLen, 0, [
      ...probes,
      ...oneFieldProbes,
    ]);
    expect(scalar.error).toBeNull();
    expectKernelDecodedAllBlocks("1-field-interleaved", scalar.simdDebug);
    // The k'th 1-field segment lands at generated column 5k + 3 and the
    // k'th 4-field one at 5k + 5.
    expect(scalar.entries).toEqual([
      ...Array.from({ length: 150 }, (_, k) => mapped(0, 5 * k + 5, 0, k + 1)),
      ...Array.from({ length: 150 }, (_, k) => unmapped(0, 5 * k + 3)),
    ]);
    expect(scalar.origins).toEqual([...Array(150).fill("s0.js"), ...Array(150).fill(null)]);
  });

  // Each case repeats one line 20 times. Every block then holds a ';', so
  // the kernel's per-segment loop decodes it, and the rows fit in the first
  // 4096 bytes of their allocation, which ASAN fills with 0xbe: a column the
  // kernel did not write does not read as 0.
  const none: Entry = {
    generatedLine: null,
    generatedColumn: null,
    originalLine: null,
    originalColumn: null,
    originalSource: null,
    name: null,
  };
  test.each([
    {
      label: "first on a line, between 4-field segments, two in a row, last on a line",
      // Columns 3 (1-field), 5, 9 (1-field), 11 (1-field), 14, 15 (1-field).
      line: () => [[3], [2, 0, 1, 0], [4], [2], [3, 0, 0, 1], [1]],
      expected: (i: number): Array<[number, Entry]> => [
        [2, none],
        [3, unmapped(i, 3)],
        [4, unmapped(i, 3)],
        [5, mapped(i, 5, i + 1, i)],
        [8, mapped(i, 5, i + 1, i)],
        [9, unmapped(i, 9)],
        [10, unmapped(i, 9)],
        [11, unmapped(i, 11)],
        [13, unmapped(i, 11)],
        [14, mapped(i, 14, i + 1, i + 1)],
        [15, unmapped(i, 15)],
        [40, unmapped(i, 15)],
      ],
    },
    {
      label: "negative column deltas",
      // In the string: 9, 5 (1-field), 12, 10, 11 (1-field). Sorted: 5, 9, 10, 11, 12.
      line: () => [[9, 0, 1, 0], [-4], [7, 0, 0, 1], [-2, 0, 0, 1], [1]],
      expected: (i: number): Array<[number, Entry]> => [
        [4, none],
        [5, unmapped(i, 5)],
        [8, unmapped(i, 5)],
        [9, mapped(i, 9, i + 1, 2 * i)],
        [10, mapped(i, 10, i + 1, 2 * i + 2)],
        [11, unmapped(i, 11)],
        [12, mapped(i, 12, i + 1, 2 * i + 1)],
        [30, mapped(i, 12, i + 1, 2 * i + 1)],
      ],
    },
    {
      label: "between 5-field segments",
      // Columns 2 (name 2i), 5 (1-field), 7 (name 2i + 1).
      line: (i: number) => [[2, 0, 1, 0, i === 0 ? 0 : 1], [3], [2, 0, 0, 1, 1]],
      expected: (i: number): Array<[number, Entry]> => [
        [2, mapped(i, 2, i + 1, i, `n${2 * i}`)],
        [4, mapped(i, 2, i + 1, i, `n${2 * i}`)],
        [5, unmapped(i, 5)],
        [6, unmapped(i, 5)],
        [7, mapped(i, 7, i + 1, i + 1, `n${2 * i + 1}`)],
        [20, mapped(i, 7, i + 1, i + 1, `n${2 * i + 1}`)],
      ],
    },
    {
      label: "column deltas of 2 to 7 VLQ characters",
      line: () => [
        [40],
        [1, 0, 1, 0],
        [1000],
        [1, 0, 0, 1],
        [40000],
        [1, 0, 0, 1],
        [1200000],
        [1, 0, 0, 1],
        [20000000],
        [1, 0, 0, 1],
        [600000000],
        [1, 0, 0, 1],
      ],
      expected: (i: number): Array<[number, Entry]> => [
        [40, unmapped(i, 40)],
        [41, mapped(i, 41, i + 1, 5 * i)],
        [1041, unmapped(i, 1041)],
        [1042, mapped(i, 1042, i + 1, 5 * i + 1)],
        [41042, unmapped(i, 41042)],
        [41043, mapped(i, 41043, i + 1, 5 * i + 2)],
        [1241043, unmapped(i, 1241043)],
        [1241044, mapped(i, 1241044, i + 1, 5 * i + 3)],
        [21241044, unmapped(i, 21241044)],
        [21241045, mapped(i, 21241045, i + 1, 5 * i + 4)],
        [621241045, unmapped(i, 621241045)],
        [621241046, mapped(i, 621241046, i + 1, 5 * i + 5)],
      ],
    },
  ])("1-field segments: $label", async ({ label, line, expected }) => {
    const lines = Array.from({ length: 20 }, (_, i) => line(i));
    const { mappings, sourcesLen, namesLen } = build(lines);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const probes: Array<[number, number]> = [];
    const entries: Entry[] = [];
    for (let i = 0; i < lines.length; i++) {
      for (const [column, entry] of expected(i)) {
        probes.push([i, column]);
        entries.push(entry);
      }
    }
    const scalar = await assertSimdMatchesScalar(label, mappings, sourcesLen, namesLen, probes);
    expect(scalar.error).toBeNull();
    expectKernelDecodedAllBlocks(label, scalar.simdDebug);
    expect({ label, entries: scalar.entries }).toEqual({ label, entries });
    expect({ label, origins: scalar.origins }).toEqual({ label, origins: entries.map(entry => entry.originalSource) });
  });

  test("a map of 1-field segments only, without sources", async () => {
    // 130 segments and 129 delimiters: the kernel's row capacity is exact.
    const lines: number[][][] = [Array.from({ length: 100 }, () => [1])];
    for (let i = 0; i < 30; i++) lines.push([[2]]);
    const { mappings, oneFieldProbes } = build(lines);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("1-field-only", mappings, 0, 0, [[0, 0], [1, 1], ...oneFieldProbes]);
    expect(scalar.error).toBeNull();
    expectKernelDecodedAllBlocks("1-field-only", scalar.simdDebug);
    expect(scalar.entries).toEqual([
      none,
      none,
      ...Array.from({ length: 100 }, (_, k) => unmapped(0, k + 1)),
      ...Array.from({ length: 30 }, (_, k) => unmapped(k + 1, 2)),
    ]);
    expect(scalar.origins).toEqual(Array(132).fill(null));
  });

  test.each([false, true])(
    "a frame of // @bun code after a 1-field segment in a 128+ byte map (scalar only: %p)",
    async disableSimd => {
      // "EAIE" maps line 3 column 2 to original.ts 5:3 and "G" un-maps that
      // line from column 5. "EAGA" maps line 6 column 2 to original.ts 8:3.
      // The kernel stores no names for a runtime map.
      const mappingLines: string[] = Array(84).fill("");
      mappingLines[2] = "EAIE,G";
      mappingLines[5] = "EAGA";
      for (let i = 14; i < mappingLines.length; i++) mappingLines[i] = "AACA";
      const mappings = mappingLines.join(";");
      expect(mappings.length).toBeGreaterThanOrEqual(128);
      using dir = tempDir("sourcemap-simd-one-field", {
        "entry.js": `// @bun
function unmapped() {
  throw new Error("unmapped");
}
function mapped() {
  throw new Error("mapped");
}
for (const fn of [unmapped, mapped]) {
  try {
    fn();
  } catch (e) {
    console.log(e.stack.split("\\n")[1].trim());
  }
}
//# sourceMappingURL=entry.js.map
`,
        "entry.js.map": JSON.stringify({
          version: 3,
          sources: ["original.ts"],
          sourcesContent: [null],
          names: [],
          mappings,
        }),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: {
          ...bunEnv,
          BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP: disableSimd ? "1" : undefined,
          BUN_DEBUG_SourceMap: isDebug ? "1" : undefined,
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const frames = stdout
        .replaceAll(String(dir), "<dir>")
        .replaceAll("\\", "/")
        .split(/\r?\n/)
        .filter(line => line.startsWith("at "));
      expect({ frames, exitCode }).toEqual({
        frames: ["at unmapped (<dir>/entry.js:3:18)", "at mapped (<dir>/original.ts:8:3)"],
        exitCode: 0,
      });
      if (isDebug) expect((stdout + stderr).includes("simd consumed")).toBe(!disableSimd);
    },
  );

  test("semicolon runs (line resets) and trailing ';'", async () => {
    // 60 lines, some empty (';;'), each non-empty line has a few segments.
    const lines: number[][][] = [];
    for (let li = 0; li < 60; li++) {
      if (li % 5 === 2) {
        lines.push([]); // empty line -> consecutive ';'
      } else {
        lines.push([
          [0, 0, 1, 0],
          [4, 0, 0, 4],
          [4, 0, 0, 4],
        ]);
      }
    }
    let { mappings, probes, sourcesLen } = build(lines);
    mappings += ";;;"; // trailing line breaks with no segments
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("semicolon-runs", mappings, sourcesLen, 0, probes);
    expect(scalar.error).toBeNull();
  });

  for (const pad of [10, 15, 16, 31, 32, 61, 63, 64]) {
    test(`block-boundary straddle at offset ${pad * 2}`, async () => {
      // `pad` one-char 1-field segments = 2*pad bytes ("X," repeated), so
      // the first 4-field segment starts at byte 2*pad and its multi-byte
      // body straddles whichever block boundary 2*pad is near.
      const filler: number[][] = [];
      for (let i = 0; i < pad; i++) filler.push([1]);
      filler.push([1000, 0, 1000, 1000]); // 10-byte body (3+1+3+3); seg_len=10 passes the >10 bail
      filler.push([1, 0, 0, 1]);
      while (filler.length < 80) filler.push([1, 0, 0, 0]);
      const { mappings, probes, oneFieldProbes, sourcesLen } = build([filler]);
      expect(mappings.length).toBeGreaterThanOrEqual(128);
      const scalar = await assertSimdMatchesScalar(`straddle-${pad}`, mappings, sourcesLen, 0, [
        ...probes,
        ...oneFieldProbes,
      ]);
      expect(scalar.error).toBeNull();
      expect(scalar.entries[0]).toEqual({
        generatedLine: 0,
        generatedColumn: pad + 1000,
        originalLine: 1000,
        originalColumn: 1000,
        originalSource: "s0.js",
        name: null,
      });
      // The filler: one entry without an original position per column.
      expect(scalar.entries.slice(probes.length)).toEqual(Array.from({ length: pad }, (_, k) => unmapped(0, k + 1)));
    });
  }

  test("every 1-char VLQ value (sextets 0..31)", async () => {
    // Sextets 0..31 have no continuation bit and form complete 1-char VLQs.
    // Put each as the original-column delta; a large starting column keeps
    // the accumulator non-negative across the negative deltas.
    const head = "AAA" + encodeVlq(5000);
    const pieces: string[] = [head];
    for (let i = 0; i < 32; i++) pieces.push("CAA" + BASE64[i]);
    for (let i = 0; i < 40; i++) pieces.push("CAAA");
    const mappings = pieces.join(",");
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const probes: Array<[number, number]> = [];
    for (let i = 0; i <= 32 + 40; i++) probes.push([0, i]);
    const scalar = await assertSimdMatchesScalar("sextets-0-31", mappings, 1, 0, probes);
    expect(scalar.error).toBeNull();
    let oc = 5000;
    for (let i = 0; i < 32; i++) {
      const mag = i >> 1;
      const v = i & 1 ? -mag : mag;
      oc += v;
      expect({ i, originalColumn: scalar.entries[1 + i].originalColumn }).toEqual({ i, originalColumn: oc });
    }
  });

  test("every continuation-byte sextet (32..63) including '+' and '/'", async () => {
    // Sextets 32..63 have the continuation bit set; use each as the FIRST
    // byte of a 2-char VLQ terminated by 'C' (sextet 2). The decoded value
    // is SignMag((i & 31) | (2 << 5)) which is distinct for every i, so a
    // wrong sextet lookup shows up as the wrong original column. Covers the
    // '+' -> 62 and '/' -> 63 roll-table special cases.
    const head = "AAA" + encodeVlq(5000);
    const pieces: string[] = [head];
    for (let i = 32; i < 64; i++) pieces.push("CAA" + BASE64[i] + "C");
    for (let i = 0; i < 40; i++) pieces.push("CAAA");
    const mappings = pieces.join(",");
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const probes: Array<[number, number]> = [];
    for (let i = 0; i <= 32 + 40; i++) probes.push([0, i]);
    const scalar = await assertSimdMatchesScalar("sextets-32-63", mappings, 1, 0, probes);
    expect(scalar.error).toBeNull();
    let oc = 5000;
    for (let i = 32; i < 64; i++) {
      const raw = (i & 31) | (2 << 5);
      const v = raw & 1 ? -(raw >> 1) : raw >> 1;
      oc += v;
      expect({ i, originalColumn: scalar.entries[1 + (i - 32)].originalColumn }).toEqual({ i, originalColumn: oc });
    }
  });

  test("invalid base64 mid-input: SIMD bails, scalar produces identical result", async () => {
    // Scalar decodes a non-base64 byte via its LUT to sextet 127 (cont set)
    // rather than erroring; "!A" therefore decodes as a 2-char VLQ with
    // value -15. SIMD must bail to scalar at that segment and produce the
    // exact same mapping list.
    const head: number[][] = [];
    for (let i = 0; i < 60; i++) head.push([1, 0, 0, 1]);
    const tail: number[][] = [];
    for (let i = 0; i < 60; i++) tail.push([1, 0, 0, 1]);
    const { mappings: headM, probes } = build([head]);
    const { mappings: tailM } = build([tail]);
    // "CAA!A": genCol+=1, src+=0, origLine+=0, origCol+=(-15). origCol was 60.
    const mappings = headM + ",CAA!A," + tailM;
    for (let i = 0; i <= 60; i++) probes.push([0, 60 + 1 + i]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("invalid-byte", mappings, 1, 0, probes);
    expect(scalar.error).toBeNull();
    // Verify the segment containing '!' actually landed where scalar puts it.
    expect(scalar.entries[60]).toEqual({
      generatedLine: 0,
      generatedColumn: 61,
      originalLine: 0,
      originalColumn: 45,
      originalSource: "s0.js",
      name: null,
    });
  });

  test("6-field segment: SIMD bails, scalar re-decodes", async () => {
    // Scalar decodes 5 fields then treats the 6th byte as a fresh 1-field
    // segment; SIMD can't replicate that in one step so it must bail.
    const head: number[][] = [];
    for (let i = 0; i < 60; i++) head.push([1, 0, 0, 1]);
    const { mappings: headM, probes } = build([head]);
    const mappings = headM + ",CAACAC," + "CAAC,".repeat(40).slice(0, -1);
    // Probe the 5-field row at column 61 and every tail row after it.
    for (let i = 0; i <= 41; i++) probes.push([0, 61 + i]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("6-field", mappings, 1, 1, probes);
    // The 6th field reads as a 1-field segment at column 62, as in Node.
    expect(scalar.entries[61]).toEqual(unmapped(0, 62));
  });

  test("over-long VLQ (>= 8 cont bytes): SIMD bails, scalar rejects", async () => {
    // 'g' is sextet 32 (cont bit set, payload 0). Eight in a row then
    // "AAAA," is a 12-byte segment whose first field has 9 sextets.
    // Scalar caps at 8 bytes and returns no-progress -> Err(ParseFail);
    // SIMD must bail at this segment so scalar reports the same error.
    const head: number[][] = [];
    for (let i = 0; i < 60; i++) head.push([1, 0, 0, 1]);
    const { mappings: headM } = build([head]);
    const mappings = headM + ",ggggggggAAAA,AAAA";
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const [simd, scalar] = await Promise.all([
      dumpMappings(mappings, 1, 0, [], false),
      dumpMappings(mappings, 1, 0, [], true),
    ]);
    expect(scalar.error).toContain("Missing generated column value");
    expect(simd.error).toEqual(scalar.error);
  });

  test("out-of-range source index: identical ParseFail", async () => {
    const head: number[][] = [];
    for (let i = 0; i < 60; i++) head.push([1, 0, 0, 1]);
    const { mappings: headM } = build([head]);
    // +5 source-index delta with sources.length == 1 -> out of range.
    const mappings = headM + "," + encodeSegment([1, 5, 0, 0]);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const [simd, scalar] = await Promise.all([
      dumpMappings(mappings, 1, 0, [], false),
      dumpMappings(mappings, 1, 0, [], true),
    ]);
    expect(scalar.error).toContain("Invalid source index value");
    expect(simd.error).toEqual(scalar.error);
  });

  test("large pseudo-random map", async () => {
    // Deterministic LCG so the fixture is reproducible.
    let seed = 0x1234_5678 >>> 0;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const lines: number[][][] = [];
    let origCol = 0;
    let src = 0;
    for (let li = 0; li < 200; li++) {
      const segs: number[][] = [];
      const n = 5 + (rnd() % 20);
      for (let s = 0; s < n; s++) {
        const gc = 1 + (rnd() % 30);
        const ds = (rnd() % 3) - 1;
        if (src + ds < 0 || src + ds > 4) continue;
        src += ds;
        const dol = rnd() % 3;
        let doc: number = (rnd() % 40) - 10;
        if (origCol + doc < 0) doc = -origCol;
        origCol += doc;
        if (rnd() % 8 === 0) {
          segs.push([gc, ds, dol, doc, 0]);
        } else {
          segs.push([gc, ds, dol, doc]);
        }
      }
      lines.push(segs);
    }
    const { mappings, probes, sourcesLen, namesLen } = build(lines);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("pseudo-random", mappings, sourcesLen, namesLen, probes);
    expect(scalar.error).toBeNull();
    expect(scalar.entries.length).toBeGreaterThan(1000);
  });
});
