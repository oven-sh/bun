import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

/** The environment of a lint run: `bunEnv` and the variable that turns `--lint` on. */
export const lintEnv: NodeJS.Dict<string> = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1" };

/** Runs `bun <args>` in `cwd` and returns all it wrote to stdout and to stderr, and its exit code. */
export async function bun(cwd: string, args: string[], env: NodeJS.Dict<string> = lintEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const markerName = "marker.txt";

/** The text of a file that, when it is run, writes the marker file into the working directory. */
export const markerSource = `import { writeFileSync } from "node:fs";\nwriteFileSync("${markerName}", "ran");\n`;

/** Whether a file with the text of `markerSource` was run with `cwd` as its working directory. */
export function markerExists(cwd: string) {
  return Bun.file(join(cwd, markerName)).exists();
}
