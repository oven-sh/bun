import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { dirname, join } from "node:path";

// `bun check` follows TypeScript 7, which is a native program next to its `lib.*.d.ts`: `typescript7` in
// test/package.json, beside the `typescript` that has the API in JavaScript. `TSC` is the path of another to compare with.
function nativeTypeScript() {
  if (process.env.TSC) return process.env.TSC;
  try {
    const paths = [dirname(require.resolve("typescript7/package.json"))];
    const name = `@typescript/typescript-${process.platform}-${process.arch}`;
    return join(dirname(require.resolve(`${name}/package.json`, { paths })), "lib", isWindows ? "tsc.exe" : "tsc");
  } catch {
    // There is none for this system.
  }
}
export const tsc = nativeTypeScript();

export const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

/** What `cmd` prints, sorted, without the path of `root`. */
export async function linesOf(cmd: string[], cwd: string, root: string) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  const prefix = new RegExp(root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => line.replace(prefix, ""));
}

/** `run` for each of `items`, a few at a time. */
export async function inTurns<T>(items: T[], run: (item: T) => Promise<void>) {
  for (let at = 0; at < items.length; at += 6) await Promise.all(items.slice(at, at + 6).map(run));
}

/** `deep`: nested too deeply for the stack of a build that is not optimised. */
type Case = { files: Record<string, string>; build?: true; deep?: true };

/**
 * Small programs about which `bun check` and tsc once said something else, each named after where it was found.
 * A program takes two processes, and a test file has three minutes: each file tests one part of `parts`.
 */
export function programsThatOnceDiffered(part: number, parts: number) {
  const tests = 4;
  for (let nth = 0; nth < tests; nth++) {
    test.skipIf(!tsc)(
      `programs about which the two once differed, ${part * tests + nth + 1} of ${parts * tests}`,
      async () => {
        const all: Record<string, Case> = await Bun.file(join(import.meta.dir, "differential-cases.json")).json();
        const cases = Object.entries(all)
          .filter(([, it]) => !(it.deep && (isDebug || isASAN)))
          // A debug build checks a sample. It is always the same sample.
          .filter((_, index) => index % (isDebug || isASAN ? 40 : 1) === 0)
          .filter((_, index) => index % (parts * tests) === part * tests + nth)
          // Windows cannot create a directory named `c:`.
          .filter(([, it]) => !isWindows || !Object.keys(it.files).some(path => path.includes(":")));
        const files: Record<string, string> = {};
        for (const [name, it] of cases) for (const path in it.files) files[`${name}/${path}`] = it.files[path];
        using dir = tempDir("bun-check-differential", files);
        const root = String(dir);
        const different: Record<string, object> = {};
        await inTurns(cases, async ([name, it]) => {
          const cwd = join(root, name);
          // In this order: `tsc -b` writes files.
          const build = it.build ? ["-b"] : [];
          const ours = await linesOf([bunExe(), "check", ...build], cwd, root);
          const theirs = await linesOf([tsc!, ...build, "--pretty", "false", "--singleThreaded"], cwd, root);
          if (!Bun.deepEquals(theirs, ours)) different[name] = { theirs, ours };
        });
        expect(different).toEqual({});
      },
    );
  }
}
