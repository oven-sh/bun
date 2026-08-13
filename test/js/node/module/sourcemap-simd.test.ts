// Correctness tests for the SIMD source-map mappings decoder
// (src/jsc/bindings/highway_sourcemap.cpp), which src/sourcemap/Mapping.rs
// uses for mappings >= 128 bytes. Every scenario is decoded by two children:
// one running normally (SIMD kernel, then the scalar loop for the tail) and
// one with BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP=1 (scalar loop only). The
// two decodes must be identical, and both must equal the rows computed here
// from the deltas that were encoded.
//
// The feature flag is read once per process, so all scenarios are sent to a
// single child per mode (spawning a child per scenario and mode made this
// file one of the slowest in the suite).

import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

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

type Decoded = {
  // `new SourceMap(payload).findEntry(...)` at each probe, or [] when the
  // constructor threw.
  entries: Entry[];
  // String(err) of the constructor's exception, or null.
  error: string | null;
};

type Scenario = {
  mappings: string;
  sources: string[];
  names: string[];
  probes: Array<[line: number, column: number]>;
  expected: Decoded;
  // Debug builds only. Scenarios with a deliberate anomaly: the byte offset of
  // the offending segment, where the kernel must hand over to the scalar
  // loop. Scenarios without one: the kernel must get to within one block
  // (< 64 bytes) of the end.
  simdStopsAt?: number;
};

function sourceList(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `s${i}.js`);
}

function nameList(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `n${i}`);
}

// Build a scenario from a list of generated lines, each a list of
// [genColDelta, srcIdxDelta, origLineDelta, origColDelta, nameIdxDelta?]
// segments. A 1-field segment only advances the generated column; every
// other segment produces a row, which is probed at its exact generated
// position. Rows before the first 5-field segment have no name; after it,
// 4-field rows carry the last name index forward (what the scalar decoder
// does, and therefore what the kernel has to reproduce).
function build(lines: number[][][]): Scenario {
  const parts: string[] = [];
  const probes: Scenario["probes"] = [];
  const entries: Entry[] = [];
  let src = 0;
  let srcMax = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  let nameMax = 0;
  let hasNames = false;
  for (let li = 0; li < lines.length; li++) {
    let genCol = 0;
    const segs: string[] = [];
    for (const seg of lines[li]) {
      segs.push(encodeSegment(seg));
      genCol += seg[0];
      if (seg.length < 4) continue;
      src += seg[1];
      srcMax = Math.max(srcMax, src);
      origLine += seg[2];
      origCol += seg[3];
      if (seg.length >= 5) {
        name += seg[4];
        nameMax = Math.max(nameMax, name);
        hasNames = true;
      }
      probes.push([li, genCol]);
      entries.push({
        generatedLine: li,
        generatedColumn: genCol,
        originalLine: origLine,
        originalColumn: origCol,
        originalSource: `s${src}.js`,
        name: hasNames ? `n${name}` : null,
      });
    }
    parts.push(segs.join(","));
  }
  return {
    mappings: parts.join(";"),
    sources: sourceList(srcMax + 1),
    names: hasNames ? nameList(nameMax + 1) : [],
    probes,
    expected: { entries, error: null },
  };
}

// A row of a hand-encoded scenario: everything below that is encoded by hand
// stays on generated line 0 / original line 0 of the single source.
function row(generatedColumn: number, originalColumn: number, name: string | null = null): Entry {
  return { generatedLine: 0, generatedColumn, originalLine: 0, originalColumn, originalSource: "s0.js", name };
}

function handEncoded(segments: string[], entries: Entry[]): Scenario {
  return {
    mappings: segments.join(","),
    sources: ["s0.js"],
    names: [],
    probes: entries.map((e): [number, number] => [0, e.generatedColumn!]),
    expected: { entries, error: null },
  };
}

// A [1, 0, 0, 1] segment: one generated column and one original column
// further than the previous row.
const STEP = encodeSegment([1, 0, 0, 1]); // "CAAC"

// 60 STEP segments, 299 bytes: the well-formed prefix the kernel has to decode
// before it reaches the deliberate anomaly that the scenarios using it append
// at offset 300 (after the ',').
function anomalyPrefix(): Scenario & { anomalyAt: number } {
  const prefix = build([Array.from({ length: 60 }, () => [1, 0, 0, 1])]);
  return { ...prefix, anomalyAt: prefix.mappings.length + 1 };
}

