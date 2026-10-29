// A Bun that was built without the compiler refuses `--aot`. A test file that uses the flag has to skip itself there. So this reads
// the files: each, or a file that it imports, mentions `unsupported`, which is what harness/compiler.ts asks the Bun under test.
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

const files = [...testFiles("")]
  .filter(file => file.startsWith("aot/") || usesTheFlag.test(readFileSync(join(tests, file), "utf8")))
  .sort();

// These pass where `bun build --compile --aot` and `bun run --aot` are refused.
const needNoCompiler = [
  "aot/fold/constant-expressions.test.ts",
  "aot/numbers-checked-against-ranges.test.ts",
  "aot/a-busy-caller-unbinds-no-child.test.ts",
  "aot/an-operation-that-does-not-collect-puts-collections-off.test.ts",
  "aot/any-two-sources-of-the-compiler-can-share-a-translation-unit.test.ts",
  "aot/emitters-append-in-the-order-written.test.ts",
  "aot/engine-types-are-defined-once.test.ts",
  "aot/the-folder-of-a-program-has-a-short-name.test.ts",
  "aot/the-compiler-reads-no-environment-variable.test.ts",
  "aot/the-compiler-sorts-with-its-own-sort.test.ts",
  "aot/the-frame-of-an-operation-outlives-whoever-is-handed-its-address.test.ts",
  "aot/the-value-under-a-chain-of-casts-is-only-asked-about.test.ts",
  "aot/a-switch-of-the-compiler-names-every-enumerator.test.ts",
  "aot/lists-of-operations-in-the-compiler-only-shrink.test.ts",
  "aot/every-threshold-of-the-compiler-is-declared-as-one.test.ts",
  "aot/every-builtin-module-is-in-a-program.test.ts",
  "aot/every-test-runs-in-ci.test.ts",
  "aot/every-field-of-flows-results-is-written-and-read.test.ts",
  "aot/flow-results-name-the-list-they-read.test.ts",
  "aot/what-is-only-expected-of-a-position-is-widened-in-one-place.test.ts",
  "aot/what-states-that-nothing-was-thrown-puts-the-end-of-a-worker-off.test.ts",
  "aot/host-object-accessors.test.ts",
  "aot/only-errors-replacements-and-positions-ask-how-a-member-name-is-written.test.ts",
  "aot/one-text-reads-what-a-descriptor-literal-says.test.ts",
  "aot/one-text-of-the-engine-reads-what-a-descriptor-literal-says.test.ts",
  "aot/static-tls-size.test.ts",
  "aot/abort-is-reported.test.ts",
  "aot/address-sanitizer-sees-wtf-allocations.test.ts",
  "aot/a-prototype-object-is-no-instance.test.ts",
  "aot/backend/memory.test.ts",
  "aot/builtins/native-contract/noticed-changes.test.ts",
  "aot/many-modules-in-place.test.ts",
  "aot/names-read-from-a-loaded-barrel.test.ts",
  "aot/plain-english.test.ts",
  "aot/removable-statements.test.ts",
  "aot/servers/layers.test.ts",
  "aot/plain-bun.test.ts",
  "aot/plain-bun-is-unchanged.test.ts",
  "aot/plain-bun-installs-no-packages.test.ts",
  "aot/shell-completions-list-flags.test.ts",
  "aot/test-files-self-skip.test.ts",
  "aot/tools/let-values-be-something-else.test.ts",
  "aot/the-fuzzer-judges-as-it-says.test.ts",
  "aot/the-fuzzer-keeps-a-wrong-answer-beside-a-clock.test.ts",
  "cli/aot-compile-executable-path.test.ts",
  "cli/aot-unknown-flags.test.ts",
  "bundler/bun-build-api-dts.test.ts",
  "bundler/bun-build-dts.test.ts",
  "cli/compile/compile-library.test.ts",
  "internal/build-hardened-flags.test.ts",
  "internal/build-left-out-features.test.ts",
  "internal/build-libc-functions.test.ts",
  "internal/builtins-manifest.test.ts",
  "js/bun/jsc/sealed-global-object-error-message.test.ts",
];

function asks(path: string, depth = 0): boolean {
  const text = readFileSync(path, "utf8");
  if (/\bunsupported\b/.test(text)) return true;
  if (depth === 2) return false;
  return [...text.matchAll(/^(?:import .*|\}) from "(\.[^"]+)";$/gm)].some(([, specifier]) => {
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
