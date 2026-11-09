/**
 * scripts/runner.node.ts gives many quick test files to one `bun test --parallel` process, a bucket. With a sanitizer a
 * file that builds executables is in no bucket: it runs in a process of its own, beside two others.
 *
 * These tests start the runner itself, under Node.js as CI does, over test files of this repository. A stand-in for the
 * Bun under test answers what the runner asks of it. It records each `bun test` command that it is started with, and when
 * a process of one file begins and ends.
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
  test)
    echo "$*" >> "$COMMANDS"
    case "$*" in *--parallel=*) exit 0 ;; esac
    for last; do :; done
    fails=
    case "$last" in
      *"\${FAILS_ONCE:-no file}"*) fails=once ;;
      *"\${FAILS_EACH_TIME:-no file}"*) fails=each-time ;;
    esac
    if [ "$fails" = once ] && [ -e "$COMMANDS.failed" ]; then fails=; echo "begins again" >> "$COMMANDS.events"
    else echo "begins" >> "$COMMANDS.events"; fi
    # Runs until as many files run at once as the test expects, or until another file has seen that. It looks when all that
    # started with it are under way, so more files at once than the test expects are counted too. A runner that starts one
    # file at a time never lets it see them: it gives up after twenty seconds, far more than a loaded machine takes to
    # start three processes.
    tries=0
    while [ "\${RUNS_BESIDE:-0}" -gt 0 ] && [ ! -e "$COMMANDS.together" ] && [ "$tries" -lt 400 ]; do
      sleep 0.05
      tries=$((tries + 1))
      underWay=$(( $(grep -c begins "$COMMANDS.events") - $(grep -c ends "$COMMANDS.events") ))
      if [ "$underWay" -ge "$RUNS_BESIDE" ]; then break; fi
    done
    : > "$COMMANDS.together"
    echo "ends" >> "$COMMANDS.events"
    if [ -n "$fails" ]; then
      : > "$COMMANDS.failed"
      echo "\${FAILS_SAYING:-(fail) made to fail}"
      exit 1
    fi ;;
esac
`;
// The widths of the runner follow the machine, so every machine that runs these tests answers as the CI machines with a
// sanitizer do.
const processors = 8;
const machine = `import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
os.availableParallelism = () => ${processors};
os.totalmem = () => 64 * 1024 ** 3;
syncBuiltinESMExports();
// A time limit of the runner is a timer of a minute or more. Each is written down, so no test waits for one. Before a
// further try of a file the runner waits for more than five seconds and less than fifteen: here it does not.
const { setTimeout: setTimer } = globalThis;
globalThis.setTimeout = (callback, milliseconds, ...rest) => {
  if (milliseconds >= 60_000) appendFileSync(process.env.COMMANDS + ".limits", milliseconds + "\\n");
  return setTimer(callback, milliseconds > 5_000 && milliseconds < 15_000 ? 0 : milliseconds, ...rest);
};
`;
const minutes = 60_000;

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
  ...bucketFiles("aot", 11),
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
  // What the stand-in and the runner wrote down. A run in which no process of one file started has no events.
  const written = async (what: "" | ".events" | ".limits") => {
    const file = Bun.file(commands + what);
    return (await file.exists()) ? (await file.text()).split("\n").filter(Boolean) : [];
  };
  // How many processes of one file ran at once, and how many ran beside the file that was tried again.
  let underWay = 0;
  let mostAtOnce = 0;
  let besideTheFileTriedAgain: number | undefined;
  for (const event of await written(".events")) {
    if (event === "ends") underWay--;
    else mostAtOnce = Math.max(mostAtOnce, ++underWay);
    if (event === "begins again") besideTheFileTriedAgain = underWay - 1;
  }
  return {
    commands: (await written("")).map((line): Command => {
      const words = line.split("\t").slice(1);
      return {
        files: words.filter(word => word.startsWith(tests)).map(word => word.slice(tests.length + 1)),
        flags: words.filter(word => word.startsWith("--") && !word.startsWith("--reporter-outfile=")).join(" "),
      };
    }),
    mostAtOnce,
    besideTheFileTriedAgain,
    /** In milliseconds, in the order in which the runner set them. */
    timeLimits: (await written(".limits")).map(Number),
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
      building: 15,
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

  test.concurrent(
    "with a sanitizer a file that builds executables has a process of its own, three at a time",
    async () => {
      const { commands, mostAtOnce, stderr, exitCode } = await run("bun-asan", [...building, ...others], ["--quiet"], {
        RUNS_BESIDE: "3",
      });
      expect({
        buckets: commands.filter(isBucket).map(({ files }) => files.sort()),
        filesOfTheirOwnProcess: commands
          .filter(command => !isBucket(command))
          .map(ofOneFile)
          .sort(),
        mostAtOnce,
        stderr,
        exitCode,
      }).toEqual({
        buckets: [others],
        filesOfTheirOwnProcess: building.map(file => `${file} ${besideOthers}`),
        mostAtOnce: 3,
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.concurrent(
    "with a sanitizer a file that fails beside others is tried again alone when they are through",
    async () => {
      const failing = building[3]!;
      const { commands, mostAtOnce, besideTheFileTriedAgain, timeLimits, stdout, stderr, exitCode } = await run(
        "bun-asan",
        [...building, ...others],
        ["--quiet"],
        { FAILS_ONCE: failing, RUNS_BESIDE: "3" },
      );
      expect({
        order: commands.map(command => (isBucket(command) ? "a bucket" : command.flags)),
        triedAgain: commands[building.length]?.files,
        mostAtOnce,
        besideTheFileTriedAgain,
        // The bucket is started after them.
        timeLimits: timeLimits.slice(0, building.length + 1),
        said: stdout.split("\n").filter(line => line.includes("beside other files")),
        stderr,
        exitCode,
      }).toEqual({
        order: [...building.map(() => besideOthers), alone, "a bucket"],
        triedAgain: [failing],
        mostAtOnce: 3,
        besideTheFileTriedAgain: 0,
        // Of each file beside others, and of the file alone.
        timeLimits: [...building.map(() => 18 * minutes), 6 * minutes],
        said: [expect.stringContaining(`test/${failing} - code 1: made to fail beside other files`)],
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.concurrent("with a sanitizer a file beside others is ended five minutes before the job", async () => {
    // BUILDKITE_TIMEOUT is the minutes that a job has. Eight leave a file three, less what the runner has run by then, and
    // no less than one.
    const { timeLimits, stderr, exitCode } = await run("bun-asan", [...building, ...others], ["--quiet"], {
      FAILS_ONCE: building[3]!,
      BUILDKITE_TIMEOUT: "8",
    });
    const whatTheJobLeaves = (limit: number) =>
      limit >= 1 * minutes && limit <= 3 * minutes ? "what the job leaves" : limit;
    expect({
      timeLimits: timeLimits.slice(0, building.length + 1).map(whatTheJobLeaves),
      stderr,
      exitCode,
    }).toEqual({
      // The file that is tried again alone keeps its own, as after a bucket.
      timeLimits: [...building.map(() => "what the job leaves"), 6 * minutes],
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("with a sanitizer a file that fails alone too is tried again while the job has time", async () => {
    const failing = building[3]!;
    const { commands, stdout, stderr, exitCode } = await run(
      "bun-asan",
      [...building, ...others],
      ["--quiet", "--retries=2"],
      { FAILS_EACH_TIME: failing },
    );
    expect({
      order: commands.map(command => (isBucket(command) ? "a bucket" : command.flags)),
      noTime: stdout.split("\n").filter(line => line.includes("the job has no time")),
      stderr,
      exitCode,
    }).toEqual({
      order: [...building.map(() => besideOthers), alone, alone, alone, "a bucket"],
      noTime: [],
      stderr: "",
      exitCode: 1,
    });
  });

  test.concurrent(
    "with a sanitizer a file that fails alone too is not tried again where the job has no time",
    async () => {
      const failing = building[3]!;
      // Of a job of five minutes nothing is left five minutes before its end.
      const { commands, stdout, stderr, exitCode } = await run(
        "bun-asan",
        [...building, ...others],
        ["--quiet", "--retries=2"],
        { FAILS_EACH_TIME: failing, BUILDKITE_TIMEOUT: "5" },
      );
      expect({
        order: commands.map(command => (isBucket(command) ? "a bucket" : command.flags)),
        noTime: stdout.split("\n").filter(line => line.includes("the job has no time")),
        stderr,
        exitCode,
      }).toEqual({
        order: [...building.map(() => besideOthers), alone, "a bucket"],
        noTime: [
          expect.stringContaining(`test/${failing} - code 1: made to fail, and the job has no time for another try`),
        ],
        stderr: "",
        exitCode: 1,
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
    // The one that fails is tried again in its place, beside the others, and nothing asks what time the job has left.
    const { commands, stderr, exitCode } = await run("bun-profile", buildingAndLong, ["--quiet", "--retries=1"], {
      FAILS_ONCE: buildingAndLong[1]!,
      BUILDKITE_TIMEOUT: "5",
    });
    expect({ commands: commands.map(ofOneFile).sort(), stderr, exitCode }).toEqual({
      commands: [...buildingAndLong, buildingAndLong[1]!]
        .sort()
        .map(file => `${file} --timeout=270000 --reporter=dots --max-concurrency=${processors}`),
      stderr: "",
      exitCode: 0,
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
