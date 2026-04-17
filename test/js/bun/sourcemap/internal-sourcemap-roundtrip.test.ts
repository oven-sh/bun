import { internalSourceMap } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// --- Reference VLQ codec (mirrors the spec; used as the oracle) ---

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_DEC: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_DEC[B64[i]] = i;

function encodeVLQ(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

type Seg = { genLine: number; genCol: number; srcIdx: number; origLine: number; origCol: number };

function decodeMappings(mappings: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  let genLine = 0;
  let genCol = 0;
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  function readVLQ(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const d = B64_DEC[mappings[i++]];
      result |= (d & 31) << shift;
      if ((d & 32) === 0) break;
      shift += 5;
    }
    return result & 1 ? -(result >>> 1) : result >>> 1;
  }
  while (i < mappings.length) {
    const c = mappings[i];
    if (c === ";") {
      genLine++;
      genCol = 0;
      i++;
      continue;
    }
    if (c === ",") {
      i++;
      continue;
    }
    genCol += readVLQ();
    if (i >= mappings.length || mappings[i] === "," || mappings[i] === ";") {
      // 1-field segment (gen-col only). InternalSourceMap.fromVLQ skips these.
      continue;
    }
    srcIdx += readVLQ();
    origLine += readVLQ();
    origCol += readVLQ();
    if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
      readVLQ(); // 5th field (name index) — InternalSourceMap drops this.
    }
    out.push({ genLine, genCol, srcIdx, origLine, origCol });
  }
  return out;
}

function referenceFind(segs: Seg[], line: number, col: number): Seg | null {
  // Match Mapping.List.find semantics: last mapping with generated <= (line,col)
  // whose generated line equals `line`.
  let best: Seg | null = null;
  for (const s of segs) {
    if (s.genLine > line || (s.genLine === line && s.genCol > col)) break;
    best = s;
  }
  if (best && best.genLine !== line) return null;
  return best;
}

// --- Synthetic VLQ generator covering codec edge cases ---

function buildSyntheticVLQ(): string {
  // Produce >200 4-field mappings across 3 sources, with:
  // - 5-field segments (names) sprinkled in
  // - 1-field segments sprinkled in
  // - blank-line runs (`;;;;`) so d_gen_line > 1 (gen-line exceptions path)
  // - large d_gen_col occasionally (forces wider varints)
  let out = "";
  let prevGenCol = 0;
  let prevSrcIdx = 0;
  let prevOrigLine = 0;
  let prevOrigCol = 0;
  let prevName = 0;
  let mappingNo = 0;

  function emit4(genCol: number, srcIdx: number, origLine: number, origCol: number, nameIdx?: number) {
    if (out.length && !out.endsWith(";")) out += ",";
    out += encodeVLQ(genCol - prevGenCol);
    out += encodeVLQ(srcIdx - prevSrcIdx);
    out += encodeVLQ(origLine - prevOrigLine);
    out += encodeVLQ(origCol - prevOrigCol);
    if (nameIdx !== undefined) {
      out += encodeVLQ(nameIdx - prevName);
      prevName = nameIdx;
    }
    prevGenCol = genCol;
    prevSrcIdx = srcIdx;
    prevOrigLine = origLine;
    prevOrigCol = origCol;
    mappingNo++;
  }
  function emit1(genCol: number) {
    if (out.length && !out.endsWith(";")) out += ",";
    out += encodeVLQ(genCol - prevGenCol);
    prevGenCol = genCol;
  }
  function newline(n = 1) {
    for (let i = 0; i < n; i++) out += ";";
    prevGenCol = 0;
  }

  // Source 0: 80 mappings, dense, includes 5-field every 7th and 1-field every 11th.
  let origCol = 0;
  let origLine = 0;
  for (let line = 0; line < 20; line++) {
    let col = 0;
    for (let k = 0; k < 4; k++) {
      col += 3 + (k === 2 ? 200 : k); // one large jump per line
      origCol += 4 + k;
      if (mappingNo % 11 === 5) emit1(col - 1); // 1-field segment (skipped by fromVLQ)
      if (mappingNo % 7 === 0) emit4(col, 0, origLine, origCol, mappingNo % 5);
      else emit4(col, 0, origLine, origCol);
    }
    origLine++;
    newline();
  }

  // Blank-line run (d_gen_line = 5 for the next mapping → gen-line exception).
  newline(4);

  // Source 1: 70 mappings.
  for (let line = 0; line < 14; line++) {
    let col = 0;
    for (let k = 0; k < 5; k++) {
      col += 2 + k;
      origCol += 3;
      emit4(col, 1, origLine, origCol);
    }
    origLine++;
    newline();
  }

  // Another blank-line run.
  newline(7);

  // Source 2: 60 mappings, with a name on every 3rd.
  for (let line = 0; line < 12; line++) {
    let col = 0;
    for (let k = 0; k < 5; k++) {
      col += 5;
      origCol += 5;
      if (mappingNo % 3 === 0) emit4(col, 2, origLine, origCol, mappingNo % 4);
      else emit4(col, 2, origLine, origCol);
    }
    origLine++;
    newline();
  }

  return out;
}

