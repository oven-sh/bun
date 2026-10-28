// Each program of ./cases.ts is run by `bun run`, as the executable of `bun build --compile`, and as the executable of
// `bun build --compile --aot`. The three do not always agree, and where they do not, ./verdicts.json says whom --aot sides with:
//
//   "all agree"
//   "as bun run"     the bundle departs from `bun run`, and --aot does not
//   "as the bundle"  --aot departs from `bun run` the way the bundle does
//   "alone: .."      --aot departs from both, and what it does
//
// A verdict that changes fails the test, for better or for worse. AOT_PROGRAMS_UPDATE=1 rewrites the file.
// The programs are dealt out to the files ../modules-three-ways-<part>.test.ts by their place in ./cases.ts, so that no file takes long.
// Of a run that fails only the exit code and the kind of error count, and of a build that fails only that it does: the wording is not what is tested.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { slot, spawned, unsupported, wanted } from "../run-programs";
import { cases } from "./cases";

const recorded = join(import.meta.dir, "verdicts.json");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

const outcome = (run: { stdout: string; stderr: string; exitCode: number; signal: unknown }, folder: string) =>
  run.signal
    ? `signal ${run.signal}`
    : run.stdout.replaceAll(folder, "").trimEnd() + (run.exitCode ? `\nexit code ${run.exitCode}: ${/^(?:error: )?([A-Za-z]*Error|error)\b/m.exec(run.stderr)?.[1] ?? ""}` : "");

/** Writes the files of a program, whose entry point is the file named main, runs it the three ways and says whom --aot sides with. */
export async function judged(folder: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), text);
  }
  const main = Object.keys(files).find(file => /^main\.[a-z]+$/.test(file))!;
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const compiled = async (flags: string[]) => {
    try {
      const build = await spawned([bunExe(), "build", "--compile", ...flags, main, "--outfile", executable], folder, bunEnv);
      return build.exitCode ? "the build fails" : outcome(await spawned([executable], folder, bunEnv), folder);
    } finally {
      rmSync(executable, { force: true });
    }
  };
  const plain = outcome(await spawned([bunExe(), "run", main], folder, bunEnv), folder);
  const bundle = await compiled([]);
  const aot = await compiled(["--aot"]);
  const verdict = aot === plain ? (bundle === plain ? "all agree" : "as bun run") : aot === bundle ? "as the bundle" : "alone: " + aot;
  return { verdict, plain, bundle, aot };
}

export function threeWays(part: number, parts: number) {
  const verdicts: Record<string, string> = JSON.parse(readFileSync(recorded, "utf8"));
  const found: Record<string, string> = {};
  const root = String(tempDir("aot-three-ways", {}));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    if (!updates) return;
    const departing = Object.entries({ ...JSON.parse(readFileSync(recorded, "utf8")), ...found }).filter(([, verdict]) => verdict !== "all agree");
    writeFileSync(recorded, JSON.stringify(Object.fromEntries(departing.sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) + "\n");
  });
  describe.concurrent("compile/aot/modules three ways", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    const mine = Object.entries(cases).filter((_, index) => index % parts === part - 1);
    for (const [index, [name, files]] of mine.entries()) {
      if (wanted === "quick" ? index % 10 : !name.includes(wanted)) continue;
      test(
        name,
        () =>
          slot(async () => {
            const { verdict, plain, bundle } = await judged(join(root, name), files);
            if (updates) found[name] = verdict;
            expect({ verdict, plain, bundle }).toEqual({ verdict: updates ? verdict : (verdicts[name] ?? "all agree"), plain, bundle });
          }),
        600_000,
      );
    }
  });
}
