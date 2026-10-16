// Most platforms on which CI runs the tests refuse `--aot` (Linux arm64, musl, macOS x64, Windows). A test file that uses the
// flag has to skip itself there, and nobody who writes one on macOS arm64 or Linux x64 sees it if it does not. So this reads
// the files: each, or a file that it imports, mentions `unsupported`, which is what run-programs.ts asks the Bun under test.
// The short way: `import { describe, test } from "./supported";` in place of the same names of bun:test. In a file where only
// some tests use the flag: `test.skipIf(!!unsupported)`.
// Which files: what scripts/runner.node.ts takes for a test file (getTests(), isHidden(), isTestStrict()), if it is in this
// folder or its text uses the flag.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

const tests = join(import.meta.dir, "..");
const usesTheFlag = /--aot\b|--debug-aot\b|\baot: *(true|\{)/;

function* testFiles(folder: string): Generator<string> {
  for (const entry of readdirSync(join(tests, folder), { withFileTypes: true })) {
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (/node_modules|node.js/.test(folder) || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) yield* testFiles(path);
    else if (/\.(c|m)?(j|t)sx?$/.test(entry.name) && /\.test|spec\./.test(entry.name)) yield path;
  }
}

const files = [...testFiles("")].filter(file => file.startsWith("aot/") || usesTheFlag.test(readFileSync(join(tests, file), "utf8"))).sort();

// These pass where `bun build --compile --aot` and `bun run --aot` are refused.
const needNoCompiler = [
  "aot/accessors-of-host-objects.test.ts",
  "aot/aot-arguments-of-a-function-that-may-be-mocked.test.ts",
  "aot/aot-many-modules-run-in-place.test.ts",
  "aot/aot-mocked-barrels.test.ts",
  "aot/aot-mocked-bindings-that-are-stored-to.test.ts",
  "aot/aot-mocked-classes-enums-and-constants.test.ts",
  "aot/aot-mocked-commonjs-modules.test.ts",
  "aot/aot-mocked-json-modules.test.ts",
  "aot/aot-mocked-numbers.test.ts",
  "aot/aot-mocks-beside-names-like-the-test-runners.test.ts",
  "aot/aot-mocks-named-by-tests.test.ts",
  "aot/aot-spies-on-built-in-prototypes.test.ts",
  "aot/aot-spies-on-built-ins.test.ts",
  "aot/generated-code.test.ts",
  "aot/host-classes-agree-with-bun-types.test.ts",
  "aot/perf/front-end.test.ts",
  "aot/perf/idioms.test.ts",
  "aot/plain-bun.test.ts",
  "aot/run-aot-on-the-jit.test.ts",
  "aot/shell-completions-know-the-flags.test.ts",
  "aot/test-files-skip-themselves.test.ts",
  "bundler/bun-build-dts.test.ts",
  "cli/aot-compile-executable-path.test.ts",
  "cli/aot-environment.test.ts",
  "cli/aot-unknown-flags.test.ts",
  "cli/test/test-aot-mocks-and-lazy-constants.test.ts",
  "js/bun/jsc/sealed-global-object-error-message.test.ts",
];

function asks(path: string, depth = 0): boolean {
  const text = readFileSync(path, "utf8");
  if (/\bunsupported\b/.test(text)) return true;
  if (depth === 2) return false;
  return [...text.matchAll(/^import .* from "(\.[^"]+)";$/gm)].some(([, specifier]) => {
    const imported = join(dirname(path), specifier) + ".ts";
    return existsSync(imported) && asks(imported, depth + 1);
  });
}

test("every test file of --aot asks the Bun under test whether it compiles", () => {
  expect(files.length).toBeGreaterThan(200);
  expect(files.filter(file => !needNoCompiler.includes(file) && !asks(join(tests, file)))).toEqual([]);
});

test("the files that are said to need no compiler are there", () => {
  expect(needNoCompiler.filter(file => !files.includes(file))).toEqual([]);
});
