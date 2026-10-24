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
  // Starts the file below as a test file, the way its own runtime does, and names its test after what both read.
  "outer.test.mjs": `
    import { test } from "node:test";
    import { spawnSync } from "node:child_process";
    import { readFileSync } from "node:fs";
    import { fileURLToPath } from "node:url";
    const inner = fileURLToPath(new URL("./inner.mjs", import.meta.url));
    spawnSync(process.execPath, [...(process.versions.bun ? ["test"] : []), inner], { stdio: "ignore" });
    const nested = JSON.parse(readFileSync(inner + ".json", "utf8"));
    test(JSON.stringify({ own: process.argv.slice(2), nested }), () => {});
  `,
  "inner.mjs": `
    import { test } from "node:test";
    import { writeFileSync } from "node:fs";
    writeFileSync(import.meta.filename + ".json", JSON.stringify(process.argv.slice(2)));
    test("inner", () => {});
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

// A child of a debug build takes seconds to start.
const timeout = 60_000;

test("the test file reads argv in process.argv and nothing applies it", { timeout }, async () => {
  const cases = {
    "no argv": {},
    "flags of the runtime and of its test runner": {
      argv: ["--only", "--todo", "-t", "zzz", "--timeout", "1", "--bail", "--help", "--watch", "-x", "--preload", "./nope.js"],
    },
    "paths of other test files": { argv: [".", "b.test.mjs", "./b.test.mjs"] },
    "values that a parser or a shell would change": {
      argv: ["", "--", "--only", "a b", "a=b", `q"uo'te`, "back\\slash", "-"],
    },
    // Bun hands the values on as "<byte length>:<bytes>".
    "values that are not ASCII, or read like how Bun hands them on": { argv: ["é😀", "\ud800", "1:x", ":", "0:"] },
    "argv behind a `--` in execArgv": { execArgv: ["--"], argv: ["x", "--only"] },
  };
  const names = Object.keys(cases);
  const results = await Promise.all(
    names.map(name => reported(run({ ...cases[name], files: ["a.test.mjs"], cwd: dir }))),
  );
  assert.deepStrictEqual(
    Object.fromEntries(names.map((name, i) => [name, results[i]])),
    // A lone surrogate reaches the child as U+FFFD.
    Object.fromEntries(
      names.map(name => [name, [`test:pass ${JSON.stringify((cases[name].argv ?? []).map(value => value.toWellFormed()))}`]]),
    ),
  );
});

test("argv --only and --test-only do not make the child skip the tests without `only`", { timeout }, async () => {
  const stream = run({ files: ["only.test.mjs"], argv: ["--only", "--test-only"], cwd: dir });
  assert.deepStrictEqual(await reported(stream), [
    "test:pass focused",
    "test:pass unfocused",
    "test:pass in-only-suite",
    "test:pass plain-in-suite",
  ]);
});

test("a preload and the first statement of a CommonJS file read argv, and process.execArgv does not have it", { timeout }, async () => {
  const argv = ["--timeout", "1"];
  const stream = run({
    files: ["early.test.cjs"],
    argv,
    execArgv: [`--require=${join(dir, "preload.cjs")}`],
    cwd: dir,
  });
  assert.deepStrictEqual(await reported(stream), [
    `test:pass ${JSON.stringify({ preload: argv, early: argv, inExecArgv: false })}`,
  ]);
});

test("each file gets argv as it is when the files start", { timeout }, async () => {
  const argv = ["at-call"];
  const stream = run({
    files: ["a.test.mjs", "early.test.cjs"],
    argv,
    setup: () => void argv.push("in-setup"),
    cwd: dir,
  });
  argv.push("after-call");
  const seen = ["at-call", "after-call", "in-setup"];
  assert.deepStrictEqual(
    (await reported(stream)).sort(),
    [`test:pass ${JSON.stringify(seen)}`, `test:pass ${JSON.stringify({ early: seen, inExecArgv: false })}`].sort(),
  );
});

test("a test file that the test file starts gets no argv of run()", { timeout }, async () => {
  const stream = run({ files: ["outer.test.mjs"], argv: ["x"], cwd: dir });
  assert.deepStrictEqual(await reported(stream), [`test:pass ${JSON.stringify({ own: ["x"], nested: [] })}`]);
});

// node's test/parallel/test-runner-run.mjs
test("should allow custom arguments via argv", { timeout }, async () => {
  const stream = run({ files: [join(dir, "print-arguments.js")], argv: ["--a-custom-argument"] });
  assert.deepStrictEqual(await reported(stream), ["test:pass process.argv is setup"]);
});
