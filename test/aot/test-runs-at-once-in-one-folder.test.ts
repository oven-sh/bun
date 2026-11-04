import { expect, vi } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative } from "node:path";
import { atLeastWhatTheRunnerGave, raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// A build that does not see the test files has an entry point that stands in for them. It used to be a file in node_modules/.cache
// of the project, and it had more than one text: the lowest layer's names every module of Bun's own code, an upper layer's names none.
// Of two runs at once in one folder, one built its lowest layer from what the other had written for an upper layer. That layer held
// none of Bun's own code, and the run ended with "Cannot load 'node:child_process': it isn't in this executable" or aborted.
const names = "child_process zlib http readline worker_threads vm crypto stream util os events".split(" ");
const files = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "src/names.js": `export const names = ${JSON.stringify(names)};`,
  "library.test.js": `import { test } from "bun:test";
import { names } from "./src/names.js";
test("modules of Bun under names that are put together", () => {
  console.log("kinds", ...names.map(name => typeof require("node:" + name)));
});`,
  "other.test.js": `import { expect, test } from "bun:test";
import { names } from "./src/names.js";
test("another file", () => { expect(names.length).toBe(11); });`,
};

// What plain Bun prints in the project, and how it ends. Every compiled run has to do the same.
const plain = {
  stdout: ["kinds object object object object object object object function object object function"],
  results: [
    " 0 fail",
    " 1 expect() calls",
    " 2 pass",
    "(pass) another file",
    "(pass) modules of Bun under names that are put together",
    "Ran 2 tests across 2 files.",
  ],
  exitCode: 0,
};

// The entry point still has the name of that file, and its text is in memory. With the word TestRunShowsStandIn:1 each build prints
// the text of its own. What a run of each form has to print: the name in the project, and how many of the modules that the test
// file loads the text names.
const standIn = "node_modules/.cache/bun-test-files-from-disk";
const layers = "TestRunLayers:2,TestRunPartFiles:1,TestRunShowsStandIn:1";
type Form = { env: Record<string, string>; standIns: string[] };
const forms: Record<string, Form> = {
  // Two texts under one name: an upper layer's, and the lowest layer's.
  "in layers": {
    env: { BUN_DEBUG_TEST_AOT_WORDS: layers },
    standIns: [`${standIn}.ts names 0`, `${standIn}.ts names 11`],
  },
  "in layers that are told what is named": {
    env: { BUN_DEBUG_TEST_AOT_WORDS: layers, BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" },
    standIns: [`${standIn}.js names 0`, `${standIn}.ts names 11`],
  },
  "with test files from disk": {
    env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1", BUN_AOT_TEST_FILES_FROM_DISK: "1" },
    standIns: [`${standIn}.ts names 11`],
  },
  "with test files from disk that say what they name": {
    env: {
      BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1",
      BUN_AOT_TEST_FILES_FROM_DISK: "1",
      BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
    },
    standIns: [`${standIn}.js names 0`],
  },
};

// A run builds all of Bun's own code, and that build is nearly all of what the run costs: it keeps about five processors busy.
// The tests that wait for one run, each in a folder of its own, run a quarter as many at once as there are processors, three at
// most. They run one at a time, as the other tests do, where there are fewer than eight processors, and where `bun test --parallel`
// runs this file beside others, as in a bucket of CI: there a second run takes what it gains from the first and from the files
// beside this one. The last two tests are about runs at once, and nothing of this file runs beside them.
const atOnce = process.env.BUN_TEST_WORKER_ID ? 1 : Math.min(3, Math.max(1, availableParallelism() >> 2));
const testOfOneRun = atOnce > 1 ? test.concurrent : test;
vi.setConfig({ maxConcurrency: atOnce });

// A test that waits for one run has two minutes, and the last test, which waits for three at once, has four: as before. Where Bun
// has assertions the runner gives a test more than that, and there one run took five times as long beside the files of a CI bucket
// as alone: there the limits are what the runner gives, and twice that. A debug build of Bun takes over a minute for one run with
// twelve processors to itself, and no lane of CI tests one.
const limitOfOneRun = atLeastWhatTheRunnerGave(isDebug ? 600_000 : 120_000, isASAN || isDebug);
raiseDefaultTimeout(limitOfOneRun);

/** Every file and folder of a project, a folder with a slash behind it. */
const listing = (directory: string) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .map(entry => join(relative(directory, entry.parentPath), entry.name) + (entry.isDirectory() ? "/" : ""))
    .map(path => path.replaceAll("\\", "/"))
    .sort();
// What the project holds when nothing but `files` is written.
const written = ["library.test.js", "other.test.js", "package.json", "src/", "src/names.js", "tsconfig.json"];

/**
 * What `bun test --isolate <flags>` prints in the project: its stdout behind the line that names Bun, and of its stderr each test
 * with its verdict, each count and each line that begins with an error. A folder is run in the order in which it is read, so the
 * lines are sorted. `standIns`: what stands in for the test files in the builds of the run.
 */
async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const shown = /^AOT stand-in \| (.*)\n([^]*?)^AOT stand-in ends$/gm;
  const said = stderr.replace(shown, "AOT stand-in | $1");
  if (exitCode !== 0) console.error(said);
  const standIns = [...stderr.matchAll(shown)].map(([, path, text]) => {
    const named = names.filter(name => text.includes(`require("node:${name}")`));
    return `${relative(directory, path).replaceAll("\\", "/")} names ${named.length}`;
  });
  return {
    stdout: stdout
      .split("\n")
      .filter(line => line && !line.startsWith("bun test "))
      .sort(),
    results: said
      .split("\n")
      .filter(line =>
        /^(\((pass|fail|skip|todo)\) |\w*[Ee]rror\b| *\d+ (pass|fail|skip|todo|expect\(\) calls)$|Ran \d+ tests? across )/.test(
          line,
        ),
      )
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, ""))
      .sort(),
    // A build that starts over prints its own once more. Where this Bun loads one program a realm (macOS, Windows, a hardened
    // build), or holds its own code compiled, a run is built in another form than it is asked for here, with other stand-ins.
    standIns: /^AOT test run \| .*(this Bun loads one program a realm|as this Bun holds it)/m.test(stderr)
      ? undefined
      : [...new Set(standIns)].sort(),
    exitCode,
  };
}

