/**
 * scripts/runner.node.ts gives many quick test files to one `bun test --parallel` process, a bucket. With a sanitizer a
 * file that builds executables is in no bucket: it runs in a process of its own, beside two others.
 *
 * These tests start the runner itself, under Node.js as CI does, over test files of this repository. A stand-in for the
 * Bun under test answers what the runner asks of it and records each `bun test` command that it is started with.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

// As Node.js names it in the commands of the runner.
const tests = realpathSync(join(import.meta.dir, ".."));
const node = Bun.which("node");

const standIn = `#!/bin/sh
IFS='\t'
case "$1" in
  --print) echo "$0" ;;
  --revision) echo "0.0.0+stand-in" ;;
  test)
    echo "$*" >> "$COMMANDS"
    for last; do :; done
    case "$last" in
      *"\${FAILS_ONCE:-no file}"*)
        if [ ! -e "$COMMANDS.failed" ]; then
          : > "$COMMANDS.failed"
          echo "\${FAILS_SAYING:-(fail) made to fail once}"
          exit 1
        fi ;;
    esac ;;
esac
`;
// The widths of the runner follow the machine, so every machine that runs these tests answers as the CI machines with a
// sanitizer do.
const processors = 8;
const machine = `import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
os.availableParallelism = () => ${processors};
os.totalmem = () => 64 * 1024 ** 3;
syncBuiltinESMExports();
`;

const linesOf = (file: string) => readFileSync(join(tests, file), "utf8").split("\n");
const leftOut: string[] = JSON.parse(readFileSync(join(tests, "parallel-allowlist.json"), "utf8")).excludeFiles;
// Outside CI the runner checks every file as it does with a sanitizer, and what these lists name is in no bucket then.
const unchecked = new Set([...linesOf("no-validate-exceptions.txt"), ...linesOf("no-validate-leaksan.txt")]);
const durations: Record<string, { default?: number }> = JSON.parse(
  readFileSync(join(tests, "expected-durations.json"), "utf8"),
);
const runsAlone = (path: string) => /^\/\/ Runs alone: /m.test(readFileSync(join(tests, path), "utf8"));

/** Files of a folder of test/parallel-allowlist.json that nothing else keeps out of a bucket. */
function bucketFiles(folder: string, count: number, named = /\.test\.ts$/) {
  return readdirSync(join(tests, folder))
    .filter(name => named.test(name) && !/stress/i.test(name))
    .map(name => `${folder}/${name}`)
    .filter(
      path =>
        !leftOut.includes(path) &&
        !unchecked.has(`test/${path}`) &&
        typeof durations[path]?.default === "number" &&
        !runsAlone(path),
    )
    .sort()
    .slice(0, count);
}
const building = [
  ...bucketFiles("aot", 10),
  ...bucketFiles("bundler", 2, /^compile-trim-.*\.test\.ts$/),
  ...bucketFiles("cli", 2, /^aot-.*\.test\.ts$/),
].sort();
const others = bucketFiles("js/bun/util", 12);
// The allowlist leaves these out, so they have a process of their own with any Bun.
const buildingAndLong = leftOut.filter(path => /^aot\/[^/]+\.test\.ts$/.test(path) && !runsAlone(path)).slice(0, 3);

interface Command {
  /** Under test/. */
  files: string[];
  flags: string;
}
const isBucket = ({ flags }: Command) => /^--parallel=\d+ /.test(flags);
const ofOneFile = ({ files, flags }: Command) => `${files} ${flags}`;

