import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` compiles what the test files share as programs of their own, below the test files. Here the main file of a stored program
// is itself the test file, so each of its imports and require() calls, and every object that comes back, crosses from one program into another.
// Plain `bun test` says what each must print.
const programs = [
  "commonjs/call-in-front-comma-module-exports-read",
  "commonjs/every-key-require-cache-lists-can-read",
  "commonjs/first-required-at-the-end-of-the-stack",
  "commonjs/keys-of-object-behind-a-package-that-defines-a-getter-for-a-name",
  "commonjs/pattern-require-reads-names-esm-passes",
  "commonjs/symbols-of-module-seen-half-evaluated",
  "module-loaders/require-held-in-list",
  "modules/constants-that-hold-a-required-es-module",
  "modules/dual-package-import-and-require",
  "modules/functions-of-cjs-called-namespace-read",
  "modules/imported-require-helper-loads-files",
  "modules/json-read-cycle-cjs-requires-importer",
  "modules/names-bound-of-commonjs-modules",
  "modules/namespace-module-exports-again-reached",
  "modules/namespace-objects-asked-one-thing-each",
  "modules/of-few-names-asked-require-resolve",
  "modules/two-modules-hand-name-export-stars-third",
  "tree-shaking/module-loaded-through-alias-of-require",
  // Object.keys() of exports that a file fills with TypeScript's __exportStar: the getters are closures of the program of that file.
  "commonjs/exports-filled-where-unknown-code-runs",
  // A shared file imports itself while its body runs: the job that ends that import() runs whichever program ran last.
  "modules/import-running-module-microtasks-drained",
  // `module.children` of a CommonJS test file lists the shared files that it has required.
  "commonjs/children-listed-in-order-first-requires",
  "commonjs/four-files-change-loader-finds-lists",
  "commonjs/index-of-on-list-of-children-gets-child",
  "commonjs/module-object-that-nothing-follows",
  "commonjs/push-stored-on-module-children",
  "modules/module-parent-is-stored-into-in-a-required-commonjs-file",
  "variable-writers/exports-of-cjs-stored-from-other-files",
  // A shared file rebinds `module`, deletes `module.exports` or stores into `module.parent`, and the test file looks.
  "commonjs/a-required-file-stores-the-main-module-into-its-module",
  "commonjs/keys-of-a-child-that-deleted-its-module-exports",
  "commonjs/a-store-into-module-parent-of-a-required-file",
  "commonjs/a-store-into-module-parent-in-front-of-the-first-read",
  "commonjs/a-module-object-and-then-a-text-stored-into-module-parent",
  "commonjs/the-parent-of-a-child-is-stored-by-the-file-that-required-it",
];

// Plain Bun of a debug build cannot say what this program prints, under `bun <file>` either: its later require() of a file that it first required
// at the end of the stack answers with empty exports, and four of these lines are `object ` with no key. So the compiled run is held to the lines
// themselves, which plain Bun of a release build prints with and without AddressSanitizer, and plain Bun is held to them by a test of its own.
const atTheEndOfTheStack = {
  program: "commonjs/first-required-at-the-end-of-the-stack",
  printed: [
    "# only-values",
    "object kState,kOptions",
    "true object",
    "# a-function-too",
    "object f,kState",
    "true object",
    "# exports-dot",
    "object kState,kOptions",
    "true object",
    "# a-class",
    "object Box,kState",
    "true object",
    "# it-requires-another",
    "object kState,other",
    "true object",
  ],
  // The first test stores it here for the second.
  printedByPlainBun: undefined as string[] | undefined,
};

const stored = join(import.meta.dir, "parallel");

function copyAsTestFile(directory: string, program: string) {
  const folder = join(directory, "p", program);
  cpSync(join(stored, program), folder, { recursive: true });
  const main = readdirSync(folder).find(name => /^main\.[a-z]+$/.test(name))!;
  const text = readFileSync(join(folder, main), "utf8");
  const extension = main.slice("main.".length);
  const isCommonJS = extension === "cjs" || extension === "cts";
  const runner = isCommonJS ? `require("bun:test")` : `await import("bun:test")`;
  rmSync(join(folder, main));
  // The test runs behind all that the file prints while it loads: what stands between two of these lines is one program's.
  const mark = `\n;(${runner}).test(${JSON.stringify(program)}, () => { console.log("== END ${program}"); });\n`;
  writeFileSync(join(folder, `main.test.${extension}`), text + mark);
}

async function runTests(directory: string, ...flags: string[]) {
  const env = {
    ...bunEnv,
    // A project as small as this one is one program unless the word asks for layers. run() fails where the run has none.
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2",
    // first-required-at-the-end-of-the-stack fails a require() in hundreds of frames at the end of the stack, and for each error the run in
    // layers walks every compiled frame below. JavaScriptCore gives JavaScript 5 MB of the stack. With 1.5 MB the stack ends sooner: the run in
    // layers fails in as many frames, and both runs print the same.
    BUN_JSC_maxPerThreadStackUsage: String(1.5 * 1024 * 1024),
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./p"], directory, env);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed: Record<string, string[]> = {};
  let lines: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("== END ")) {
      printed[line.slice("== END ".length)] = lines;
      lines = [];
    } else if (!line.startsWith("bun test ")) lines.push(line.replaceAll(directory, "<project>"));
  }
  return {
    printed,
    // What stdout holds behind the last of those lines: no program is left to print it.
    behindTheLast: lines,
    // What bun test says of each test by its name, and the lines that count them.
    verdicts: Object.fromEntries(
      Array.from(stderr.matchAll(/^\((\w+)\) (.+?)(?: \[[\d.]+ms\])?$/gm), ([, verdict, name]) => [name, verdict]),
    ),
    counts: stderr.match(/^ \d+ \w+$|^Ran \d+ tests? across \d+ files?\./gm) ?? [],
    crashes: stderr.split("\n").filter(line => /worker crashed|could not be compiled/.test(line)),
    exitCode,
  };
}

test("the main files of stored programs run as test files", async () => {
  using dir = tempDir("aot-stored-programs-as-test-files", {
    "package.json": `{ "name": "stored-programs-as-test-files" }`,
  });
  for (const program of programs) copyAsTestFile(String(dir), program);
  const plain = await runTests(String(dir));
  const { printed, ...report } = plain;
  // The next test holds plain Bun to the stored lines of that one program.
  atTheEndOfTheStack.printedByPlainBun = printed[atTheEndOfTheStack.program];
  // Plain Bun says what each must print only where it ran each to its end: every test passed, no file failed to load, nothing was printed behind
  // the last test, and the run ended well. A program that prints nothing would have nothing compared.
  expect({ printedNothing: programs.filter(program => !printed[program]?.length), ...report }).toEqual({
    printedNothing: [],
    behindTheLast: [""],
    verdicts: Object.fromEntries(programs.map(program => [program, "pass"])),
    counts: [` ${programs.length} pass`, " 0 fail", `Ran ${programs.length} tests across ${programs.length} files.`],
    crashes: [],
    exitCode: 0,
  });
  // And the compiled run is held to them.
  printed[atTheEndOfTheStack.program] = atTheEndOfTheStack.printed;
  expect(Object.keys(plain.printed).sort()).toEqual([...programs].sort());
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 300_000);

// Once plain Bun of a debug build prints the keys, this test fails there: write `test` for `(isDebug ? test.failing : test)`.
(isDebug ? test.failing : test)(`plain Bun prints the lines of ${atTheEndOfTheStack.program}`, () => {
  expect(atTheEndOfTheStack.printedByPlainBun).toEqual(atTheEndOfTheStack.printed);
});