// Runs in the child. The BUN_DEBUG_SourceMap lines that the parser writes
// (debug builds) go straight to fd 1, so a marker written to fd 1 before each
// scenario lets the parent attribute them to the scenario being decoded.
// (node:fs is deliberately not loaded: in a debug build it costs more to
// initialize than everything else this script does.)
const decodeScript = `
  const { SourceMap } = require("node:module");
  const results = [];
  for (const { payload, probes } of await Bun.stdin.json()) {
    await Bun.write(Bun.stdout, "@@scenario\\n");
    const entries = [];
    let error = null;
    try {
      const map = new SourceMap(payload);
      for (const [line, column] of probes) {
        const e = map.findEntry(line, column);
        entries.push({
          generatedLine: e.generatedLine ?? null,
          generatedColumn: e.generatedColumn ?? null,
          originalLine: e.originalLine ?? null,
          originalColumn: e.originalColumn ?? null,
          originalSource: e.originalSource ?? null,
          name: e.name ?? null,
        });
      }
    } catch (err) {
      error = String(err);
    }
    results.push({ entries, error });
  }
  await Bun.write(Bun.stdout, "@@results\\n" + JSON.stringify(results) + "\\n");
`;

type Run = {
  // Both indexed like `scenarios`.
  results: Decoded[];
  debug: string[];
};

const scenarios: Scenario[] = [];

// `input` is the JSON the child reads from stdin: every scenario's payload and
// probes. (Over stdin because it is ~80 KiB and Windows caps the command line
// at ~32 KiB.)
async function decodeAll(input: string, disableSimd: boolean): Promise<Run> {
  const env = { ...bunEnv };
  if (disableSimd) {
    env.BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP = "1";
  } else {
    delete env.BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP;
  }
  // The SourceMap scoped log is compiled out of release builds; in debug
  // builds it is how the tests tell which decoder actually ran.
  if (isDebug) env.BUN_DEBUG_SourceMap = "1";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", decodeScript],
    env,
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const [log, json] = stdout.split("@@results\n");
  const debug = log.split("@@scenario\n").slice(1);
  const results: Decoded[] = JSON.parse(json);
  expect(debug).toHaveLength(scenarios.length);
  expect(results).toHaveLength(scenarios.length);
  return { results, debug };
}

