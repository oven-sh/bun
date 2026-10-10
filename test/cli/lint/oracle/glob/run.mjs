// The modes of `src/glob` for the patterns of other tools, against those tools.
//
//   GLOB_JUDGES=.. GLOB_JUDGES_PRETTIER=.. BUN_LINT=<bun-lint> node run.mjs <oracle> [seed] [count] [--all]
//
// An oracle is a file here: `cases(seed, count)` yields `{ it, want }`, a case of `bun-lint glob` and what the judge says to it
// (`undefined`: it throws, and the case is left out). `explain(it, want, got)` names the reason for a difference that is known.
//
// | Oracle | What | Judge |
// |---|---|---|
// | B1, B2 | `braces::expand`. B2: what bounds its work leaves every list as it is | brace-expansion |
// | M1, M1n, M2, M3 | `MINIMATCH_DOT`, `MINIMATCH`, `flipNegate`, `partial` | minimatch |
// | M4 | `.editorconfig` | `buildFullGlob` and minimatch |
// | M5 | POSIX classes beyond ASCII | minimatch |
// | M6 | a `#` at the start, as it is and escaped | minimatch, with and without `nocomment` |
// | M7 | `MINIMATCH_3_MAKE_RE`, and with `dot` | `makeRe(pattern).test(path)` of minimatch 3.1.5 |
// | M8 | `MINIMATCH_3`, `MINIMATCH_3_DOT`; `matches_base` of these and of `MINIMATCH` | `minimatch()` of 3.1.5, with and without `matchBase`; of 10.2.6 with it |
// | N1 | text that is not UTF-8, in all modes that follow a package of JavaScript | the packages, on `Buffer.toString()` of the bytes |
// | P1, P1m | `MICROMATCH_DOT`, and without `dot` | micromatch |
// | P2, P3 | `FAST_GLOB_DOT`, and `partial` of it | fast-glob |
// | I1, I2, I3, Im | `Npm5`, `Npm705`, `Npm7012` | `ignore` 5.3.2, 7.0.5, 7.0.12 |
// | S1 | `is_glob`, `glob_parent` | is-glob, glob-parent |
// | H1 | `heads`: a path that matches starts with one of them | minimatch, and `Bun.Glob` if it is run with Bun |
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const bunLint = resolve(process.env.BUN_LINT ?? "bun-lint");
const args = process.argv.slice(2),
  flags = new Set(args.filter(it => it.startsWith("--")));
const [name, seed = "1", count = "0"] = args.filter(it => !it.startsWith("--"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Runs `bun-lint glob` on `cases` and returns what it prints, parsed. */
function runBunLint(cases) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-oracle-"));
  try {
    const file = join(dir, "cases.json");
    writeFileSync(file, JSON.stringify(cases));
    return JSON.parse(execFileSync(bunLint, ["glob", file], { maxBuffer: 1 << 30 }).toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const oracle = await import(`./${name}.mjs`);
const cases = [],
  wanted = [];
let thrown = 0;
for (const { it, want } of oracle.cases(+seed, +count)) {
  if (want === undefined) thrown++;
  else {
    cases.push(it);
    wanted.push(want);
  }
}
const answers = runBunLint(cases);
const reasons = new Map(),
  shown = [];
let differ = 0;
cases.forEach((it, i) => {
  const [want, got] = [wanted[i], answers[i]];
  if (oracle.agrees ? oracle.agrees(it, want, got) : same(want, got)) return;
  differ++;
  const why = oracle.explain?.(it, want, got) ?? null;
  reasons.set(why, (reasons.get(why) ?? 0) + 1);
  if ((why === null || flags.has("--all")) && shown.length < 25) shown.push([it, want, got]);
});
console.log(`${name} seed ${seed}: ${cases.length} cases, ${thrown} left out because the judge throws, ${differ} differ`);
for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${why ?? "NOT EXPLAINED"}`);
for (const [it, want, got] of shown) console.log("   ", JSON.stringify(it), "judge", JSON.stringify(want), "bun-lint", JSON.stringify(got));
oracle.report?.();
process.exit(reasons.has(null) ? 1 : 0);
