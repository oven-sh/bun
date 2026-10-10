// Live differential fuzzing of the RegExp engine against node/V8.
//
// Generates fresh random regular expressions + inputs on every run (the seed
// is printed on failure so the exact case is reproducible), executes every
// observable operation on each (exec/test with global & sticky iteration and
// lastIndex tracking, match/matchAll/search/split/replace with $-patterns and
// functions, RegExp construction and SyntaxError parity), and requires
// byte-identical results between bun and node.
//
// Requires a `node` binary on PATH to act as the oracle; without one the same
// corpus still runs under bun as a stability/self-consistency check. Set
// REGEX_DIFF_COUNT to raise the case count (default keeps CI fast; use e.g.
// REGEX_DIFF_COUNT=20000 for a deep local soak). Reproduce a failure with:
//
//   node differential/run.mjs --seed <S> --index <I>
//   bun  differential/run.mjs --seed <S> --index <I> --capabilities '<hdr>'
//
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { classifyDivergence } from "./differential/known-signatures.mjs";

const dir = join(import.meta.dir, "differential");
const runner = join(dir, "run.mjs");
const nodeBin = Bun.which("node");
const count = Number(process.env.REGEX_DIFF_COUNT ?? 300);
// Fresh seed per run: broad coverage over time; printed on failure.
const seed = Number(process.env.REGEX_DIFF_SEED ?? Math.floor(Math.random() * 1_000_000_000) + 1);

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test(`regex differential vs node (${count} cases, seed ${seed})`, async () => {
  if (!nodeBin) {
    // No oracle available: still exercise the whole corpus under bun so the
    // suite never silently degrades to nothing.
    const bunRun = await run([bunExe(), runner, "--seed", String(seed), "--count", String(count)]);
    expect(bunRun.stderr).toBe("");
    expect(bunRun.stdout.trim().split("\n").length).toBe(count + 1);
    expect(bunRun.exitCode).toBe(0);
    return;
  }

  // Results go through files, not stdout: the streams are large.
  using tmp = tempDir("regex-diff", {});
  const oracleFile = join(String(tmp), "oracle.jsonl");
  const underFile = join(String(tmp), "under.jsonl");

  const oracle = await run([nodeBin, runner, "--seed", String(seed), "--count", String(count), "--out", oracleFile]);
  expect(oracle.exitCode).toBe(0);
  const oracleLines = (await Bun.file(oracleFile).text()).trim().split("\n");
  const header = oracleLines[0]; // pins the capability set the cases were generated for

  const under = await run([
    bunExe(),
    runner,
    "--seed",
    String(seed),
    "--count",
    String(count),
    "--capabilities",
    header,
    "--out",
    underFile,
  ]);
  expect(under.exitCode).toBe(0);
  const underLines = (await Bun.file(underFile).text()).trim().split("\n");

  // Compare case-by-case. Divergences matching a KNOWN live engine bug
  // (differential/known-signatures.mjs) are logged, not failed -- only a NEW
  // class of divergence fails, with a precise reproducer.
  expect(underLines.length).toBe(oracleLines.length);
  const failures: string[] = [];
  const knownHits: string[] = [];
  for (let i = 0; i < oracleLines.length; i++) {
    if (oracleLines[i] === underLines[i]) continue;
    let index: string | number = "?";
    let source = "?";
    let flags = "";
    try {
      const parsed = JSON.parse(oracleLines[i]);
      index = parsed.index;
      source = parsed.record?.source ?? "?";
      flags = parsed.record?.flags ?? "";
    } catch {}
    const known = classifyDivergence({ source, flags, oracle: oracleLines[i], under: underLines[i] });
    if (known) {
      knownHits.push(`case ${index}: ${known} /${source}/${flags}`);
      continue;
    }
    failures.push(
      `regex differential mismatch at case ${index} (seed ${seed}): /${source}/${flags}\n` +
        `  reproduce: node differential/run.mjs --seed ${seed} --index ${index}\n` +
        `             bun  differential/run.mjs --seed ${seed} --index ${index} --capabilities '${header}'\n` +
        `  node: ${oracleLines[i].slice(0, 600)}\n` +
        `  bun : ${underLines[i].slice(0, 600)}`,
    );
  }
  if (knownHits.length) console.warn(`known engine divergences hit (not failures):\n  ${knownHits.join("\n  ")}`);
  expect(failures).toEqual([]);
}, 300_000);
