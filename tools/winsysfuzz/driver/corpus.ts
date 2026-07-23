// Corpus + mutation for the coverage-guided loop (Fuzzilli's core mechanism,
// Windows-native, process-per-program): programs that produce a NOVELTY
// signal are kept and mutated instead of every program being an independent
// draw. Novelty is coverage edges when the target is instrumented, else a
// cheap output fingerprint (distinct native-error / stderr shapes).
//
// Generated programs are structured as `await $step("label", ...)`
// statement blocks between a fixed preamble and epilogue, so mutation
// operates on those blocks: drop, duplicate, reorder, and splice blocks
// from another corpus entry.
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CorpusEntry {
  id: string;
  file: string;
  hits: number; // times selected
  kept: number; // children of this entry that were admitted
}

export class Corpus {
  entries: CorpusEntry[] = [];
  dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".js")) this.entries.push({ id: f.replace(/\.js$/, ""), file: join(dir, f), hits: 0, kept: 0 });
    }
  }
  get size(): number {
    return this.entries.length;
  }
  add(id: string, text: string): CorpusEntry {
    const file = join(this.dir, `${id}.js`);
    writeFileSync(file, text);
    const e: CorpusEntry = { id, file, hits: 0, kept: 0 };
    this.entries.push(e);
    return e;
  }
  // Favor entries whose children have been productive; keep exploration
  // by giving unselected entries a floor weight.
  pick(rnd: () => number): CorpusEntry | undefined {
    if (!this.entries.length) return undefined;
    let total = 0;
    const w = this.entries.map(e => {
      const x = 1 + e.kept * 3 - Math.min(2, e.hits * 0.02);
      const v = Math.max(0.25, x);
      total += v;
      return v;
    });
    let r = rnd() * total;
    for (let i = 0; i < this.entries.length; i++) {
      r -= w[i];
      if (r <= 0) {
        this.entries[i].hits++;
        return this.entries[i];
      }
    }
    return this.entries[this.entries.length - 1];
  }
}

// ---- program-text block model ---------------------------------------------
// A program = preamble lines, then $step blocks, then epilogue. A block
// starts at a line matching /await \$step\(|await \$settle\(|const \$v\d+ = /
// and runs until the next such line or the epilogue marker.
export interface ProgramParts {
  preamble: string[];
  blocks: string[][];
  epilogue: string[];
}

