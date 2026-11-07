// Bun's own tests of its transpiler, run as compiled code. transpiler-parity-<n>.test.ts each ask a few of the files listed here.
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename, join } from "path";
import { slot } from "./harness/commands";
import { run as runCommand } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

type CompileMode = "test file" | "child processes" | "bundles";

const files: { path: string; mode: CompileMode }[] = [
  { path: "test/bundler/transpiler/decorators.test.ts", mode: "test file" },
  { path: "test/bundler/transpiler/decorator-metadata.test.ts", mode: "test file" },
  { path: "test/cli/run/esm-defineProperty.test.ts", mode: "test file" },
  { path: "test/js/bun/resolve/esModule-annotation.test.js", mode: "test file" },
  { path: "test/bundler/transpiler/es-decorators.test.ts", mode: "child processes" },
  { path: "test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts", mode: "child processes" },
  { path: "test/bundler/transpiler/ts-use-define-for-class-fields.test.ts", mode: "child processes" },
  { path: "test/bundler/transpiler/ts-import-alias-runs-once.test.ts", mode: "child processes" },
  { path: "test/bundler/transpiler/template-literal.test.ts", mode: "child processes" },
  { path: "test/bundler/transpiler/preserve-use-strict-cjs.test.ts", mode: "child processes" },
  { path: "test/cli/run/require-main-in-an-expression.test.ts", mode: "child processes" },
  { path: "test/js/bun/resolve/require-esm-evaluating-cycle.test.ts", mode: "child processes" },
  { path: "test/js/bun/resolve/require-esm-microtask-order.test.ts", mode: "child processes" },
  { path: "test/js/bun/resolve/require-esm-transitive-tla.test.ts", mode: "child processes" },
  { path: "test/bundler/bundler_jsx.test.ts", mode: "bundles" },
  { path: "test/bundler/esbuild/ts.test.ts", mode: "bundles" },
];

const skipped: Record<string, string> = {
  "test/js/bun/resolve/esModule.test.ts":
    "it stores to members of `import * as Self` (:14), and `bun build` stops at such a store, with --aot and without",
  "test/bundler/bundler_decorator_metadata.test.ts":
    "the entry point of each of its two tests holds the text of an untyped polyfill (TS7006 and others), and a type error stops the build",
  "test/bundler/transpiler/jsx-production.test.ts":
    "its program bundles itself with Bun.build() and imports the output from a blob: URL (jsx-production.tsx:36), and compiled code loads no code that was not compiled with it",
  "test/bundler/transpiler/es-decorators-esbuild.test.ts":
    "its runner imports each case by a computed specifier (:190), so the cases would be interpreted, and its boilerplate adds a property to Function.prototype (:19-20), which is read-only in a compiled program",
};

const untypedJsxRuntime = "TS7016: react/jsx-runtime, which an element stands for, has no type declarations";
const undeclaredIntrinsicElements = "TS7026: nothing declares JSX.IntrinsicElements";
const fastRefresh = "bundler > a hook call in a method, with React Fast Refresh";
const classFields = "tsconfig compilerOptions.useDefineForClassFields";
const fieldOverridesAccessor = "TS2610: a field overrides an accessor of the base class";
const decorators = "ES Decorators";
const decoratorExpressions = "ES Decorators > decorator expressions";
const checkerSpeaksFirst = "the program is refused, in the words of the type checker and not of the parser";
const untypedParameters = "TS7006: the parameters of the decorator have no types";