// --- Tests ---

describe("InternalSourceMap round-trip", () => {
  test("synthetic: fromVLQ → toVLQ preserves all 4-field positions; names dropped, 1-field skipped", () => {
    const vlqIn = buildSyntheticVLQ();
    const reference = decodeMappings(vlqIn);
    expect(reference.length).toBeGreaterThan(200); // multiple windows
    expect(new Set(reference.map(s => s.srcIdx)).size).toBe(3); // multi-source

    const blob = internalSourceMap.fromVLQ(vlqIn);
    expect(blob.byteLength).toBeGreaterThan(32);

    const vlqOut = internalSourceMap.toVLQ(blob);
    const roundtripped = decodeMappings(vlqOut);

    expect(roundtripped.length).toBe(reference.length);
    for (let i = 0; i < reference.length; i++) {
      expect(roundtripped[i]).toEqual(reference[i]);
    }
  });

  test("synthetic: find() matches reference at every mapping and at probe points between", () => {
    const vlqIn = buildSyntheticVLQ();
    const reference = decodeMappings(vlqIn);
    const blob = internalSourceMap.fromVLQ(vlqIn);

    // Exact hits.
    for (const s of reference) {
      const got = internalSourceMap.find(blob, s.genLine, s.genCol);
      expect(got).not.toBeNull();
      expect(got!.generatedLine).toBe(s.genLine);
      expect(got!.generatedColumn).toBe(s.genCol);
      expect(got!.originalLine).toBe(s.origLine);
      expect(got!.originalColumn).toBe(s.origCol);
      expect(got!.sourceIndex).toBe(s.srcIdx);
    }

    // Between-mapping probes (deterministic pseudo-random).
    let seed = 0x1234;
    const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000;
    for (let p = 0; p < 50; p++) {
      const r = reference[Math.floor(rand() * reference.length)];
      const col = r.genCol + Math.floor(rand() * 3);
      const got = internalSourceMap.find(blob, r.genLine, col);
      const want = referenceFind(reference, r.genLine, col);
      if (want === null) {
        expect(got).toBeNull();
      } else {
        expect(got).not.toBeNull();
        expect(got!.generatedLine).toBe(want.genLine);
        expect(got!.generatedColumn).toBe(want.genCol);
        expect(got!.originalLine).toBe(want.origLine);
        expect(got!.originalColumn).toBe(want.origCol);
        expect(got!.sourceIndex).toBe(want.srcIdx);
      }
    }

    // Before first mapping on a line → null.
    expect(internalSourceMap.find(blob, 0, 0)).toBeNull();
  });

  test("real bundler output: fromVLQ → toVLQ matches; find() matches reference", async () => {
    using dir = tempDir("ism-roundtrip", {
      "a.ts": `
export const a: number = 1;


export function fa(x: number): number { return x + a; }
`,
      "b.ts": `
export const b: string = "two";
export function fb(s: string): string { return s + b; }
`,
      "c.ts": `
import { fa } from "./a";
import { fb } from "./b";
export function go(): string { return fb(String(fa(3))); }
`,
      "index.ts": `
import { go } from "./c";
console.log(go());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.ts", "--sourcemap=external", "--outdir=./out"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exited).toBe(0);

    const map = await Bun.file(path.join(String(dir), "out", "index.js.map")).json();
    expect(map.sources.length).toBeGreaterThanOrEqual(3);
    const vlqIn: string = map.mappings;
    const reference = decodeMappings(vlqIn);
    expect(reference.length).toBeGreaterThan(20);

    const blob = internalSourceMap.fromVLQ(vlqIn);
    const vlqOut = internalSourceMap.toVLQ(blob);
    const roundtripped = decodeMappings(vlqOut);
    expect(roundtripped).toEqual(reference);

    for (const s of reference) {
      const got = internalSourceMap.find(blob, s.genLine, s.genCol);
      expect(got).toEqual({
        generatedLine: s.genLine,
        generatedColumn: s.genCol,
        originalLine: s.origLine,
        originalColumn: s.origCol,
        sourceIndex: s.srcIdx,
      });
    }
  });
});
