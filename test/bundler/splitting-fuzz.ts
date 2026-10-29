// Differential check of what code splitting for `--target=bun` does when it folds chunks together
// (`merge_small_chunks`). A random module graph is run unbundled, bundled with folding off (`foldChunksForTesting:
// false`, an option only Bun's tests use) and bundled with folding on. Every module logs when its top level starts and
// ends, and every value it reads at its top level ("!" when the binding is not initialized yet), so the three runs
// always finish and can be compared line by line.
//
// Code splitting alone already moves shared modules ahead of the chunk that imports them, so a bundle's log can
// differ from the unbundled one. Folding puts those modules back among their importers, so it may differ from the
// unfolded bundle too. What it must never do is make things worse: a fold is wrong when the unfolded bundle agrees with
// the unbundled program on some fact and the folded one does not. The facts compared are (1) each value read, and
// (2) the relative order of the top-level effects.
//
// `checkUnsplit` is a second check on the same graphs, built without code splitting. There every module that an
// `import()` or a `require()` reaches is wrapped in a function that its importers call, so the order that the bundle
// runs them in is the linker's to get right. The bundle must read every value and keep every order of top-level
// effects that the unbundled program has. Given a second binary as a baseline, it reports only what the baseline's
// bundle has right and this one does not.
//
// scripts/splitting-fuzz.ts runs many seeds against a given binary.
import { spawn } from "bun";
import { bunEnv, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Graph = { files: Record<string, string>; entries: string[] };

function generateGraph(seed: number, unsplit = false): Graph {
  const rnd = rng(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const chance = (p: number) => rnd() < p;
  const n = 5 + int(10);
  const twoEntries = chance(0.25);

  const staticImports: number[][] = [];
  for (let i = 0; i < n; i++) {
    const imports = new Set<number>();
    const count = i === 0 ? 1 + int(3) : int(3);
    for (let k = 0; k < count; k++) {
      // mostly forward edges; a back edge now and then closes a cycle
      const j = chance(0.15) ? int(n) : Math.min(n - 1, i + 1 + int(n - i));
      if (j !== i && j !== 0) imports.add(j);
    }
    staticImports.push([...imports]);
  }
  // Modules that await at their top level, and everything that statically reaches one, cannot be require()d.
  const awaits = new Set<number>();
  for (let i = 1; i < n; i++) if (chance(0.08)) awaits.add(i);
  const reachesAwait = new Set<number>(awaits);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (!reachesAwait.has(i) && staticImports[i].some(j => reachesAwait.has(j))) {
        reachesAwait.add(i);
        changed = true;
      }
    }
  }
  const requirable = [...Array(n).keys()].filter(i => i !== 0 && !reachesAwait.has(i));
  const pure = new Set<number>();
  for (let i = 1; i < n; i++) if (!awaits.has(i) && chance(0.25)) pure.add(i);

  // `load<i>_<j>()` in module i does require(module j)
  const loaders: { file: number; target: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (requirable.length && chance(0.45)) {
      const target = requirable[int(requirable.length)];
      if (target !== i) loaders.push({ file: i, target });
    }
  }

  // several call sites for one target
  for (const { target } of [...loaders]) {
    if (chance(0.3)) {
      const file = int(n);
      if (file !== target && !loaders.some(l => l.file === file && l.target === target)) loaders.push({ file, target });
    }
  }

  // Draws for shapes added after seeds were pinned come from a stream of their own, so old seeds keep their graphs.
  const later = rng(seed ^ 0x5bd1e995);
  // Shapes that only the unsplit check draws, from a third stream.
  const wrapped = rng(seed ^ 0x1b873593);

  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    let src = `import { note, read, attempt, later } from "./log.ts";\n`;
    const [polyfillDraw, starDraw, starTarget] = [wrapped(), wrapped(), wrapped()];
    // A CommonJS file that has to run before the import after it (a polyfill and the package that needs it).
    if (unsplit && polyfillDraw < 0.15 && !pure.has(i)) {
      src += `import "./p${i}.cjs";\nimport "./q${i}.ts";\n`;
      files[`p${i}.cjs`] = `globalThis.p${i} = "set";\nmodule.exports = {};\n`;
      files[`q${i}.ts`] = `import { read } from "./log.ts";\nread("q${i}<p${i}", () => (globalThis as any).p${i});\n`;
    }
    const importsItself = later() < 0.1 && !pure.has(i);
    if (importsItself) src += `import * as self${i} from "./f${i}.ts";\n`;
    const uses: string[] = [];
    let base: number | undefined;
    for (const j of staticImports[i]) {
      const names = [`get${j}`, `C${j}`];
      for (const l of loaders) if (l.file === j) names.push(`load${l.file}_${l.target}`);
      src += `import { ${names.join(", ")} } from "./f${j}.ts";\n`;
      if (base === undefined && chance(0.4)) base = j;
    }
    if (staticImports[i].length && chance(0.2)) {
      const j = staticImports[i][int(staticImports[i].length)];
      src += chance(0.5)
        ? `export { get${j} as via${i}_get${j} } from "./f${j}.ts";\n`
        : `export * as ns${i}_${j} from "./f${j}.ts";\n`;
    }
    // `export *` of a file that no import statement of this file names. A file that can be require()d stays one.
    const star = 1 + Math.floor(starTarget * (n - 1));
    if (
      unsplit &&
      starDraw < 0.25 &&
      star !== i &&
      !staticImports[i].includes(star) &&
      (reachesAwait.has(i) || !reachesAwait.has(star))
    ) {
      src += `export * from "./f${star}.ts";\n`;
    }
    const isPure = pure.has(i);
    if (!isPure) src += `note("f${i}");\n`;
    if (awaits.has(i)) src += `await null;\n`;
    src += `export const val${i} = "v${i}";\n`;
    src += `export function get${i}() { return val${i}; }\n`;
    src +=
      base === undefined || isPure
        ? `export class C${i} { tag() { return "c${i}"; } }\n`
        : `export const C${i} = attempt("f${i}:class", () => class extends C${base} { tag() { return "c${i}<" + super.tag(); } });\n`;
    for (const l of loaders) {
      if (l.file === i)
        src += `export function load${i}_${l.target}() { return require("./f${l.target}.ts").get${l.target}(); }\n`;
    }
    if (!isPure) {
      // An import nothing uses is dropped from a .ts file.
      if (importsItself) uses.push(`read("f${i}<self", () => typeof self${i}.get${i})`);
      for (const j of staticImports[i]) {
        if (chance(0.5)) uses.push(`read("f${i}<f${j}", () => get${j}())`);
        if (chance(0.2)) uses.push(`read("f${i}<C${j}", () => new C${j}().tag())`);
        for (const l of loaders) {
          if (l.file === j && chance(0.5))
            uses.push(`read("f${i}<load${l.file}_${l.target}", () => load${l.file}_${l.target}())`);
        }
      }
      for (const l of loaders) {
        if (l.file === i && chance(0.35)) uses.push(`read("f${i}<load${i}_${l.target}", () => load${i}_${l.target}())`);
      }
      if (requirable.length && chance(0.25)) {
        const t = requirable[int(requirable.length)];
        if (t !== i) uses.push(`read("f${i}<require${t}", () => require("./f${t}.ts").get${t}())`);
      }
      for (const use of uses) src += use + ";\n";
      if (chance(0.2)) {
        const t = 1 + int(n - 1);
        if (t !== i)
          src += `later(() => import("./f${t}.ts").then(m => read("f${i}~import${t}", () => m.get${t}())));\n`;
      }
      src += `note("f${i}:done");\n`;
    }
    files[`f${i}.ts`] = src;
  }
  files["log.ts"] = `
const lines: string[] = [];
const thunks: (() => Promise<unknown>)[] = [];
export function note(what: string) { lines.push(what); }
export function read(what: string, get: () => unknown) {
  let value: unknown;
  try { value = get(); } catch { value = undefined; }
  lines.push(what + "=" + (value === undefined ? "!" : String(value)));
  return value;
}
export function attempt<T>(what: string, make: () => T): T | undefined {
  try { return make(); } catch { lines.push(what + "=!"); return undefined; }
}
export function later(thunk: () => Promise<unknown>) { thunks.push(thunk); }
export async function finish() {
  for (let i = 0; i < thunks.length; i++) { note("later" + i); await thunks[i](); }
  console.log(lines.join("\\n"));
}
`;
  const entries = ["entry.ts"];
  files["entry.ts"] = `import { finish } from "./log.ts";\nawait import("./f0.ts");\nawait finish();\n`;
  if (twoEntries) {
    const other = 1 + int(n - 1);
    files["entry2.ts"] = `import { finish } from "./log.ts";\nawait import("./f${other}.ts");\nawait finish();\n`;
    entries.push("entry2.ts");
  }
  // An entry that imports the graph with import statements has no wrapper. The files that an import() reaches have one.
  const [entryDraw, secondDraw] = [wrapped(), wrapped()];
  if (unsplit && entryDraw < 0.4) {
    const second = entryDraw < 0.2 ? `import "./f${1 + Math.floor(secondDraw * (n - 1))}.ts";\n` : "";
    files["entry.ts"] = `import { finish } from "./log.ts";\nimport "./f0.ts";\n${second}await finish();\n`;
  }
  return { files, entries };
}

