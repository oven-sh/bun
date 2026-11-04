import { expect, vi } from "bun:test";
import { bunEnv, bunExe, isCI, isDebug, isMacOS, isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative } from "node:path";
import { isHardened } from "./hardened";
import { raiseDefaultTimeout } from "./harness/default-timeout";
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
// the text of its own. What a run of each form has to print: the name in the project, and what the text requires by a name that
// it spells, which is every module that the test file loads or none at all.
const standIn = "node_modules/.cache/bun-test-files-from-disk";
const layers = "TestRunLayers:2,TestRunPartFiles:1,TestRunShowsStandIn:1";
type Form = { env: Record<string, string>; standIns: string[] };
const forms: Record<string, Form> = {
  // Two texts under one name: the lowest layer's, and an upper layer's.
  "in layers": {
    env: { BUN_DEBUG_TEST_AOT_WORDS: layers },
    standIns: [`${standIn}.ts names every module of the test file`, `${standIn}.ts names none`],
  },
  "in layers that are told what is named": {
    env: { BUN_DEBUG_TEST_AOT_WORDS: layers, BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" },
    standIns: [`${standIn}.js names none`, `${standIn}.ts names every module of the test file`],
  },
  "with test files from disk": {
    env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1", BUN_AOT_TEST_FILES_FROM_DISK: "1" },
    standIns: [`${standIn}.ts names every module of the test file`],
  },
  "with test files from disk that say what they name": {
    env: {
      BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1",
      BUN_AOT_TEST_FILES_FROM_DISK: "1",
      BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
    },
    standIns: [`${standIn}.js names none`],
  },
};

// A run builds all of Bun's own code, and that build is nearly all of what the run costs: it keeps about five processors busy.
// Where this file has the machine to itself, the tests that wait for one run, each in a folder of its own, run a quarter as many
// at once as there are processors, three at most. In CI, and where `bun test --parallel` runs this file, other files build beside
// it on every processor: there a second run takes what it gains from the first and from those files, and the tests run one at a
// time. The last tests are about runs at once, and nothing of this file runs beside them.
const atOnce = isCI || process.env.BUN_TEST_WORKER_ID ? 1 : Math.min(3, Math.max(1, availableParallelism() >> 2));
const testOfOneRun = atOnce > 1 ? test.concurrent : test;
vi.setConfig({ maxConcurrency: atOnce });

// No test has a limit of its own. The limit of the file is that of `supported.ts`, which sets it for the first file of a process
// only: two minutes, and what the runner gives where Bun has assertions. A debug build of Bun takes three minutes for a run
// beside two others on twelve processors, and no lane of CI tests one.
raiseDefaultTimeout(isDebug ? 600_000 : 120_000);

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
 * lines are sorted. `standIns`: what stands in for the test files in the builds of the run. `builtOtherwise`: how the run says
 * that it is built in another form than it is asked for here.
 */
async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const shown = /^AOT stand-in \| (.*)\n([^]*?)^AOT stand-in ends$/gm;
  const said = stderr.replace(shown, "AOT stand-in | $1");
  if (exitCode !== 0) console.error(said);
  const standIns = [...stderr.matchAll(shown)].map(([, path, text]) => {
    const required: string[] = text.match(/\brequire\("[^"]+"\)/g) ?? [];
    const ofTestFile = names.filter(name => required.includes(`require("node:${name}")`));
    const named =
      required.length === 0
        ? "none"
        : ofTestFile.length === names.length
          ? "every module of the test file"
          : `${ofTestFile.length} modules of the test file among ${required.length}`;
    return `${relative(directory, path).replaceAll("\\", "/")} names ${named}`;
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
    // A build that starts over prints its own once more.
    standIns: [...new Set(standIns)].sort(),
    builtOtherwise: said.match(/^AOT test run \| .*(this Bun loads one program a realm|as this Bun holds it)/m)?.[1],
    exitCode,
  };
}

type Ran = Awaited<ReturnType<typeof runTests>>;

/** A compiled run has printed what plain Bun prints, and the stand-ins of its form. */
function expectAsPlain({ standIns, builtOtherwise, ...seen }: Ran, form: Form) {
  expect(seen).toEqual(plain);
  // macOS, Windows and a hardened build load one program a realm: a run says so there, and nowhere else. There a run that asks
  // for layers is built without them, and a run over the code that a Bun holds compiled builds no lowest layer: the stand-ins
  // of those runs are not stated here. A run with the test files from disk is one program everywhere.
  expect({ oneProgramARealm: builtOtherwise === "this Bun loads one program a realm" }).toEqual({
    oneProgramARealm: isMacOS || isWindows || isHardened,
  });
  if (!builtOtherwise || form.env.BUN_AOT_TEST_FILES_FROM_DISK) expect(standIns).toEqual(form.standIns);
}

testOfOneRun("what plain Bun prints in the project", async () => {
  using dir = tempDir("aot-test-run-plain", files);
  expect(await runTests(String(dir), {})).toEqual({ ...plain, standIns: [], builtOtherwise: undefined });
});

for (const [name, form] of Object.entries(forms)) {
  // Of the form in layers, the three runs at once below are the run that writes nothing.
  if (form !== forms["in layers"]) {
    testOfOneRun(`a run ${name} writes nothing into the project`, async () => {
      using dir = tempDir("aot-test-run-writes-nothing", files);
      expectAsPlain(await runTests(String(dir), form.env, "--aot"), form);
      expect(listing(String(dir))).toEqual(written);
    });
  }

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

// Three runs at once in a folder that holds nothing but the project. The two tests below are about the same three: a run of its
// own for the second one built all of Bun's own code once more, and showed nothing of a run in layers that these do not show.
let atOnceInOneFolder: Promise<{ runs: Ran[]; left: string[] }> | undefined;
const threeRunsAtOnce = () =>
  (atOnceInOneFolder ??= (async () => {
    using dir = tempDir("aot-test-runs-at-once", files);
    const runs = await Promise.all([1, 2, 3].map(() => runTests(String(dir), forms["in layers"].env, "--aot")));
    return { runs, left: listing(String(dir)) };
  })());

test("three runs in layers at once in one folder", async () => {
  for (const ran of (await threeRunsAtOnce()).runs) expectAsPlain(ran, forms["in layers"]);
});

test("a run in layers writes nothing into the project", async () => {
  expect((await threeRunsAtOnce()).left).toEqual(written);
});