// path -> test name as `bun test` prints it -> why it fails.
// A type error stops the build.
// In mode `bundles` a test with several entry points is one test per entry point, `<id>/<file name of the entry point>`.
const expectedFailures: Record<string, Record<string, string>> = {
  "test/bundler/transpiler/ts-use-define-for-class-fields.test.ts": {
    [`${classFields} > false: computed literal keys use [[Set]] semantics`]: fieldOverridesAccessor,
    [`${classFields} > false: computed non-literal key keeps the class native`]:
      "TS1166: the computed name of a field is no literal",
    [`${classFields} > false: matches tsc/esbuild ordering and [[Set]] semantics`]: fieldOverridesAccessor,
    [`${classFields} > false: static method named 'constructor' is not treated as the constructor`]:
      "TS1089: a constructor cannot be static",
    [`${classFields} > false: synthesizes constructor when none is declared`]: "TS2564: the field b has no initializer",
    [`${classFields} > true: keeps native class-field ([[Define]]) semantics`]: fieldOverridesAccessor,
    [`${classFields} > unset: keeps native class-field ([[Define]]) semantics`]: fieldOverridesAccessor,
  },
  "test/bundler/transpiler/es-decorators.test.ts": {
    [`${decorators} > accessor with TypeScript annotations > accessor with optional marker (?)`]:
      "TS2564: the accessor has no initializer",
    "ES decorators lowering matrix > .js > privateAccessorBrand":
      "`#x in this` is false until the `accessor #x` field has its value",
    "ES decorators lowering matrix > .js > privateStaticAccessorBrand":
      "`#x in C` is false until the `static accessor #x` field has its value",
    "ES decorators lowering matrix > .js > privateAccessorTwice":
      "`#x in this` is false until the `accessor #x` field has its value",
    [`${decorators} > members stay where they are written > a direct eval reaches an undecorated accessor #x as a getter and a setter`]:
      "`#x in this` in code from a string is false until the `accessor #x` field has its value",
    [`${decoratorExpressions} > decorators on both sides of export are rejected`]: checkerSpeaksFirst,
    [`${decoratorExpressions} > export before decorator (.ts)`]: untypedParameters,
    [`${decoratorExpressions} > non-null assertion in decorator is rejected in JavaScript`]: checkerSpeaksFirst,
    [`${decoratorExpressions} > optional chaining in decorator is rejected with a hint`]: checkerSpeaksFirst,
    [`${decoratorExpressions} > private name in decorator member expression (.ts)`]: untypedParameters,
    [`${decoratorExpressions} > property access after call in decorator is rejected`]: checkerSpeaksFirst,
    [`${decoratorExpressions} > repeated export around a decorator is rejected`]: checkerSpeaksFirst,
    [`${decoratorExpressions} > type arguments in decorator member expression are stripped`]:
      "TS1477: a property access follows an instantiation expression",
  },
  "test/bundler/bundler_jsx.test.ts": {
    "bundler > jsx/AutomaticFragmentNamedImportDev": untypedJsxRuntime,
    "bundler > jsx/AutomaticLocalShadowDev": untypedJsxRuntime,
    "bundler > autoImportTreeShaking > jsx/AutoImportDroppedWhenJsxUnusedBundledCjs": undeclaredIntrinsicElements,
    "bundler > autoImportTreeShaking > jsx/AutoImportKeptWhenJsxUsedBundledCjs": undeclaredIntrinsicElements,
    [`${fastRefresh} > jsx/FastRefreshClassStatementMethods.tsx`]: "TS2339: the class C declares neither c nor v",
  },
  "test/bundler/esbuild/ts.test.ts": {
    "bundler > ts/DeclareClassFields": "TS2304: nothing declares c, d, C and D",
    "bundler > ts/ImportEmptyNamespace": "TS2694: the namespace REMOVE does not export `type`",
    "bundler > ts/ImportTypeOnlyFile": "TS2307: neither imported file exists",
    "bundler > ts/ImportVsLocalCollisionAllTypes": "TS2305: other.ts exports none of the imported names",
    "bundler > ts/ImportVsLocalCollisionMixed": "TS2305: other.ts exports only `real`",
    "bundler > ts/TypeScriptDecoratorsSimpleCase": "TS7019: the rest parameter `args` has no type",
    "bundler > ts/ExportTypeSTAR": 'TS2307: there is no module "foo"',
    "bundler > ts/EnumTreeShaking/sibling-enum-before.ts": "TS2450: the enum x is used before its declaration",
    "bundler > ts/EnumTreeShaking/namespace-before.ts": "TS2304: nothing declares y",
    "bundler > ts/EnumTreeShaking/namespace-after.ts": "TS2304: nothing declares y",
    "bundler > ts/EnumRulesFrom_TypeScript_5_0/not-supported.ts": "TS2304: nothing declares capture",
  },
};

