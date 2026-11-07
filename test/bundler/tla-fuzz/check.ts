// One random module graph: what the bundle that `bun build` makes of it logs, against what the reference model of
// ECMA-262 (spec-model.mjs) logs for the same graph. fuzz.mjs runs many graphs, engines and bundlers.
import { spawn } from "bun";
import { bunEnv, tempDir } from "harness";
import { join } from "node:path";
import { emitESM, generate } from "./gen.mjs";
import { emitSpecEmu } from "./spec-model.mjs";

const runner = join(import.meta.dir, "runner.mjs");

async function run(cmd: string[], env: Record<string, string | undefined>) {
  await using proc = spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/**
 * The log has a line for every step of every module, for every promise job ("|") and for every tick of the clock that
 * the modules sleep on ("@"). How many promise jobs `import()` takes is up to the host, so the graphs of the profile
 * "dyn" only sleep, and their logs have no "|". The lines in "<>" say when the importer of the whole program saw it
 * settle, which no bundle can reproduce to the promise job.
 */
async function trace(bun: string, entry: string, profile: string) {
  const env = { ...bunEnv, NO_TICKER: profile.endsWith("dyn") ? "1" : undefined };
  const { stdout, stderr } = await run([bun, runner, entry], env);
  const line = stdout.trim().split("\n").pop();
  if (!line?.startsWith("{")) throw new Error(`${entry} printed no log: ${stderr.slice(0, 1000)}`);
  const { trace, result } = JSON.parse(line) as { trace: string[]; result: string };
  return [...trace.filter(step => step[0] !== "<"), result];
}

export async function checkGraph(bun: string, profile: string, seed: number) {
  const graph = generate(seed, profile);
  using dir = tempDir(`tla-fuzz-${profile}-${seed}`, { ...emitESM(graph), "model.mjs": emitSpecEmu(graph) });
  const cwd = String(dir);
  const build = await run(
    [bun, "build", join(cwd, "m0.mjs"), "--outfile", join(cwd, "bundle.mjs"), "--target=bun", "--format=esm"],
    bunEnv,
  );
  if (build.exitCode !== 0) throw new Error("the build failed: " + build.stderr.slice(0, 1000));
  const [bundle, model] = await Promise.all([
    trace(bun, join(cwd, "bundle.mjs"), profile),
    trace(bun, join(cwd, "model.mjs"), profile),
  ]);
  return { bundle, model };
}