describe("SourceMap SIMD mappings decode", () => {
  let simd: Run;
  let scalar: Run;

  beforeAll(async () => {
    const input = JSON.stringify(
      scenarios.map(({ mappings, sources, names, probes }) => ({
        payload: { version: 3, sources, names, mappings },
        probes,
      })),
    );
    [simd, scalar] = await Promise.all([decodeAll(input, false), decodeAll(input, true)]);
  });

  function scenario(name: string, make: () => Scenario) {
    const index = scenarios.push(make()) - 1;
    test(name, () => {
      const { mappings, expected, simdStopsAt } = scenarios[index];
      // SIMD_THRESHOLD in src/sourcemap/Mapping.rs.
      expect(mappings.length).toBeGreaterThanOrEqual(128);
      expect(simd.results[index]).toEqual(scalar.results[index]);
      expect(scalar.results[index]).toEqual(expected);

      if (!isDebug) return;
      // The parse log line carries the input length, which ties each child's
      // log chunk to this scenario. The scalar child must never enter the
      // kernel; the other child logs "simd consumed <stopped at>/<len> bytes"
      // (src/sourcemap/Mapping.rs) when the kernel returns.
      const parsed = `parse mappings (${mappings.length} bytes)`;
      expect(scalar.debug[index]).toContain(parsed);
      expect(scalar.debug[index]).not.toContain("simd");
      expect(simd.debug[index]).toContain(parsed);
      expect(simd.debug[index]).toMatch(/simd consumed \d+\/\d+ bytes/);
      const [stoppedAt, total] = /simd consumed (\d+)\/(\d+) bytes/.exec(simd.debug[index])!.slice(1).map(Number);
      expect(total).toBe(mappings.length);
      if (simdStopsAt !== undefined) {
        expect(stoppedAt).toBe(simdStopsAt);
      } else {
        // Only the final partial block is left to the scalar loop; the widest
        // block any target uses is 64 bytes.
        expect(stoppedAt).toBeGreaterThan(mappings.length - 64);
      }
    });
  }

  scenario("all 1-char 4-field segments (the 76% case)", () => {
    // 200 segments of (4 one-char fields + comma) on one line so the kernel
    // sees many uniform blocks. Deltas cycle through the whole 1-char VLQ
    // range.
    const segs: number[][] = [];
    for (let i = 0; i < 200; i++) {
      segs.push([1 + (i % 14), 0, i % 3, (i % 5) + 1]);
    }
    return build([segs]);
  });

  scenario("mixed 1/2/3-char VLQs in each of the four positions", () => {
    // |v| in [0,15] -> 1 char, [16,511] -> 2 chars, [512,16383] -> 3 chars.
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      const gc = [3, 40, 600][i % 3];
      const ol = [0, 1, 33, 0][i % 4];
      const doc = [2, 100, 700, 5][i % 4];
      segs.push([gc, 0, ol, doc]);
    }
    return build([segs]);
  });

  scenario("2-char VLQ in each of the five positions (Masked-VByte shuffle)", () => {
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
    return build([segs]);
  });

  scenario("5-field segments with names", () => {
    // The name index accumulates across segments: rows resolve to n0..n119.
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      segs.push([2, 0, 0, 1, i === 0 ? 0 : 1]);
    }
    return build([segs]);
  });

  scenario("interleaved 4- and 5-field segments", () => {
    // The 4-field segments between 5-field ones carry the previous name
    // forward.
    const segs: number[][] = [];
    for (let i = 0; i < 120; i++) {
      if (i % 3 === 0) segs.push([2, 0, 0, 1, i === 0 ? 0 : 1]);
      else segs.push([2, 0, 0, 1]);
    }
    return build([segs]);
  });

  scenario("all-4-field map with non-empty names: every row has name: null", () => {
    // The SIMD pre-pass promotes the list to WithNames up front (allow_names),
    // so the rows the scalar loop appends for the tail land in a WithNames
    // list too. They must carry an explicit -1; storing the initial name
    // accumulator (0) instead would resolve them to names[0].
    const segs: number[][] = [];
    for (let i = 0; i < 200; i++) segs.push([1, 0, 0, 1]);
    return { ...build([segs]), names: nameList(3) };
  });

  scenario("4-field rows before the first 5-field segment keep name: null", () => {
    // WithoutNames -> WithNames promotion: rows before the first 5-field
    // segment resolve to name: null, and 4-field rows after it carry its name
    // forward. The first 5-field segment sits in the same block as preceding
    // 4-field rows so the kernel's backfill path is exercised.
    const segs: number[][] = [];
    for (let i = 0; i < 80; i++) segs.push([1, 0, 0, 1]);
    segs.push([1, 0, 0, 1, 0]); // first 5-field at index 80
    for (let i = 0; i < 60; i++) segs.push([1, 0, 0, 1]);
    return build([segs]);
  });

  scenario("1-field (generated-column-only) segments are skipped but accumulate", () => {
    // Interleave 1-field and 4-field so the generated column of every 4-field
    // row depends on the preceding 1-field deltas.
    const segs: number[][] = [];
    for (let i = 0; i < 150; i++) {
      segs.push([3]); // 1-field
      segs.push([2, 0, 0, 1]); // 4-field; produces a row
    }
    return build([segs]);
  });

  scenario("semicolon runs (line resets) and trailing ';'", () => {
    // 60 lines, some empty (';;'), each non-empty line has a few segments.
    // Only the generated column resets at a line break; the other
    // accumulators carry across lines.
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
    const built = build(lines);
    // Trailing line breaks with no segments after them.
    return { ...built, mappings: built.mappings + ";;;" };
  });

  for (const pad of [10, 15, 16, 31, 32, 61, 63, 64]) {
    scenario(`block-boundary straddle at offset ${pad * 2}`, () => {
      // `pad` one-char 1-field segments = 2*pad bytes ("C," repeated), so the
      // first 4-field segment starts at byte 2*pad and its multi-byte body
      // straddles whichever block boundary 2*pad is near.
      const segs: number[][] = [];
      for (let i = 0; i < pad; i++) segs.push([1]);
      segs.push([1000, 0, 1000, 1000]); // 10-byte body (3+1+3+3); seg_len=10 passes the >10 bail
      segs.push([1, 0, 0, 1]);
      while (segs.length < 80) segs.push([1, 0, 0, 0]);
      return build([segs]);
    });
  }

  scenario("every 1-char VLQ value (sextets 0..31)", () => {
    // Sextets 0..31 have no continuation bit and form complete 1-char VLQs.
    // Each one is the original-column delta of its own segment: sextet i
    // decodes to magnitude i >> 1, negated when bit 0 is set. The first
    // segment parks the column at 5000 so it stays non-negative. Segment k
    // sits at generated column k.
    const segments = ["AAA" + encodeVlq(5000)];
    const entries = [row(0, 5000)];
    let originalColumn = 5000;
    for (let i = 0; i < 32; i++) {
      segments.push("CAA" + BASE64[i]);
      originalColumn += i & 1 ? -(i >> 1) : i >> 1;
      entries.push(row(segments.length - 1, originalColumn));
    }
    // Zero-delta padding to get past the SIMD threshold.
    for (let i = 0; i < 40; i++) {
      segments.push("CAAA");
      entries.push(row(segments.length - 1, originalColumn));
    }
    return handEncoded(segments, entries);
  });

  scenario("every continuation-byte sextet (32..63) including '+' and '/'", () => {
    // Sextets 32..63 have the continuation bit set; each one is the first
    // byte of a 2-char VLQ terminated by 'C' (sextet 2), so the VLQ's raw
    // value is (i & 31) | (2 << 5), distinct for every i: a wrong lookup for
    // any byte (including the '+' -> 62 and '/' -> 63 roll-table special
    // cases) shows up as the wrong original column.
    const segments = ["AAA" + encodeVlq(5000)];
    const entries = [row(0, 5000)];
    let originalColumn = 5000;
    for (let i = 32; i < 64; i++) {
      segments.push("CAA" + BASE64[i] + "C");
      const raw = (i & 31) | (2 << 5);
      originalColumn += raw & 1 ? -(raw >> 1) : raw >> 1;
      entries.push(row(segments.length - 1, originalColumn));
    }
    for (let i = 0; i < 40; i++) {
      segments.push("CAAA");
      entries.push(row(segments.length - 1, originalColumn));
    }
    return handEncoded(segments, entries);
  });

  scenario("invalid base64 mid-input: SIMD bails, scalar produces identical result", () => {
    // The scalar decoder does not reject a non-base64 byte: its LUT maps '!'
    // to sextet 127 (continuation bit set, payload 31), so "!A" decodes as a
    // 2-char VLQ with value -15. The kernel must hand over at that segment
    // and the rest of the line must then decode from the resulting state.
    const prefix = anomalyPrefix();
    // The prefix rows end at generated column 60 / original column 60; "CAA!A"
    // is one column further and moves the original column to 45; the 60 STEP
    // segments after it advance both by one each.
    const tail = Array.from({ length: 61 }, (_, i) => row(61 + i, 45 + i));
    return {
      ...handEncoded([prefix.mappings, "CAA!A", ...Array(60).fill(STEP)], [...prefix.expected.entries, ...tail]),
      simdStopsAt: prefix.anomalyAt,
    };
  });

  scenario("6-field segment: SIMD bails, scalar re-decodes", () => {
    // The scalar decoder reads five fields of "CAACAC" (a row at column 61
    // naming n0) and then treats the sixth 'C' as a fresh 1-field segment,
    // so the generated column moves on to 62 without a row and the 40 STEP
    // segments after it land on columns 63..102, each carrying n0 forward.
    // The kernel cannot express that in one step and must hand over.
    const prefix = anomalyPrefix();
    const sixField = row(61, 61, "n0");
    const tail = Array.from({ length: 40 }, (_, i) => row(63 + i, 62 + i, "n0"));
    return {
      mappings: [prefix.mappings, "CAACAC", ...Array(40).fill(STEP)].join(","),
      sources: prefix.sources,
      names: ["n0"],
      // Column 62 has no row of its own, so findEntry reports the row at 61
      // for it as well.
      probes: [...prefix.probes, [0, 61], [0, 62], ...tail.map((e): [number, number] => [0, e.generatedColumn!])],
      expected: { entries: [...prefix.expected.entries, sixField, sixField, ...tail], error: null },
      simdStopsAt: prefix.anomalyAt,
    };
  });

  scenario("over-long VLQ (>= 8 cont bytes): SIMD bails, scalar rejects", () => {
    // 'g' is sextet 32 (continuation bit set, payload 0). Eight in a row
    // followed by "AAAA" is a 12-byte segment whose first VLQ has 9 sextets;
    // the scalar decoder caps a VLQ at 8 bytes and reports no progress at the
    // segment's offset. The kernel has to hand over there for the error to
    // come out identical.
    const prefix = anomalyPrefix();
    return {
      mappings: prefix.mappings + ",ggggggggAAAA,AAAA",
      sources: prefix.sources,
      names: [],
      probes: [],
      expected: { entries: [], error: `SyntaxError: Missing generated column value at ${prefix.anomalyAt}` },
      simdStopsAt: prefix.anomalyAt,
    };
  });

  scenario("out-of-range source index: identical ParseResult::Fail", () => {
    // A +5 source-index delta with a single source. The scalar decoder
    // reports the offset of the field it rejected, one byte into the segment.
    const prefix = anomalyPrefix();
    return {
      mappings: prefix.mappings + "," + encodeSegment([1, 5, 0, 0]),
      sources: prefix.sources,
      names: [],
      probes: [],
      expected: { entries: [], error: `SyntaxError: Invalid source index value at ${prefix.anomalyAt + 1}` },
      simdStopsAt: prefix.anomalyAt,
    };
  });

  scenario("large pseudo-random map", () => {
    // Deterministic LCG so the fixture is reproducible: 200 lines and about
    // 2,400 rows (14.5 KiB of mappings) wandering over up to 5 sources, with
    // a 5-field segment roughly every 8 rows.
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
    return build(lines);
  });
});
