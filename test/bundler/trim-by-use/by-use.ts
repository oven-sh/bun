// `bun build --compile --aot --trim` keeps the parts of Bun that a program uses and removes the rest.
//
//   programs/<name>.ts         uses one part of Bun, and prints what it did with it
//   programs/<name>.json       { "features": [..] } where the part isn't called <name> in src/trim/features, and how to build and run the program
//   near/<name>/near.ts        comes near a part and uses none of it
//
// Each program is built alone: beside another, what the other keeps would hide what this one lacks.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unsupported } from "../../aot/harness/compiler";
import { inTurn } from "../../aot/harness/shared-builds";
import { readRemovedFeatures } from "../../aot/trimmed-against-whole/removed-features";
import { canTrim, findFeature, model } from "../compile-trim-features";

export interface ProgramOptions {
  features?: string[];
  build?: string[];
  env?: Record<string, string>;
  posix?: boolean;
  /** It prints what an executable alone has, so it is held against an executable built without --trim. */
  printsAsAnExecutable?: boolean;
  /** A program that comes near a part: the part stays today. */
  keptToday?: boolean;
  /** A known bug, in a sentence. The test is red as soon as the program runs. */
  failsToday?: string;
}

const programs = join(import.meta.dir, "programs");
const neighbors = join(import.meta.dir, "near");
const tsconfig = `{ "compilerOptions": { "noImplicitAny": false, "types": ["bun"], "skipLibCheck": true } }`;

const optionsAt = (path: string): ProgramOptions => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const featuresOf = (name: string, options: ProgramOptions) =>
  (options.features ?? [name]).flatMap(spelling => findFeature(spelling) ?? []);
const programNames = readdirSync(programs)
  .filter(name => name.endsWith(".ts"))
  .map(name => basename(name, ".ts"))
  .sort();
const neighborNames = readdirSync(neighbors).sort();

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using child = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 100_000 });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode: child.signalCode ?? exitCode };
}

/** Builds `entry` with --trim, and says what the executable prints, what plain Bun prints, and which parts the executable lacks. */
async function trimmedAndPlain(folder: string, entry: string, options: ProgramOptions) {
  const env = { ...bunEnv, ...options.env };
  const cwd = join(folder, "cwd");
  async function build(outfile: string, ...flags: string[]) {
    const cmd = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...flags,
      ...(options.build ?? []),
      entry,
      "--outfile",
      outfile,
    ];
    const built = await run(cmd, folder, env);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    return [join(folder, outfile)];
  }
  const trimmed = await build("trimmed", "--trim");
  const indexes = readRemovedFeatures(join(folder, isWindows ? "trimmed.exe" : "trimmed"));
  return {
    trimmed: await run(trimmed, cwd, env),
    plain: await run(options.printsAsAnExecutable ? await build("whole") : [bunExe(), join(folder, entry)], cwd, env),
    removed: model.features.filter(feature => indexes?.includes(feature.index)).map(feature => feature.name),
  };
}

export function checkNames() {
  test("every program names a part that src/trim/features declares, as it is spelled there", () => {
    const wrong: string[] = [];
    const check = (where: string, name: string, options: ProgramOptions) => {
      if (!options.features && findFeature(name) === undefined)
        wrong.push(`${where}: no feature is called ${name}; give it "features"`);
      for (const spelling of options.features ?? [])
        if (findFeature(spelling) !== spelling)
          wrong.push(
            `${where}: ${spelling} is ${findFeature(spelling) === undefined ? "no feature" : "spelled " + findFeature(spelling)}`,
          );
    };
    for (const name of programNames) check(name + ".ts", name, optionsAt(join(programs, name + ".json")));
    for (const name of neighborNames) check("near/" + name, name, optionsAt(join(neighbors, name, "features.json")));
    expect(wrong).toEqual([]);
  });
}

/** Every `parts`-th program, from the `part`-th on. */
export function byUse(part: number, parts: number) {
  let next = 0;
  const mine = () => next++ % parts === part - 1;

  (!canTrim || unsupported ? describe.skip : describe.concurrent)("--compile --aot --trim", () => {
    for (const name of programNames.filter(mine)) {
      const options = optionsAt(join(programs, name + ".json"));
      const features = featuresOf(name, options);
      const declare = isWindows && options.posix ? test.skip : options.failsToday !== undefined ? test.failing : test;
      declare(
        `${name}: the program prints what it prints in plain Bun, and its executable has ${features.join(", ") || "what it needs"}`,
        () =>
          inTurn(async () => {
            using dir = tempDir("trim-by-use", {
              "program.ts": readFileSync(join(programs, name + ".ts"), "utf8"),
              "tsconfig.json": tsconfig,
              "cwd/empty": "",
            });
            const { trimmed, plain, removed } = await trimmedAndPlain(String(dir), "program.ts", options);
            expect(plain.exitCode).toBe(0);
            expect(plain.stdout).not.toBe("");
            expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({
              stdout: plain.stdout,
              exitCode: 0,
            });
            expect(removed.length).toBeGreaterThan(0);
            expect(removed.filter(feature => features.includes(feature))).toEqual([]);
          }),
      );
    }

    for (const name of neighborNames.filter(mine)) {
      const files = Object.fromEntries(
        readdirSync(join(neighbors, name)).map(file => [file, readFileSync(join(neighbors, name, file), "utf8")]),
      );
      const options: ProgramOptions = files["features.json"] ? JSON.parse(files["features.json"]) : {};
      const features = featuresOf(name, options);
      test.skipIf(features.length === 0 || (isWindows && options.posix === true))(
        `near ${name}: the program prints what it prints in plain Bun, and its executable lacks ${features.join(", ")}`,
        () =>
          inTurn(async () => {
            using dir = tempDir("trim-by-use-near", { ...files, "tsconfig.json": tsconfig, "cwd/empty": "" });
            const { trimmed, plain, removed } = await trimmedAndPlain(String(dir), "near.ts", {
              printsAsAnExecutable: options.printsAsAnExecutable,
            });
            expect(plain.exitCode).toBe(0);
            expect(plain.stdout).not.toBe("");
            expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({
              stdout: plain.stdout,
              exitCode: 0,
            });
            if (!options.keptToday) expect(features.filter(feature => !removed.includes(feature))).toEqual([]);
          }),
      );
    }
  });
}