/** A compiled run has printed what plain Bun prints, and the stand-ins of its form. */
function expectAsPlain({ standIns, ...seen }: Awaited<ReturnType<typeof runTests>>, form: Form) {
  expect(seen).toEqual(plain);
  if (standIns) expect(standIns).toEqual(form.standIns);
}

testOfOneRun("what plain Bun prints in the project", async () => {
  using dir = tempDir("aot-test-run-plain", files);
  expect(await runTests(String(dir), {})).toEqual({ ...plain, standIns: [] });
});

for (const [name, form] of Object.entries(forms)) {
  testOfOneRun(`a run ${name} writes nothing into the project`, async () => {
    using dir = tempDir("aot-test-run-writes-nothing", files);
    expectAsPlain(await runTests(String(dir), form.env, "--aot"), form);
    expect(listing(String(dir))).toEqual(written);
  });

  testOfOneRun(`a run ${name} where node_modules/.cache is no folder`, async () => {
    using dir = tempDir("aot-test-run-cache-is-a-file", { ...files, "node_modules/.cache": "" });
    expectAsPlain(await runTests(String(dir), form.env, "--aot"), form);
    // It is a file still, and the only one there.
    expect(listing(String(dir))).toEqual([...written, "node_modules/", "node_modules/.cache"].sort());
  });
}

test("a run in layers beside a run that keeps writing an upper layer's text where the file was", async () => {
  using dir = tempDir("aot-test-run-beside-a-writer", {
    ...files,
    // What stood in for the test files over an upper layer, written as a run wrote it: whole, under another name, renamed into place.
    "node_modules/.cache/upper.ts": `const other = process.argv.at(-1)!;
if (other === "\\0never") {
  await import(other);
  require(other);
}
`,
    "node_modules/.cache/write.cjs": `const { copyFileSync, renameSync, writeSync } = require("node:fs");
for (let written = false; ; written = true) {
  copyFileSync(__dirname + "/upper.ts", __dirname + "/unfinished.ts");
  renameSync(__dirname + "/unfinished.ts", __dirname + "/bun-test-files-from-disk.ts");
  if (!written) writeSync(1, "written\\n");
}`,
  });
  await using writer = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "node_modules/.cache/write.cjs")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  // The run begins when the text lies where the stand-in of the lowest layer has its name.
  const { value } = await writer.stdout.getReader().read();
  expect(new TextDecoder().decode(value)).toBe("written\n");
  expect(listing(String(dir))).toContain(`${standIn}.ts`);
  expectAsPlain(await runTests(String(dir), forms["in layers"].env, "--aot"), forms["in layers"]);
  expect(writer.exitCode).toBe(null);
});

test(
  "three runs in layers at once in one folder",
  async () => {
    using dir = tempDir("aot-test-runs-at-once", files);
    const runs = [1, 2, 3].map(() => runTests(String(dir), forms["in layers"].env, "--aot"));
    for (const ran of await Promise.all(runs)) expectAsPlain(ran, forms["in layers"]);
    expect(listing(String(dir))).toEqual(written);
  },
  2 * limitOfOneRun,
);