// path -> how the names of a group of tests begin that all read the output of one program -> the difference.
const expectedFailuresOfGroups: Record<string, Record<string, string>> = {
  "test/bundler/transpiler/es-decorators.test.ts": {
    "ES decorators lowering matrix > .ts > ":
      "TS7005 and others: the generated program has variables and parameters without types",
  },
};

// These compare two durations, and here every file runs beside the others. Whether they pass is not judged.
const judgedByAClock = new Set(["lowering many decorated instance fields into a large constructor body stays linear"]);

const wrapperSource = String.raw`import { appendFileSync } from "fs";
const isSource = (arg: string | undefined) => arg !== undefined && /\.[cm]?[jt]sx?$/.test(arg);
let args = process.argv.slice(2);
const shouldCompile = args[0] === "run" ? isSource(args[1]) : isSource(args[0]);
if (shouldCompile) {
  args = ["run", "--debug-aot", ...args.slice(args[0] === "run" ? 1 : 0)];
  appendFileSync(process.env.AOT_PARITY_LOG!, args.join(" ") + "\n");
}
const { exitCode, signalCode } = Bun.spawnSync({
  cmd: [process.env.AOT_PARITY_BUN!, ...args],
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(signalCode ? 1 : (exitCode ?? 1));
`;

const preloadSource = `process.execPath = process.env.AOT_PARITY_WRAPPER!;\n`;

const repoRoot = join(import.meta.dir, "..", "..");
const runTimeout = 240_000;

let directory: ReturnType<typeof tempDir> | undefined;

function wrapperPath() {
  return join(String(directory), "bin", basename(bunExe()));
}

function commandFor(
  paths: string[],
  mode: CompileMode,
  log: string,
): { cmd: string[]; env: Record<string, string | undefined> } {
  switch (mode) {
    case "test file":
      return {
        cmd: [bunExe(), "test", "--debug-aot", "--timeout=60000", ...paths],
        env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
      };
    case "child processes":
      return {
        cmd: [
          bunExe(),
          "test",
          "--concurrent",
          "--timeout=120000",
          "--preload",
          join(String(directory), "use-wrapper.ts"),
          ...paths,
        ],
        env: { ...bunEnv, AOT_PARITY_BUN: bunExe(), AOT_PARITY_WRAPPER: wrapperPath(), AOT_PARITY_LOG: log },
      };
    case "bundles":
      return {
        cmd: [bunExe(), "test", "--timeout=120000", ...paths],
        env: { ...bunEnv, BUN_BUNDLER_TEST_AOT: "1" },
      };
  }
}