const isBlockStart = (l: string) => /^(await \$step\(|const \$v\d+ = \$add\(|await \$settle\()/.test(l.trimStart());
const isEpilogueStart = (l: string) =>
  /^\/\/ --- epilogue|^try \{ if \(\$srv\) \$srv\.stop|^const \$line = "GEN-STATS/.test(l.trimStart());

export function splitProgram(text: string): ProgramParts | null {
  const lines = text.split("\n");
  const firstBlock = lines.findIndex(isBlockStart);
  if (firstBlock < 0) return null;
  let epi = lines.findIndex((l, i) => i > firstBlock && isEpilogueStart(l));
  if (epi < 0) epi = lines.length;
  const preamble = lines.slice(0, firstBlock);
  const body = lines.slice(firstBlock, epi);
  const epilogue = lines.slice(epi);
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const l of body) {
    if (isBlockStart(l) && cur.length) {
      blocks.push(cur);
      cur = [];
    }
    cur.push(l);
  }
  if (cur.length) blocks.push(cur);
  return { preamble, blocks, epilogue };
}

export const joinProgram = (p: ProgramParts) =>
  [...p.preamble, ...p.blocks.flat(), ...p.epilogue].join("\n");

// A block DECLARES at most a leading `const $vN`; when a block is duplicated
// or spliced from elsewhere its declaration would collide, so rename its own
// declaration (and self-references) to a fresh binding. References to
// OTHER $v's stay pointed at the parent's objects (cross-pollination).
let freshCounter = 100000;
function freshenBlock(block: string[]): string[] {
  // Rename every `const|let $name` declared inside the block (block-local
  // bindings) so a duplicated/spliced copy never redeclares.
  const decls = new Set<string>();
  for (const l of block) {
    for (const m of l.matchAll(/\b(?:const|let)\s+(\$[A-Za-z_][A-Za-z0-9_]*)\b/g)) decls.add(m[1]);
  }
  if (!decls.size) return [...block];
  let out = [...block];
  for (const oldName of decls) {
    const newName = `$m${++freshCounter}`;
    const re = new RegExp(oldName.replace(/\$/g, "\\$") + "\\b", "g");
    out = out.map(l => l.replace(re, newName));
  }
  return out;
}

// ---- mutations --------------------------------------------------------------
export type Mutation = "drop" | "dup" | "swap" | "splice" | "shuffle" | "double-splice";

export function mutate(
  parentText: string,
  otherText: string | undefined,
  rnd: () => number,
): { text: string; op: Mutation } | null {
  const p = splitProgram(parentText);
  if (!p || p.blocks.length < 2) return null;
  const other = otherText ? splitProgram(otherText) : null;
  const ops: Mutation[] = ["drop", "dup", "swap", "shuffle"];
  if (other && other.blocks.length) ops.push("splice", "splice", "double-splice");
  const op = ops[(rnd() * ops.length) | 0];
  const b = p.blocks;
  const idx = () => (rnd() * b.length) | 0;
  switch (op) {
    case "drop":
      if (b.length > 2) b.splice(idx(), 1);
      break;
    case "dup": {
      const i = idx();
      b.splice(i, 0, freshenBlock(b[i]));
      break;
    }
    case "swap": {
      const i = idx(),
        j = idx();
      [b[i], b[j]] = [b[j], b[i]];
      break;
    }
    case "shuffle":
      for (let i = b.length - 1; i > 0; i--) {
        const j = (rnd() * (i + 1)) | 0;
        [b[i], b[j]] = [b[j], b[i]];
      }
      break;
    case "splice": {
      const src = other!.blocks;
      const blk = src[(rnd() * src.length) | 0];
      b.splice(idx(), 0, freshenBlock(blk));
      break;
    }
    case "double-splice": {
      const src = other!.blocks;
      for (let k = 0; k < 2; k++) {
        const blk = src[(rnd() * src.length) | 0];
        b.splice(idx(), 0, freshenBlock(blk));
      }
      break;
    }
  }
  return { text: joinProgram(p), op };
}

// ---- novelty signal --------------------------------------------------------
// With coverage: a bitmap of edges never seen before ("virgin" bits, AFL-
// style). Without: a set of output fingerprints.
export class Novelty {
  virgin: Uint8Array | null = null;
  seen = new Set<string>();
  useCoverage: boolean;
  constructor(useCoverage: boolean, edges = 0) {
    this.useCoverage = useCoverage;
    if (useCoverage) {
      this.virgin = new Uint8Array(Math.max(1, edges) >> 3 || 262144);
      this.virgin.fill(0xff);
    }
  }
  // Returns the number of new edges/features this run contributed.
  checkCoverage(bits: Uint8Array): number {
    if (!this.virgin) return 0;
    let novel = 0;
    const n = Math.min(bits.length, this.virgin.length);
    for (let i = 0; i < n; i++) {
      const fresh = bits[i] & this.virgin[i];
      if (fresh) {
        // popcount
        let x = fresh;
        while (x) {
          x &= x - 1;
          novel++;
        }
        this.virgin[i] &= ~bits[i];
      }
    }
    return novel;
  }
  checkFingerprint(fp: string): number {
    if (this.seen.has(fp)) return 0;
    this.seen.add(fp);
    return 1;
  }
}

// Reduce a run's stderr to a stable shape: native error names / thrown
// error constructors and top frames, addresses and numbers folded.
export function fingerprintOutput(stderr: string, exitCode: number | null): string {
  const lines = stderr.split(/\r?\n/);
  const key: string[] = [`exit:${exitCode}`];
  for (const l of lines) {
    const m =
      /^(\w*Error|panic|error|RangeError|TypeError|SyntaxError)[:(]/.exec(l) ||
      /\b(ENO\w+|EACCES|EPERM|EINVAL|EBADF|EMFILE|EISDIR|ENOTDIR|EPIPE|ECONN\w+)\b/.exec(l);
    if (m) key.push(m[1]);
  }
  return key.slice(0, 6).join("|");
}
