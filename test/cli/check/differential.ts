import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { longLimit, spawn } from "../children";

// Most cases use TypeScript 7.0.2: `typescript7` in test/package.json, beside the JavaScript API in `typescript`.
// `TSC` overrides that baseline. Cases covering selected backports name their pinned oracle separately.
function nativeTypeScript(packageName = "typescript7", expectedVersion?: string) {
  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    const paths = [dirname(packagePath)];
    const name = `@typescript/typescript-${process.platform}-${process.arch}`;
    if (expectedVersion) {
      const { version, optionalDependencies } = JSON.parse(readFileSync(packagePath, "utf8"));
      if (version !== expectedVersion) throw new Error(`Expected ${packageName} ${expectedVersion}, got ${version}`);
      // The older nightly did not publish every platform supported by the baseline.
      if (!Object.hasOwn(optionalDependencies ?? {}, name)) return;
    }
    const nativePackagePath = require.resolve(`${name}/package.json`, { paths });
    if (expectedVersion) {
      const { version } = JSON.parse(readFileSync(nativePackagePath, "utf8"));
      if (version !== expectedVersion) throw new Error(`Expected ${packageName} ${expectedVersion}, got ${version}`);
    }
    const executable = join(dirname(nativePackagePath), "lib", isWindows ? "tsc.exe" : "tsc");
    if (expectedVersion && !statSync(executable).isFile())
      throw new Error(`Not a TypeScript executable: ${executable}`);
    return executable;
  } catch (error) {
    if (expectedVersion && (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error;
    // An optional compiler package may not be installed, including with `--omit=optional`.
  }
}
export const tsc = process.env.TSC || nativeTypeScript();
// The mapped-type identity backport follows microsoft/typescript-go#4913, after the 7.0.2 baseline.
export const post4913Tsc = nativeTypeScript("typescript7-post4913", "7.1.0-dev.20260922.1");

export const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

/** What `cmd` prints, without the path of `root`. And how it ended, if it crashed: that prints nothing. */
export async function linesOf(cmd: string[], cwd: string, root: string) {
  await using proc = spawn({ timeout: longLimit, cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  // A crash of bun is a signal, and the exit code 3 on Windows. tsc exits with 4 if project references form a cycle.
  const hasCrashed = proc.signalCode !== null || exitCode > (cmd[0] === bunExe() ? 2 : 5);
  const prefix = new RegExp(root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => line.replace(prefix, ""))
    .concat(hasCrashed ? [`exit code ${exitCode}, signal ${proc.signalCode}`] : []);
}

/**
 * Whichever file is checked first enters each cycle: the variances of type parameters, recursive aliases, and functions
 * and constants without annotations, each through a ring of `n` modules. What tsc reports depends on `--checkers`.
 */
export function modulesInRings(n: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const [a, b, d] = [(i + 1) % n, (i + 7) % n, (i * 3 + 2) % n];
    files[`m${i}.ts`] = [
      ...[...new Set([a, b, d])]
        .filter(j => j !== i)
        .map(j => `import { f${j}, g${j}, C${j}, v${j}, type T${j}, type R${j} } from "./m${j}";`),
      `export interface T${i}<A> { a: A; next: T${a}<A[]> | null; take(x: T${b}<A>): void; give(): T${d}<A> }`,
      `export type R${i}<X, N extends unknown[] = []> = N["length"] extends 6 ? X : R${a}<{ m${i}: X }, [...N, 1]>;`,
      `export function f${i}(x: number) { return x > 0 ? { k: "m${i}" as const, inner: f${a}(x - 1) } : null; }`,
      `export function g${i}(x: number) { return ${i === 0 ? "x" : `{ k: ${i}, inner: g${Math.floor(i / 2)}(x) }`}; }`,
      `export class C${i}<A> { constructor(public v: A) {} map<B>(h: (a: A) => B): C${b}<B> { return new C${b}(h(this.v)); } }`,
      `export const v${i} = new C${a}(${i}).map(x => [x, v${d}] as const);`,
      // `never` puts the types in the messages.
      `const r${i}: never = f${d}(1);`,
      `const s${i}: never = g${b}(1);`,
      `const t${i}: T${a}<string> = null! as T${a}<unknown>;`,
      `const u${i}: T${b}<unknown> = null! as T${b}<string>;`,
      `const w${i}: never = null! as R${d}<${i}>;`,
      `const y${i}: never = v${b};`,
      `r${i}; s${i}; t${i}; u${i}; w${i}; y${i};\n`,
    ].join("\n");
  }
  return files;
}

/** `run` for each of `items`, a few at a time. */
export async function inTurns<T>(items: T[], run: (item: T) => Promise<void>) {
  for (let at = 0; at < items.length; at += 6) await Promise.all(items.slice(at, at + 6).map(run));
}

/** `deep`: nested too deeply for the stack of a build that is not optimised, or too slow in one. */
type Case = { files: Record<string, string>; build?: true; deep?: true; oracle?: "post4913" };

/**
 * Small programs about which `bun check` and tsc once said something else, each named after where it was found.
 * A program takes two processes, and a test file has three minutes: each file tests one part of `parts`.
 */
export function programsThatOnceDiffered(part: number, parts: number) {
  const tests = 4;
  const all: Record<string, Case> = JSON.parse(readFileSync(join(import.meta.dir, "differential-cases.json"), "utf8"));
  for (let nth = 0; nth < tests; nth++) {
    const selected = Object.entries(all)
      .filter(([, it]) => !(it.deep && (isDebug || isASAN)))
      // A debug build checks a sample. It is always the same sample.
      .filter((_, index) => index % (isDebug || isASAN ? 40 : 1) === 0)
      .filter((_, index) => index % (parts * tests) === part * tests + nth)
      // Windows cannot create a directory named `c:` or `w*d`.
      .filter(([, it]) => !isWindows || !Object.keys(it.files).some(path => /[:*?"<>|]/.test(path)));
    // Report omitted backport coverage while still running the baseline cases in this partition.
    for (const [name, it] of selected) {
      if (it.oracle === "post4913" && !post4913Tsc) {
        test.skip(`${name}: pinned TypeScript oracle is not installed for this platform`, () => {});
      }
    }
    test.skipIf(!tsc)(
      `programs about which the two once differed, ${part * tests + nth + 1} of ${parts * tests}`,
      async () => {
        using dir = tempDir("bun-check-differential", {});
        const root = String(dir);
        const cases = selected
          // Only the selected backport cases need a nightly published for this platform.
          .filter(([, it]) => it.oracle !== "post4913" || post4913Tsc !== undefined)
          .filter(([name, it]) => {
            try {
              for (const path in it.files) {
                mkdirSync(dirname(join(root, name, path)), { recursive: true });
                writeFileSync(join(root, name, path), it.files[path]);
              }
              return true;
            } catch (error) {
              // APFS refuses a character that is newer than the Unicode tables of the system.
              if ((error as NodeJS.ErrnoException).code === "EILSEQ") return false;
              throw error;
            }
          });
        const different: Record<string, object> = {};
        await inTurns(cases, async ([name, it]) => {
          const cwd = join(root, name);
          const build = it.build ? ["-b"] : [];
          // One thread divides the files in another way.
          const [ours, onOneThread] = await Promise.all([
            linesOf([bunExe(), "check", ...build], cwd, root),
            linesOf([bunExe(), "check", ...build, "--threads=1"], cwd, root),
          ]);
          // After them: `tsc -b` writes files.
          const oracle = it.oracle === "post4913" ? post4913Tsc : tsc;
          expect(oracle, `TypeScript oracle for ${name}`).toBeDefined();
          const theirs = await linesOf([oracle!, ...build, "--pretty", "false", "--singleThreaded"], cwd, root);
          if (!Bun.deepEquals(theirs, ours)) different[name] = { theirs, ours };
          else if (!Bun.deepEquals(theirs, onOneThread)) different[name] = { theirs, onOneThread };
        });
        expect(different).toEqual({});
      },
    );
  }
}
