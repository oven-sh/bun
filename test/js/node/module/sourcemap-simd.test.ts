// Correctness tests for the SIMD source-map mappings decoder
// (src/jsc/bindings/highway_sourcemap.cpp). The SIMD path is enabled for
// mappings >= 128 bytes; every case here is parsed twice (once normally,
// once with BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP=1 to force the scalar
// decode) and the full mapping list must be byte-identical.

import { describe, expect, test } from "bun:test";
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

// Spawn a child that constructs the SourceMap and dumps findEntry results at
// every probe point. The child runs with or without the SIMD path. The
// payload (which can be tens of KiB) is piped over stdin rather than
// embedded in `-e`, since Windows caps the command line at ~32 KiB.
const dumpScript = `
  const { SourceMap } = require("node:module");
  const { payload, probes } = await Bun.stdin.json();
  let error = null;
  let entries = [];
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
    }
  } catch (err) {
    error = String(err);
  }
  process.stdout.write(JSON.stringify({ entries, error }));
`;

async function dumpMappings(
  mappings: string,
  sourcesLen: number,
  namesLen: number,
  probes: Array<[number, number]>,
  disableSimd: boolean,
): Promise<{ entries: Entry[]; error: string | null; debug: string }> {
  const sources = Array.from({ length: sourcesLen }, (_, i) => `s${i}.js`);
  const names = Array.from({ length: namesLen }, (_, i) => `n${i}`);
  const env = { ...bunEnv };
  if (disableSimd) {
    env.BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP = "1";
  } else {
    delete env.BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP;
  }
  // Debug builds only: enable the SourceMap scoped log so the caller can
  // verify the SIMD path actually fired (see assertSimdMatchesScalar).
  if (isDebug) env.BUN_DEBUG_SourceMap = "1";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", dumpScript],
    env,
    stdin: new Blob([JSON.stringify({ payload: { version: 3, sources, names, mappings }, probes })]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`child exited ${exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`);
  }
  // Scoped debug logs (BUN_DEBUG_SourceMap) go to stdout; the JSON payload
  // is the final line with no trailing newline.
  const lines = stdout.split("\n");
  const json = lines[lines.length - 1];
  const debug = lines.slice(0, -1).join("\n") + stderr;
  return { ...JSON.parse(json), debug };
}

// Build a mappings string from a list of generated lines, each a list of
// [genColDelta, srcIdxDelta, origLineDelta, origColDelta, nameIdxDelta?]
// segments. Returns probe points at every segment's ABSOLUTE
// (generatedLine, generatedColumn) so findEntry hits it exactly.
function build(lines: number[][][]): {
  mappings: string;
  probes: Array<[number, number]>;
  sourcesLen: number;
  namesLen: number;
} {
  const parts: string[] = [];
  const probes: Array<[number, number]> = [];
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
  // Prove the SIMD path actually ran (debug builds only: the scoped log is
  // compiled out of release). Guards against the feature flag or threshold
  // silently routing both children through the scalar path.
  if (isDebug) {
    expect({ label, simdRan: simd.debug.includes("simd consumed") }).toEqual({ label, simdRan: true });
    expect({ label, scalarRan: scalar.debug.includes("simd consumed") }).toEqual({ label, scalarRan: false });
  }
  return scalar;
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

  test("1-field (generated-column-only) segments are skipped but accumulate", async () => {
    // Interleave 1-field and 4-field so the generated column a 4-field
    // segment lands on depends on the preceding 1-field deltas.
    const lines: number[][][] = [[]];
    for (let i = 0; i < 150; i++) {
      lines[0].push([3]); // 1-field
      lines[0].push([2, 0, 0, 1]); // 4-field; probed
    }
    const { mappings, probes, sourcesLen } = build(lines);
    expect(mappings.length).toBeGreaterThanOrEqual(128);
    const scalar = await assertSimdMatchesScalar("1-field-interleaved", mappings, sourcesLen, 0, probes);
    expect(scalar.error).toBeNull();
    // The k'th 4-field segment lands at gen column 5*k + 5 - 0 = 5k+5... check one.
    expect(scalar.entries[0].generatedColumn).toBe(5);
    expect(scalar.entries[1].generatedColumn).toBe(10);
  });

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
      const { mappings, probes, sourcesLen } = build([filler]);
      expect(mappings.length).toBeGreaterThanOrEqual(128);
      const scalar = await assertSimdMatchesScalar(`straddle-${pad}`, mappings, sourcesLen, 0, probes);
      expect(scalar.error).toBeNull();
      expect(scalar.entries[0]).toEqual({
        generatedLine: 0,
        generatedColumn: pad + 1000,
        originalLine: 1000,
        originalColumn: 1000,
        originalSource: "s0.js",
        name: null,
      });
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
    await assertSimdMatchesScalar("6-field", mappings, 1, 1, probes);
  });

  test("over-long VLQ (>= 8 cont bytes): SIMD bails, scalar rejects", async () => {
    // 'g' is sextet 32 (cont bit set, payload 0). Eight in a row then
    // "AAAA," is a 12-byte segment whose first field has 9 sextets.
    // Scalar caps at 8 bytes and returns no-progress -> ParseResult::Fail;
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

  test("out-of-range source index: identical ParseResult::Fail", async () => {
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
