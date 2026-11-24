/**
 * scripts/runner.node.ts starts the test files that build many executables beside one another. With a sanitizer every
 * test of such a file runs beside the others of the file, so there the runner gives a file the processors divided by the
 * files at a time as `--max-concurrency`. A file that runs alone, and every file without a sanitizer, keeps what it had.
 *
 * These tests start the runner itself, under Node.js as CI does, over test files of this repository. A stand-in for the
 * Bun under test answers what the runner asks of it and writes down each `bun test` command that it is started with.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, nodeExeAtLeast, tempDir } from "harness";
import { chmodSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

// As Node.js names it in the commands of the runner.
const tests = realpathSync(join(import.meta.dir, ".."));
// The runner is a TypeScript file, which Node.js starts without a flag since 22.18.
const node = nodeExeAtLeast("22.18.0");

const standIn = `#!/bin/sh
IFS='\t'
case "$1" in
  --print) echo "$0" ;;
  --revision) echo "0.0.0+stand-in" ;;
  test) echo "$*" >> "$COMMANDS" ;;
esac
`;
// The widths of the runner follow the machine, so every machine that runs these tests answers as the one that a test names.
const machine = (processors: number, gigabytes: number) => `import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
os.availableParallelism = () => ${processors};
os.totalmem = () => ${gigabytes} * 1024 ** 3;
syncBuiltinESMExports();
`;

const firstThree = (folder: string, named: RegExp) =>
  readdirSync(join(tests, folder))
    .filter(name => named.test(name))
    .sort()
    .slice(0, 3)
    .map(name => `${folder}/${name}`);
// Their tests build executables: the runner names how many of them run at once wherever such a file runs.
const building = firstThree("cli", /^aot-.*\.test\.ts$/);
// These run beside them. Alone, or without a sanitizer, they have the default of `bun test`.
const beside = firstThree("cli/compile", /\.test\.ts$/);
const theDefault = "the default of bun test";

/** Starts the runner for those six files with the stand-in named `bun`, on a machine with that many processors and gigabytes. */
async function run(bun: "bun-asan" | "bun-profile", processors: number, gigabytes: number) {
  using dir = tempDir("runner-pool", { [bun]: standIn, "machine.mjs": machine(processors, gigabytes) });
  chmodSync(join(String(dir), bun), 0o755);
  const commands = join(String(dir), "commands");
  await using runner = Bun.spawn({
    cmd: [
      node!,
      "--import",
      join(String(dir), "machine.mjs"),
      join(tests, "..", "scripts", "runner.node.ts"),
      `--exec-path=${join(String(dir), bun)}`,
      "--quiet",
      ...[...building, ...beside].map(file => `--include=${file}`),
    ],
    // Nothing of the CI that runs this test: the runner that is started here reports to nobody.
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", COMMANDS: commands },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runner.stdout.text(), runner.stderr.text(), runner.exited]);
  // The file is the last word of a command.
  const testsAtOnce = new Map(
    readFileSync(commands, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(command => command.split("\t"))
      .map(words => [
        words.at(-1)!.slice(tests.length + 1),
        words.find(word => word.startsWith("--max-concurrency=")) ?? theDefault,
      ]),
  );
  return {
    building: building.map(file => testsAtOnce.get(file)),
    beside: beside.map(file => testsAtOnce.get(file)),
    filesAtATime: Number(/files that build many executables \((\d+)-wide\)/.exec(stdout)?.[1] ?? 1),
    stderr,
    exitCode,
  };
}
const each = (flag: string) => [flag, flag, flag];

describe.skipIf(isWindows || !node)("scripts/runner.node.ts", () => {
  test.concurrent("with a sanitizer a file beside others has its share of the processors", async () => {
    expect(await run("bun-asan", 8, 64)).toEqual({
      building: each("--max-concurrency=3"),
      beside: each("--max-concurrency=3"),
      filesAtATime: 3,
      stderr: "",
      exitCode: 0,
    });
    expect(await run("bun-asan", 4, 16)).toEqual({
      building: each("--max-concurrency=2"),
      beside: each("--max-concurrency=2"),
      filesAtATime: 2,
      stderr: "",
      exitCode: 0,
    });
  });

  // Three gigabytes for a file: four let one file run at a time.
  test.concurrent("with a sanitizer a file that runs alone keeps every processor", async () => {
    expect(await run("bun-asan", 8, 4)).toEqual({
      building: each("--max-concurrency=8"),
      beside: each(theDefault),
      filesAtATime: 1,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("without a sanitizer a file beside others keeps every processor", async () => {
    expect(await run("bun-profile", 8, 64)).toEqual({
      building: each("--max-concurrency=8"),
      beside: each(theDefault),
      filesAtATime: 3,
      stderr: "",
      exitCode: 0,
    });
  });
});
