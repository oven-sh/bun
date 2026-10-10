// Runs what `Bun.build({ reactCompiler: true })` makes of the upstream fixtures.
//
// `react-compiler-fixtures.test.ts` compares the number of memo cache slots. This file builds each fixture that exports a
// `FIXTURE_ENTRYPOINT` with and without the compiler, renders both with the same parameters, and expects the same result in
// every render. A fixture without `sequentialRenders` is rendered twice, so that the second render goes through the cache.
//
// `react-compiler-fixtures-run/react.js` stands for React. It renders child components and runs no effects.

import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "react-compiler-fixtures");
const HELPERS = join(import.meta.dir, "react-compiler-fixtures-run");

const SKIP: Record<string, string> = {
  "ssa-for-trivial-update": "does not end",
  "ssa-nested-loops-no-reassign": "does not end",
  "ssa-while-no-reassign": "does not end",
  "fast-refresh-refresh-on-const-changes-dev": "needs @enableResetCacheOnSourceFileChanges",
};
// `ValidateMemoization` throws when its input is new in a render in which its dependencies are not: without the compiler it is.
const ONLY_THE_SOURCE_THROWS = new Set([
  "array-pattern-spread-creates-array",
  "dont-merge-if-dep-is-inner-declaration-of-previous-scope",
  "preserve-memo-deps-conditional-property-chain-less-precise-deps",
]);

const names: string[] = [];
const inputs: string[] = [];
for (const file of [...new Bun.Glob("*.{js,jsx,ts,tsx}").scanSync(FIXTURES)].sort()) {
  const source = readFileSync(join(FIXTURES, file), "utf8");
  if (!source.includes("FIXTURE_ENTRYPOINT")) continue;
  // Flow is not parsed, and these packages need a transform or a runtime of their own.
  if (/@flow|from ['"](fbt|invariant|idx|react-relay|react-native-reanimated)['"]/.test(source)) continue;
  const name = file.replace(/\.\w+$/, "");
  if (name in SKIP) continue;
  names.push(name);
  inputs.push(join(FIXTURES, file));
}

type Render = ["returns", unknown] | ["throws", string];
type Results = Record<string, Render[] | [string, string?]>;
let plain: Results = {};
let compiled: Results = {};
let built: Set<string> = new Set();

async function build(outdir: string, entrypoints: string[], reactCompiler: boolean) {
  // The print stage is given up when any entry point has an error: those are dropped, and the rest is built again.
  const pending = new Set(entrypoints);
  for (let round = 0; round < 20; round++) {
    const result = await Bun.build({
      entrypoints: [...pending],
      root: FIXTURES,
      outdir,
      target: "browser",
      format: "esm",
      external: ["*"],
      treeShaking: false,
      reactCompiler,
      loader: { ".js": "tsx" },
      throw: false,
    } as Bun.BuildConfig);
    if (result.success) return pending;
    const before = pending.size;
    for (const log of result.logs) if (log.level === "error" && log.position?.file) pending.delete(log.position.file);
    if (pending.size === before) throw new AggregateError(result.logs, "Bun.build failed, and no error names a file");
  }
  throw new Error("Bun.build did not converge");
}

async function renderAll(root: string, side: string): Promise<Results> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(root, "render-fixture.js"), join(root, side), join(root, "names.json")],
    env: bunEnv,
    cwd: root,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${side}: exit ${exitCode}: ${stderr.slice(0, 2000)}`);
  return await Bun.file(join(root, side + ".json")).json();
}

// About 1,700 modules are loaded: too slow for a test where JavaScriptCore is a debug build.
describe.skipIf(isDebug || isASAN)("react-compiler upstream fixtures, run", () => {
  beforeAll(
    async () => {
      const everything = { ".": "./index.js", "./compiler-runtime": "./index.js", "./jsx-runtime": "./index.js", "./jsx-dev-runtime": "./index.js" }; // prettier-ignore
      using dir = tempDir("react-compiler-fixtures-run", {
        "render-fixture.js": readFileSync(join(HELPERS, "render-fixture.js"), "utf8"),
        "node_modules/react/package.json": JSON.stringify({ name: "react", type: "module", exports: everything }),
        "node_modules/react/index.js": readFileSync(join(HELPERS, "react.js"), "utf8"),
        "node_modules/fbt/package.json": JSON.stringify({ name: "fbt", type: "module", main: "./index.js" }),
        "node_modules/fbt/index.js": "export const IntlVariations = {}; export const init = () => {};",
        "node_modules/shared-runtime/package.json": JSON.stringify({ name: "shared-runtime", type: "module", main: "./shared-runtime.js" }), // prettier-ignore
      });
      const root = String(dir);
      await build(join(root, "node_modules/shared-runtime"), [join(FIXTURES, "shared-runtime.ts")], false);
      const [a, b] = [await build(join(root, "plain"), inputs, false), await build(join(root, "compiled"), inputs, true)];
      built = new Set(names.filter((_, i) => a.has(inputs[i]) && b.has(inputs[i])));
      await Bun.write(join(root, "names.json"), JSON.stringify([...built]));
      [plain, compiled] = await Promise.all([renderAll(root, "plain"), renderAll(root, "compiled")]);
    },
    { timeout: 120_000 },
  );

  test("most fixtures are rendered", () => {
    const rendered = [...built].filter(name => Array.isArray(plain[name]?.[0]));
    expect(rendered.length).toBeGreaterThan(800);
  });

  test.each(names)("%s", name => {
    if (!built.has(name)) return;
    const expected = ONLY_THE_SOURCE_THROWS.has(name)
      ? (plain[name] as Render[]).map((render, i) => (render[0] === "throws" ? compiled[name][i] : render))
      : plain[name];
    expect(compiled[name]).toEqual(expected);
  });
});
