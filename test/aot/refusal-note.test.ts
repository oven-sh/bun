import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { without } from "./harness/capabilities";
import "./harness/registry";
import { run } from "./harness/run";
import { test } from "./supported";

// Code of the product catches what --aot refuses, and a test fails for a reason that it does not show. The list at the end of the run may stand far away.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "src/load.js": `export const load = async url => { try { return (await import(url)).x; } catch { return "setup failed"; } };`,
  "main.js": `import { load } from "./src/load.js";\nconsole.log(await load(process.argv[2]));`,
  "tests/a.test.js": `import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "../src/load.js";
test("passes ahead of the load", () => {});
test("fails behind the load", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "written-")), "m.mjs");
  writeFileSync(file, "export const x = 1;");
  expect(await load(pathToFileURL(file).href)).toBe(1);
});
test("passes behind the load", () => {});
test("times out behind the load", () => new Promise(() => {}), 50);`,
  "tests/b.test.js": `import { expect, test } from "bun:test";
test("fails in a file that loads nothing", () => expect(1).toBe(2));`,
};
const note =
  /^ +\^ while this file ran, --aot refused to load code that wasn't compiled: Cannot load '[^']+m\.mjs', at src\/load\.js:1:\d+\. See the end of the run, or add --aot-allow-code-from-disk$/;

/** Of each test file, where the run first names it: the lines of its tests, each with the lines that stand under it. */
async function linesOfTests(directory: string, flags: string[], words = "") {
  const { stdout, stderr } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
  const lines = (stdout + "\n" + stderr).split("\n");
  const shown: Record<string, string[]> = {};
  let file: string[] | undefined;
  for (const line of lines) {
    const name = /^tests\/(\w)\.test\.js:$/.exec(line)?.[1];
    if (name) file = name in shown ? undefined : (shown[name] = []);
    else if (/^\((pass|fail)\) /.test(line)) file?.push(line.replace(/ \[[\d.]+m?s\]$/, ""));
    else if (/^ +\^ /.test(line))
      file?.push(note.test(line) ? "  the note" : line.trim().replace(/'[^']*src.(?=lib\.js')/, "'<src>"));
    else if (/^ *\d+ (pass|fail)$/.test(line)) file = undefined;
  }
  return { shown, all: lines.join("\n") };
}
const withNotes = {
  a: [
    "(pass) passes ahead of the load",
    "(fail) fails behind the load",
    "  the note",
    "(pass) passes behind the load",
    "(fail) times out behind the load",
    "^ this test timed out after 50ms.",
    "  the note",
  ],
  b: ["(fail) fails in a file that loads nothing"],
};
const failuresWithNotes = { a: withNotes.a.filter(line => !line.startsWith("(pass)")), b: withNotes.b };

test.each([
  ["as one program", [], "TestRunLayers:0"],
  ["in two layers", [], "TestRunLayers:2,TestRunPartFiles:1"],
  ["in a worker", ["--parallel=1"], ""],
])(
  "a failing test says what --aot refused while its file ran, %s",
  async (_, flags, words) => {
    using dir = tempDir("aot-refusal-note", files);
    const { shown, all } = await linesOfTests(String(dir), ["--aot", ...flags], words);
    expect(shown).toEqual(withNotes);
    expect(all).toContain("1 load of code that wasn't compiled failed during this run");
  },
  300000,
);

test("so do --dots and --only-failures, and the JUnit report is as it was", async () => {
  using dir = tempDir("aot-refusal-note", files);
  expect((await linesOfTests(String(dir), ["--aot", "--only-failures"])).shown).toEqual(failuresWithNotes);
  expect((await linesOfTests(String(dir), ["--aot", "--dots"])).shown).toEqual(failuresWithNotes);
  const report = join(String(dir), "report.xml");
  await linesOfTests(String(dir), ["--aot", "--reporter=junit", `--reporter-outfile=${report}`]);
  expect(readFileSync(report, "utf8")).toContain("fails behind the load");
  expect(readFileSync(report, "utf8")).not.toContain("while this file ran");
}, 300000);

test("nothing is refused and nothing is said with --aot-allow-code-from-disk, nor without --aot", async () => {
  using dir = tempDir("aot-refusal-note", files);
  for (const flags of [["--aot", "--aot-allow-code-from-disk"], []]) {
    const { shown, all } = await linesOfTests(String(dir), flags);
    expect(shown.a.slice(0, 2)).toEqual(["(pass) passes ahead of the load", "(pass) fails behind the load"]);
    expect(all).not.toContain("while this file ran");
  }
}, 300000);

const underFailingTest = (name: string, said: string) => [
  `(pass) passes ahead of ${name}`,
  `(fail) fails behind ${name}`,
  `^ while this file ran, ${said}. See the end of the run`,
  `(pass) passes behind ${name}`,
];

test("a write to a read-only built-in that was refused, and a computed path in code from a string", async () => {
  using dir = tempDir("aot-refusal-note", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/patch.js": `export const patch = () => { try { Promise.prototype[Symbol.toStringTag] = "patched"; return "patched"; } catch { return "setup failed"; } };`,
    "src/lib.js": `export const answer = () => "real";`,
    "src/find.js": `export const find = async path => { globalThis.path = path; try { return (await (0, eval)("import(globalThis.path)")).answer(); } catch (error) { return error.message; } };`,
    "tests/b.test.js": `import { expect, test } from "bun:test";
import { join } from "node:path";
import { find } from "../src/find.js";
import { answer } from "../src/lib.js";
test("passes ahead of the path", () => void answer());
test("fails behind the path", async () => expect(await find(join(import.meta.dir, "..", "src", "lib.js"))).toBe("real"));
test("passes behind the path", () => {});`,
    "tests/a.test.js": `import { expect, test } from "bun:test";
import { patch } from "../src/patch.js";
test("passes ahead of the write", () => {});
test("fails behind the write", () => expect(patch()).toBe("patched"));
test("passes behind the write", () => {});`,
  });
  const said = "--aot refused a write to a read-only built-in: Cannot assign to Promise.prototype[Symbol(Symbol.toStringTag)], at src/patch.js:1:44"; // prettier-ignore
  // An executable refuses it too, and so does `bun build --compile` without --aot.
  const saidOfPath = "--aot refused a computed path that the build didn't see: Cannot reach '<src>lib.js', in code from a string, in src/find.js"; // prettier-ignore
  const compiled = await linesOfTests(String(dir), ["--aot"], "TestRunLayers:0");
  expect(compiled.shown.a).toEqual(underFailingTest("the write", said));
  expect(compiled.shown.b).toEqual(underFailingTest("the path", saidOfPath));
  expect(compiled.all).toContain("1 load of a compiled file by a computed path failed during this run");
  expect(compiled.all).toContain("lib.js': the build saw no import() or require() of a computed path, so compiled files answer only to the paths it saw.") // prettier-ignore
  const ofPath = compiled.all.split("\n").filter(line => line.includes("lib.js'"));
  expect(ofPath.join("\n")).not.toMatch(/this executable|to bun compile|--aot-allow-code-from-disk/);
  // The language refuses the write too.
  const plain = await linesOfTests(String(dir), []);
  expect(plain.shown.a).toEqual(underFailingTest("the write", said).toSpliced(2, 1));
  expect(plain.shown.b[1]).toBe("(pass) fails behind the path");
}, 300000);

// `sabotage=CopiesNameNoFile`: the build forgets which files the copies from disk name: test/aot/missing-export-note.test.ts.
test.skipIf(!!without("the words that break a build on purpose"))(
  "a name that the build left out",
  async () => {
    using dir = tempDir("aot-refusal-note", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "tests/helper.ts": `export const helper = () => "helper";`,
      "tests/imports.ts": `import { helper } from "./helper.ts";
export const who = () => "real " + helper();`,
      "tests/a.test.js": `import { expect, mock, test, vi } from "bun:test";
import { helper } from "./helper.ts";
test("passes ahead of the import", () => void helper());
test("fails behind the import", async () => {
  mock.module("./imports.ts", () => ({ who: () => "mocked" }));
  let seen; try { seen = (await vi.importActual("./imports.ts")).who(); } catch { seen = "setup failed"; }
  expect(seen).toBe("real helper");
});
test("passes behind the import", () => {});`,
    });
    const said = "code from disk imported a name that the build left out: 'helper' in tests/helper.ts, asked for by tests/imports.ts?actual"; // prettier-ignore
    const sabotaged = await linesOfTests(String(dir), ["--aot"], "TestRunLayers:0,sabotage=CopiesNameNoFile");
    expect(sabotaged.shown.a).toEqual(underFailingTest("the import", said));
    expect((await linesOfTests(String(dir), ["--aot"], "TestRunLayers:0")).shown.a[1]).toBe(
      "(pass) fails behind the import",
    );
  },
  300000,
);
