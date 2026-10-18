// A Bun that was built without the compiler refuses `--aot`. A test file that uses the flag has to skip itself there. So this reads
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
  "aot/doors-on-names-of-properties.test.ts",
  "aot/host-object-accessors.test.ts",
  "aot/mockable-function-arguments.test.ts",
  "aot/many-modules-in-place.test.ts",
  "aot/mocked-barrels.test.ts",
  "aot/mocked-reassigned-bindings.test.ts",
  "aot/mocked-classes-enums-constants.test.ts",
  "aot/mocked-commonjs-modules.test.ts",
  "aot/mocked-json-modules.test.ts",
  "aot/mocked-numbers.test.ts",
  "aot/mocks-with-test-runner-lookalikes.test.ts",
  "aot/mocks-named-by-tests.test.ts",
  "aot/spies-on-builtin-prototypes.test.ts",
  "aot/spies-on-builtins.test.ts",
  "aot/static-tls-size.test.ts",
  "aot/abort-is-reported.test.ts",
  "aot/backend/memory.test.ts",
  "aot/servers/layers.test.ts",
  "aot/generated-code.test.ts",
  "aot/host-classes-match-bun-types.test.ts",
  "aot/perf/front-end.test.ts",
  "aot/perf/idioms.test.ts",
  "aot/plain-bun.test.ts",
  "aot/run-aot-jit.test.ts",
  "aot/shell-completions-list-flags.test.ts",
  "aot/test-files-self-skip.test.ts",
  "aot/validation-by-types/recorded-issues.test.ts",
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
