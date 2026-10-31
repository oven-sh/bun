// run({ argv }) gives argv to each test file, and the runtime that starts the file applies none of it.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/test_runner/runner.js#L182-L256
//
// This file passes under `bun test` and, as it is, under `node`. node-test.test.ts runs both.
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, run, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "node-test-run-argv-"));
after(() => rmSync(root, { recursive: true, force: true }));
// Not ASCII, so that a path has more bytes than characters.
const dir = join(root, "é 中😀");
mkdirSync(dir);

const files = {
  // The name of the one test is what the file read in process.argv.
  "a.test.mjs": `
    import { test } from "node:test";
    test(JSON.stringify(process.argv.slice(2)), () => {});
  `,
  // Never in `files`: it runs only if the child takes a value of argv for a path.
  "b.test.mjs": `
    import { test } from "node:test";
    test("b.test.mjs ran", () => {});
  `,
  "only.test.mjs": `
    import { test, describe } from "node:test";
    test.only("focused", () => {});
    test("unfocused", () => {});
    describe("d", { only: true }, () => { test("in-only-suite", () => {}); });
    describe("e", () => { test("plain-in-suite", () => {}); });
  `,
  "early.test.cjs": `
    const early = process.argv.slice(2);
    const { test } = require("node:test");
    const inExecArgv = early.some(value => process.execArgv.includes(value));
    test(JSON.stringify({ preload: globalThis.preloadArgv, early, inExecArgv }), () => {});
  `,
  "preload.cjs": `globalThis.preloadArgv = process.argv.slice(2);`,
  // Starts itself once more as a test file, the way its own runtime does, and names its test after what both read.
  "again.test.mjs": `
    import { test } from "node:test";
    import { spawnSync } from "node:child_process";
    import { readFileSync, writeFileSync } from "node:fs";
    const self = import.meta.filename;
    if (process.env.RUN_ARGV_AGAIN) {
      writeFileSync(self + ".json", JSON.stringify(process.argv.slice(2)));
      test("again", () => {});
    } else {
      spawnSync(process.execPath, [...(process.versions.bun ? ["test"] : []), self], {
        stdio: "ignore",
        env: { ...process.env, RUN_ARGV_AGAIN: "1" },
      });
      const again = JSON.parse(readFileSync(self + ".json", "utf8"));
      test(JSON.stringify({ own: process.argv.slice(2), again }), () => {});
    }
  `,
  // node's test/fixtures/test-runner/print-arguments.js
  "print-arguments.js": `
    const { test } = require('node:test');

    test('process.argv is setup', (t) => {
        t.assert.deepStrictEqual(process.argv.slice(2), ['--a-custom-argument']);
    });
  `,
};
for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);

/** What the children of one run() reported, as "<event> <test name>". A failure has its error too. */
async function reported(stream) {
  const events = [];
  for await (const { type, data } of stream) {
    if ((type !== "test:pass" && type !== "test:fail") || data.details.type !== "test") continue;
    events.push(type === "test:pass" ? `${type} ${data.name}` : `${type} ${data.name}: ${data.details.error?.message}`);
  }
  return events;
}

/** What a.test.mjs reports for argv. A lone surrogate reaches the child as U+FFFD. */
const reads = argv => [`test:pass ${JSON.stringify(argv.map(value => value.toWellFormed()))}`];

/** Calls run() for each case at once, with its options and `cwd: dir`, and compares what the children of each report. */
async function check(cases) {
  const names = Object.keys(cases);
  const reports = await Promise.all(names.map(name => reported(run({ ...cases[name][0], cwd: dir }))));
  assert.deepStrictEqual(
    Object.fromEntries(names.map((name, i) => [name, reports[i]])),
    Object.fromEntries(names.map(name => [name, cases[name][1]])),
  );
}

// A child of a debug build takes seconds to start, and one of these children starts a child.
const timeout = 30_000;

test("the test file reads argv in process.argv and nothing applies it", { timeout }, async () => {
  const flags = "--only --todo -t zzz --timeout 1 --bail --help --watch -x --preload ./nope.js".split(" ");
  const paths = [".", "b.test.mjs", "./b.test.mjs"];
  // Bun hands the values on as "<byte length>:<bytes>", so the last five are not ASCII or read like that.
  const changed = ["", "--", "--only", "a b", "a=b", `q"uo'te`, "back\\slash", "-", "é😀", "\ud800", "1:x", ":", "0:"];
  await check({
    "no argv": [{ files: ["a.test.mjs"] }, reads([])],
    "flags of the runtime and of its test runner": [{ files: ["a.test.mjs"], argv: flags }, reads(flags)],
    "paths of other test files": [{ files: ["a.test.mjs"], argv: paths }, reads(paths)],
    "values that a parser, a shell or an encoding would change": [
      { files: ["a.test.mjs"], argv: changed },
      reads(changed),
    ],
    "argv behind a `--` in execArgv": [
      { files: ["a.test.mjs"], execArgv: ["--"], argv: ["x", "--only"] },
      reads(["x", "--only"]),
    ],
    "--only and --test-only do not make the child skip the tests without `only`": [
      { files: ["only.test.mjs"], argv: ["--only", "--test-only"] },
      ["test:pass focused", "test:pass unfocused", "test:pass in-only-suite", "test:pass plain-in-suite"],
    ],
    // node's test/parallel/test-runner-run.mjs
    "should allow custom arguments via argv": [
      { files: [join(dir, "print-arguments.js")], argv: ["--a-custom-argument"] },
      ["test:pass process.argv is setup"],
    ],
  });
});

test("argv is set before a preload, read when the files start, and only for those files", { timeout }, async () => {
  const early = ["--timeout", "1"];
  const late = ["at-call"];
  const seen = ["at-call", "after-call", "in-setup"];
  const checked = check({
    "a preload and the first statement of a CommonJS file read argv, and process.execArgv does not have it": [
      { files: ["early.test.cjs"], argv: early, execArgv: [`--require=${join(dir, "preload.cjs")}`] },
      [`test:pass ${JSON.stringify({ preload: early, early, inExecArgv: false })}`],
    ],
    "each file gets argv as it is when the files start": [
      { files: ["a.test.mjs", "early.test.cjs"], argv: late, setup: () => void late.push("in-setup") },
      [...reads(seen), `test:pass ${JSON.stringify({ early: seen, inExecArgv: false })}`],
    ],
    "a test file that starts itself once more gets no argv of run() there": [
      { files: ["again.test.mjs"], argv: ["x"] },
      [`test:pass ${JSON.stringify({ own: ["x"], again: [] })}`],
    ],
  });
  // check() has called run(), and no file has started.
  late.push("after-call");
  await checked;
});