async function run(paths: string[], mode: CompileMode) {
  const log = join(String(directory), basename(paths[0]) + ".log");
  writeFileSync(log, "");
  await using proc = Bun.spawn({
    ...commandFor(paths, mode, log),
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: runTimeout,
    killSignal: "SIGKILL",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // What `bun test` prints about a test file stands behind a line with the file's path. Once more than 20 tests pass, it prints
  // every failure a second time before the summary, under no file.
  const about = new Map<string, string[]>(paths.map(path => [path, []]));
  let lines = about.get(paths[0])!;
  for (const line of stderr.split("\n"))
    (lines = /^\d+ tests failed:$/.test(line) ? [] : (about.get(line.slice(0, -1)) ?? lines)).push(line);
  return {
    exitCode,
    signal: proc.signalCode,
    files: new Map(
      [...about].map(([path, lines]) => {
        const names = lines
          .map(line => /^\(fail\) (.+?)(?: \[[0-9.]+m?s\])?$/.exec(line)?.[1])
          .filter(name => name !== undefined);
        return [
          path,
          {
            lines,
            failed: [...new Set(names)].sort(),
            passed: lines.filter(line => line.startsWith("(pass) ")).length,
          },
        ];
      }),
    ),
    compiledRuns: readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

async function check(path: string, mode: CompileMode, running: ReturnType<typeof run>) {
  const { signal, files, compiledRuns, ...ran } = await running;
  const { lines, passed, ...file } = files.get(path)!;
  const failed = file.failed.filter(name => !judgedByAClock.has(name));
  // The exit code is the run's. A file answers for it unless another file of the run has failed or has not run.
  const isOfOthers = [...files].some(([other, { failed, passed }]) => other !== path && (failed.length > 0 || !passed));
  const exitCode =
    (failed.length === 0 && file.failed.length > 0) || (failed.length === 0 && passed > 0 && isOfOthers)
      ? 0
      : ran.exitCode;
  const tail = lines.slice(-60).join("\n");
  const expected = Object.keys(expectedFailures[path] ?? {}).sort();
  const groups = Object.keys(expectedFailuresOfGroups[path] ?? {});
  expect(
    {
      signal,
      failed: failed.filter(name => !groups.some(group => name.startsWith(group))),
      groups: groups.filter(group => failed.some(name => name.startsWith(group))),
      exitCode,
    },
    tail,
  ).toEqual({
    signal: null,
    failed: expected,
    groups,
    exitCode: expected.length + groups.length === 0 ? 0 : 1,
  });
  expect(passed).toBeGreaterThan(0);
  if (mode === "test file") {
    const modules = lines.filter(line => line.includes("[aot] module: "));
    expect(
      modules.some(line => line.includes(basename(path))),
      tail,
    ).toBe(true);
  }
  if (mode === "child processes") expect(compiledRuns.length).toBeGreaterThan(0);
  if (mode === "bundles")
    expect(
      lines.some(line => line.startsWith("[aot] bundle: ")),
      tail,
    ).toBe(true);
}

/** Asks the files named, each of which stands in `files`. */
export function parity(paths: string[]) {
  describe.concurrent("compile/aot/transpiler-parity", () => {
    beforeAll(async () => {
      directory = tempDir("transpiler-parity", { "wrapper.ts": wrapperSource, "use-wrapper.ts": preloadSource });
      const { stderr, exitCode } = await runCommand(
        [bunExe(), "build", "--compile", "wrapper.ts", "--outfile", wrapperPath()],
        String(directory),
      );
      if (exitCode !== 0) throw new Error(`building the wrapper failed:\n${stderr}`);
    }, 120_000);

    afterAll(() => directory?.[Symbol.dispose]());

    // The limit also covers the wait for a free slot, at worst behind every other file.
    const queueTimeout = paths.length * runTimeout + 60_000;
    const asked = files.filter(file => paths.includes(file.path));
    // The files that are compiled themselves are test files of one run: what they reach of test/harness.ts and of Bun's own code is compiled once.
    const compiledThemselves = asked.filter(file => file.mode === "test file").map(file => file.path);
    let oneRun: ReturnType<typeof run> | undefined;
    for (const { path, mode } of asked) {
      const running = () =>
        mode === "test file" ? (oneRun ??= slot(() => run(compiledThemselves, mode))) : slot(() => run([path], mode));
      test(path, () => check(path, mode, running()), queueTimeout);
    }
  });
}

/** What is left out and why, and that every file that is named is there. */
export function theLists() {
  for (const [path, reason] of Object.entries(skipped)) {
    test.todo(`${path}: ${reason}`);
  }

  test("every listed file exists", () => {
    const paths = [...files.map(file => file.path), ...Object.keys(skipped)];
    expect(paths.filter(path => !existsSync(join(repoRoot, path)))).toEqual([]);
  });
}