type Env = Record<string, string | undefined>;

// Evaluation order is what is compared; the async transpiler makes it vary from run to run.
export const env: Env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

// A program whose top-level await never settles does not exit (#45262), so every child has a deadline.
const deadline = 60_000;
const killed = 128 + 9;

export async function run(cmd: string[], cwd: string, env: Env) {
  await using proc = spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", env, timeout: deadline, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const failure = (result: { stderr: string; exitCode: number }) =>
  result.exitCode === killed
    ? `was killed (the deadline is ${deadline / 1000} s)`
    : "failed: " + result.stderr.slice(0, 400);

/** The values a log says were read, and its top-level effects in order. */
function facts(log: string) {
  const reads = new Map<string, string>();
  const effects: string[] = [];
  for (const line of log.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) effects.push(line);
    else reads.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return { reads, effects };
}

function worse(
  reference: string,
  unfolded: string,
  folded: string,
  [before, after] = ["unfolded", "folded"],
): string[] {
  const [ref, off, on] = [facts(reference), facts(unfolded), facts(folded)];
  const problems: string[] = [];
  // A line like "f3:class=!" is only written when something failed, so a key one log lacks counts as "fine" there.
  for (const what of new Set([...ref.reads.keys(), ...off.reads.keys(), ...on.reads.keys()])) {
    const [value, offValue, onValue] = [ref, off, on].map(log => log.reads.get(what) ?? "fine");
    if (offValue === value && onValue !== value) {
      problems.push(`${what}: ${value} unbundled and ${before}, ${on.reads.get(what) ?? "missing"} ${after}`);
    }
  }
  const position = (effects: string[]) => new Map(effects.map((effect, index) => [effect, index]));
  const [offAt, onAt] = [position(off.effects), position(on.effects)];
  for (let a = 0; a < ref.effects.length; a++) {
    for (let b = a + 1; b < ref.effects.length; b++) {
      const [x, y] = [ref.effects[a], ref.effects[b]];
      const agrees = (at: Map<string, number>) => at.has(x) && at.has(y) && at.get(x)! < at.get(y)!;
      if (agrees(offAt) && !agrees(onAt)) problems.push(`order of ${x} and ${y} kept ${before}, lost ${after}`);
    }
  }
  return problems;
}

/**
 * "skipped": the graph could not be judged (`problems` says why). "worse": folding lost something.
 * `folded`: folding changed the bundle at all. When it did not there is nothing to compare, and the bundles are not run.
 */
export type GraphResult = { seed: number; status: "ok" | "skipped" | "worse"; folded: boolean; problems: string[] };

function sameFiles(a: string, b: string) {
  const [inA, inB] = [readdirSync(a).sort(), readdirSync(b).sort()];
  return (
    inA.length === inB.length &&
    inA.every((name, i) => name === inB[i] && readFileSync(join(a, name)).equals(readFileSync(join(b, name))))
  );
}

export async function checkGraph(bun: string, seed: number): Promise<GraphResult> {
  const graph = generateGraph(seed);
  using dir = tempDir("splitting-fuzz", {
    ...graph.files,
    "build.ts": `
      for (const [outdir, fold] of [["off", false], ["on", true]]) {
        const result = await Bun.build({
          entrypoints: ${JSON.stringify(graph.entries)}.map(entry => import.meta.dir + "/" + entry),
          outdir: import.meta.dir + "/" + outdir,
          splitting: true,
          target: "bun",
          format: "esm",
          foldChunksForTesting: fold,
        });
        if (!result.success) throw new Error(outdir + ": " + result.logs.join("\\n"));
      }
    `,
  });
  const cwd = String(dir);
  const build = await run([bun, "build.ts"], cwd, env);
  if (build.exitCode !== 0) {
    return { seed, status: "skipped", folded: false, problems: ["the build failed: " + build.stderr.slice(0, 400)] };
  }
  if (sameFiles(join(cwd, "off"), join(cwd, "on"))) return { seed, status: "ok", folded: false, problems: [] };

  const skipped: string[] = [];
  const problems: string[] = [];
  await Promise.all(
    graph.entries.map(async entry => {
      const js = entry.replace(/\.ts$/, ".js");
      const [reference, unfolded, folded] = await Promise.all([
        run([bun, entry], cwd, env),
        run([bun, join("off", js)], cwd, env),
        run([bun, join("on", js)], cwd, env),
      ]);
      if (reference.exitCode !== 0) skipped.push(`${entry}: the unbundled run ${failure(reference)}`);
      else if (unfolded.exitCode !== 0) skipped.push(`${entry}: the unfolded bundle ${failure(unfolded)}`);
      else if (folded.exitCode !== 0) problems.push(`${entry}: only the folded bundle ${failure(folded)}`);
      else problems.push(...worse(reference.stdout, unfolded.stdout, folded.stdout).map(p => `${entry}: ${p}`));
    }),
  );
  const status = problems.length ? "worse" : skipped.length ? "skipped" : "ok";
  return { seed, status, folded: true, problems: problems.length ? problems : skipped };
}

/**
 * "different": the bundle lost a value or an order that the unbundled program has, or only the bundle failed.
 * "worse": the same, and the bundle that the `baseline` binary builds has that value or order.
 * `unjudged`: the entries with no verdict. The unbundled run failed there, or the baseline's bundle did.
 */
export type UnsplitResult = {
  seed: number;
  status: "ok" | "skipped" | "different" | "worse";
  problems: string[];
  unjudged: string[];
};

function differences(reference: string, bundled: string): string[] {
  const [ref, out] = [facts(reference), facts(bundled)];
  const problems: string[] = [];
  for (const what of new Set([...ref.reads.keys(), ...out.reads.keys()])) {
    const [value, outValue] = [ref, out].map(log => log.reads.get(what) ?? "fine");
    if (outValue !== value) problems.push(`${what}: ${value} unbundled, ${out.reads.get(what) ?? "missing"} bundled`);
  }
  const at = new Map(out.effects.map((effect, index) => [effect, index]));
  for (let a = 0; a < ref.effects.length; a++) {
    for (let b = a + 1; b < ref.effects.length; b++) {
      const [x, y] = [ref.effects[a], ref.effects[b]];
      if (!(at.has(x) && at.has(y) && at.get(x)! < at.get(y)!)) problems.push(`order of ${x} and ${y} lost`);
    }
  }
  return problems;
}

export async function checkUnsplit(bun: string, seed: number, baseline?: string): Promise<UnsplitResult> {
  const graph = generateGraph(seed, true);
  using dir = tempDir("unsplit-fuzz", {
    ...graph.files,
    "build.ts": `
      const result = await Bun.build({
        entrypoints: ${JSON.stringify(graph.entries)}.map(entry => import.meta.dir + "/" + entry),
        outdir: import.meta.dir + "/" + process.argv[2],
        target: "bun",
        format: "esm",
      });
      if (!result.success) throw new Error(result.logs.join("\\n"));
    `,
  });
  const cwd = String(dir);
  const builds = await Promise.all([
    run([bun, "build.ts", "out"], cwd, env),
    ...(baseline ? [run([baseline, "build.ts", "base"], cwd, env)] : []),
  ]);
  const unbuilt = builds.find(build => build.exitCode !== 0);
  if (unbuilt) return { seed, status: "skipped", problems: [], unjudged: [`the build ${failure(unbuilt)}`] };

  const problems: string[] = [];
  const unjudged: string[] = [];
  await Promise.all(
    graph.entries.map(async entry => {
      const js = entry.replace(/\.ts$/, ".js");
      const [reference, bundled, before] = await Promise.all([
        run([bun, entry], cwd, env),
        run([bun, join("out", js)], cwd, env),
        baseline ? run([bun, join("base", js)], cwd, env) : undefined,
      ]);
      if (reference.exitCode !== 0) unjudged.push(`${entry}: the unbundled run ${failure(reference)}`);
      else if (before && before.exitCode !== 0) unjudged.push(`${entry}: the baseline's bundle ${failure(before)}`);
      else if (bundled.exitCode !== 0) problems.push(`${entry}: only the bundle ${failure(bundled)}`);
      else if (before) {
        const lost = worse(reference.stdout, before.stdout, bundled.stdout, ["with the baseline", "with this build"]);
        problems.push(...lost.map(problem => `${entry}: ${problem}`));
      } else problems.push(...differences(reference.stdout, bundled.stdout).map(problem => `${entry}: ${problem}`));
    }),
  );
  const judged = unjudged.length < graph.entries.length;
  const status = problems.length ? (baseline ? "worse" : "different") : judged ? "ok" : "skipped";
  return { seed, status, problems, unjudged };
}
