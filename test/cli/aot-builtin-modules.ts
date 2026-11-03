import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";

// An executable has the built-in modules that are imported by a constant name, and a name made at run time finds those and no others.
export function importingByName(module: string, programs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(programs).map(([entry, text]) => [
      entry,
      (entry.endsWith(".mjs") ? `import "${module}";\n` : `require("${module}");\n`) + text,
    ]),
  );
}

/** Only a canary build of Bun reads BUN_AOT_START_AT. */
export const startsAtAnyEntryPoint = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");
if (!startsAtAnyEntryPoint)
  console.error("SKIPPED: only a canary build of Bun starts an executable at any of its entry points");

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_AOT_VERBOSE: "1" };
const imageBytes = (stderr: string) => Number(/\[aot\] image: (\d+) bytes/.exec(stderr)?.[1]);

/**
 * Compiles each entry point in `folder` as it is compiled alone, all of them into one executable, and runs each without the interpreter.
 * Answers what each printed and how many bytes its image has, which is the same number every time.
 */
export async function compileEachAlone(folder: string, entryPoints: string[]) {
  const outfile = join(folder, isWindows ? "programs.exe" : "programs");
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-separate-programs",
      "--root=.",
      ...entryPoints.map(entry => "./" + entry),
      "--outfile",
      outfile,
    ],
    folder,
  );
  expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringContaining("error"), exitCode: 0 });
  return Object.fromEntries(
    await Promise.all(
      entryPoints.map(async entry => {
        const { stdout, stderr, exitCode } = await run([outfile], folder, { ...env, BUN_AOT_START_AT: entry });
        return [entry, { stdout, exitCode, bytes: imageBytes(stderr) }] as const;
      }),
    ),
  );
}

/** The text of a program that loads `programs` one after the other. */
export const oneAfterTheOther = (programs: Record<string, string>) =>
  Object.keys(programs)
    .map(entry => `import "./${entry}";\n`)
    .join("");

/** Compiles an entry point in `folder` in place and runs it without the interpreter. */
export async function compileInPlace(folder: string, entry: string) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", "--debug-aot", entry], folder, env);
  return { stdout, exitCode, bytes: imageBytes(stderr) };
}