/** Starts the runner for `files` with the stand-in named `bun`. */
async function run(
  bun: "bun-asan" | "bun-profile",
  files: string[],
  flags: string[],
  env: Record<string, string> = {},
) {
  using dir = tempDir("runner-buckets", { "bun-asan": standIn, "bun-profile": standIn, "machine.mjs": machine });
  chmodSync(join(String(dir), bun), 0o755);
  const commands = join(String(dir), "commands");
  await using runner = Bun.spawn({
    cmd: [
      node!,
      "--import",
      join(String(dir), "machine.mjs"),
      join(tests, "..", "scripts", "runner.node.ts"),
      `--exec-path=${join(String(dir), bun)}`,
      ...flags,
      ...files.map(file => `--include=${file}`),
    ],
    // Nothing of the CI that runs this test: the runner that is started here reports to nobody.
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", COMMANDS: commands, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runner.stdout.text(), runner.stderr.text(), runner.exited]);
  return {
    commands: (await Bun.file(commands).text())
      .split("\n")
      .filter(Boolean)
      .map((line): Command => {
        const words = line.split("\t").slice(1);
        return {
          files: words.filter(word => word.startsWith(tests)).map(word => word.slice(tests.length + 1)),
          flags: words.filter(word => word.startsWith("--") && !word.startsWith("--reporter-outfile=")).join(" "),
        };
      }),
    stdout,
    stderr,
    exitCode,
  };
}

// Three files at a time: three times the time limits of a file alone, and with a sanitizer a third of the processors.
const besideOthers = `--timeout=810000 --reporter=dots --max-concurrency=${Math.ceil(processors / 3)}`;
const alone = `--timeout=270000 --reporter=dots --max-concurrency=${processors}`;

describe.skipIf(isWindows || !node)("scripts/runner.node.ts", () => {
  test("the files that these tests give to the runner", () => {
    expect({ building: building.length, others: others.length, buildingAndLong: buildingAndLong.length }).toEqual({
      building: 14,
      others: 12,
      buildingAndLong: 3,
    });
  });

  test.concurrent("without a sanitizer a bucket takes the files that build executables", async () => {
    const { commands, stderr, exitCode } = await run("bun-profile", [...building, ...others], ["--quiet"]);
    expect({
      buckets: commands.filter(isBucket).map(({ files }) => files.sort()),
      filesOfTheirOwnProcess: commands.filter(command => !isBucket(command)).map(ofOneFile),
      stderr,
      exitCode,
    }).toEqual({ buckets: [building, others], filesOfTheirOwnProcess: [], stderr: "", exitCode: 0 });
  });

  test.concurrent("with a sanitizer a file that builds executables has a process of its own", async () => {
    const { commands, stderr, exitCode } = await run("bun-asan", [...building, ...others], ["--quiet"]);
    expect({
      buckets: commands.filter(isBucket).map(({ files }) => files.sort()),
      filesOfTheirOwnProcess: commands
        .filter(command => !isBucket(command))
        .map(ofOneFile)
        .sort(),
      stderr,
      exitCode,
    }).toEqual({
      buckets: [others],
      filesOfTheirOwnProcess: building.map(file => `${file} ${besideOthers}`),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent(
    "with a sanitizer a file that fails beside others is tried again alone when they are through",
    async () => {
      const failing = building[3]!;
      const { commands, stdout, stderr, exitCode } = await run("bun-asan", [...building, ...others], ["--quiet"], {
        FAILS_ONCE: failing,
      });
      expect({
        order: commands.map(command => (isBucket(command) ? "a bucket" : command.flags)),
        triedAgain: commands[building.length]?.files,
        said: stdout.split("\n").filter(line => line.includes("beside other files")),
        stderr,
        exitCode,
      }).toEqual({
        order: [...building.map(() => besideOthers), alone, "a bucket"],
        triedAgain: [failing],
        said: [expect.stringContaining(`test/${failing} - code 1: made to fail once beside other files`)],
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.concurrent("with a sanitizer what a sanitizer reports beside others is final", async () => {
    const failing = building[3]!;
    const { commands, stdout, stderr, exitCode } = await run("bun-asan", [...building, ...others], ["--quiet"], {
      FAILS_ONCE: failing,
      FAILS_SAYING: "==1==ERROR: AddressSanitizer: heap-use-after-free",
    });
    expect({
      order: commands.map(command => (isBucket(command) ? "a bucket" : command.flags)),
      said: stdout.split("\n").filter(line => line.includes(`test/${failing} - `)),
      stderr,
      exitCode,
    }).toEqual({
      order: [...building.map(() => besideOthers), "a bucket"],
      said: [expect.stringMatching(/ - pid \d+ error: addresssanitizer/)],
      stderr: "",
      exitCode: 1,
    });
  });

  test.concurrent("without a sanitizer a file of its own process keeps its tries and all the processors", async () => {
    // Outside CI the runner tries a file once, so the one that fails is not tried again in its place.
    const { commands, stderr, exitCode } = await run("bun-profile", buildingAndLong, ["--quiet"], {
      FAILS_ONCE: buildingAndLong[1]!,
    });
    expect({ commands: commands.map(ofOneFile).sort(), stderr, exitCode }).toEqual({
      commands: buildingAndLong.map(file => `${file} --timeout=270000 --reporter=dots --max-concurrency=${processors}`),
      stderr: "",
      exitCode: 1,
    });
  });

  test.concurrent("with a sanitizer a file that builds executables costs its shard more", async () => {
    // What the runner takes each of two shards to cost.
    const costs = async (bun: "bun-asan" | "bun-profile") => {
      const shards = await Promise.all(
        [0, 1].map(shard => run(bun, [...building, ...others], ["--max-shards=2", `--shard=${shard}`])),
      );
      return shards.map(({ stdout }) => Number(/^Sharding tests \(LPT\): .* est (\d+)s of /m.exec(stdout)?.[1]));
    };
    const [withSanitizer, without] = await Promise.all([costs("bun-asan"), costs("bun-profile")]);
    // A file of a bucket counts as a third of its time and a file of its own process as half of it: a sixth more.
    const more = building.reduce((sum, file) => sum + durations[file]!.default!, 0) / 6000;
    expect(more).toBeGreaterThan(4);
    // Each of the four costs is rounded to a second.
    expect(withSanitizer[0]! + withSanitizer[1]! - without[0]! - without[1]!).toBeWithin(more - 2, more + 2.001);
  });
});
