// Runs the upstream React Compiler test fixtures through `Bun.build({ reactCompiler: true })`
// and checks Bun's output against the upstream `.expect.md` snapshot.
//
// Upstream's expected output is produced by Babel's printer, so byte-for-byte
// comparison is meaningless. Instead we check the one observable invariant the
// compiler is responsible for: the memo cache slot count (`_c(N)`). For
// expected-error fixtures we only check that Bun did not emit a memo cache.
//
// Fixtures are synced from facebook/react by `scripts/sync-react-compiler.sh`;
// the SHA they were synced from is in `src/react_compiler/UPSTREAM_PORTED`.
//
// All fixtures are compiled in a SINGLE `Bun.build()` call (one bundler
// invocation, ~1.8k entrypoints) instead of spawning a `bun build` subprocess
// per fixture. The bundler aborts the print stage if any entrypoint fails to
// parse, so we retry with the failing files removed (their build error is
// recorded and asserted on in that fixture's test case).
//
// ## Pragma handling
//
// Upstream's snap harness parses `// @key value` directives from each fixture
// and feeds them into `EnvironmentConfig` / `PluginOptions` before compiling
// (see `compiler/packages/snap/src/compiler.ts` `parseConfigPragma`). Bun does
// not yet expose a per-file hook to set these, so this runner parses the same
// pragmas and:
//   - skips fixtures whose pragmas Bun cannot honour yet,
//   - relaxes the slot-count check when the effective `compilationMode` differs
//     from Bun's hardcoded `infer` default (upstream's snap default is `all`).

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { isDebug, isASAN } from "harness";

const FIXTURE_ROOT = join(import.meta.dir, "react-compiler-fixtures");
// `parse_fixture_pragmas` and the lint-mode validation passes are
// `#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]` — release
// builds without ASAN compile them out, so pragma-gated fixtures cannot be
// validated there.
const HAS_FIXTURE_PRAGMA_SUPPORT = isDebug || isASAN;
const SNAPSHOT_BUN_OUTPUT = !!process.env.REACT_COMPILER_FIXTURE_SNAPSHOT;
const FILTER = process.env.REACT_COMPILER_FIXTURE_FILTER;

const INPUT_EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs"];

// ---------------------------------------------------------------------------
// Pragma parsing (mirrors upstream parseConfigPragmaForTests)
// ---------------------------------------------------------------------------

type Pragmas = Map<string, string>;

// `// @key`, `// @key value`, `// @key:"value"`, `// @key(value)`. A single
// comment line may carry several pragmas (e.g. `// @flow @compilationMode:"infer"`),
// so scan each `@token` on the line independently rather than anchoring to ^...$.
const PRAGMA_TOKEN_RE = /@(\w+)(?:[:(\s]+["']?([\w.$-]+)["']?\)?)?/g;

function parsePragmas(source: string): Pragmas {
  const out: Pragmas = new Map();
  // Upstream (and `leading_comment_pragma` in program.rs) only scans the leading
  // run of `//` lines and stops at the first non-comment, non-blank line — so a
  // mid-body `// @ts-ignore` is never mistaken for a config pragma.
  for (const line of source.split("\n", 40)) {
    const t = line.trim();
    if (t === "") continue;
    if (!t.startsWith("//")) break;
    for (const m of t.matchAll(PRAGMA_TOKEN_RE)) {
      out.set(m[1], (m[2] ?? "true").trim());
    }
  }
  return out;
}

// Pragmas that only affect upstream's test harness output (logging / eval),
// not the compiler's memoization behaviour. Safe to ignore.
const IGNORED_PRAGMAS = new Set([
  "loggerTestOnly",
  "evaluator",
  "enablePropagateDepsInHIR",
  "enableNewMutationAliasingModel",
  // sprout (eval harness) directive — controls whether the non-Forget baseline
  // is evaluated, not how the compiler runs.
  "disableNonForgetInSprout",
  // legacy snap markers from before parseConfigPragma existed; upstream's
  // current harness ignores them.
  "xonly",
  "Pass",
]);

// Pragmas Bun's `parse_fixture_pragmas` (src/react_compiler/program.rs) reads
// from the leading comment and applies to ReactCompilerOptions / EnvironmentConfig
// before compiling. shouldSkip returns null for these — the compiler honours them.
//
// `parse_fixture_pragmas` is `#[cfg(any(debug_assertions, feature = "fixtures"))]`:
// release builds compile it out, so a fixture whose only observable behaviour
// comes from a pragma-gated EnvironmentConfig flag cannot be checked there.
const HANDLED_PRAGMAS = new Set([
  "flow",
  "script",
  "skip",
  // ReactCompilerOptions
  "compilationMode",
  "panicThreshold",
  "target",
  "ignoreUseNoForget",
  "expectNothingCompiled",
  "gating",
  // EnvironmentConfig
  "enablePreserveExistingMemoizationGuarantees",
  "validatePreserveExistingMemoizationGuarantees",
  "validateExhaustiveMemoizationDependencies",
  "enableOptionalDependencies",
  "enableNameAnonymousFunctions",
  "validateHooksUsage",
  "validateRefAccessDuringRender",
  "validateNoSetStateInRender",
  "enableUseKeyedState",
  "validateNoSetStateInEffects",
  "validateNoDerivedComputationsInEffects",
  "validateNoDerivedComputationsInEffectsExp",
  "validateNoDerivedComputationsInEffects_exp",
  "validateNoJsxInTryStatements",
  "validateNoJSXInTryStatements",
  "validateStaticComponents",
  "validateNoImpureFunctionsInRender",
  "validateNoFreezingKnownMutableFunctions",
  "enableAssumeHooksFollowRulesOfReact",
  "enableTransitivelyFreezeFunctionExpressions",
  "enableFunctionOutlining",
  "enableJsxOutlining",
  "assertValidMutableRanges",
  "throwUnknownExceptionTestonly",
  "throwUnknownException__testonly",
  "enableCustomTypeDefinitionForReanimated",
  "enableTreatRefLikeIdentifiersAsRefs",
  "enableTreatSetIdentifiersAsStateSetters",
  "validateNoVoidUseMemo",
  "enableAllowSetStateFromRefsInEffects",
  "enableVerboseNoSetStateInEffect",
  "enableForest",
  "validateExhaustiveEffectDependencies",
  "validateNoCapitalizedCalls",
  "customMacros",
  "enableEmitHookGuards",
  "enableEmitInstrumentForget",
  "instrumentForget",
  "outputMode",
  "dynamicGating",
]);

// Pragmas `parse_fixture_pragmas` recognises but cannot honour (returns
// `skip: Some(reason)`). The expected output for these depends on config Bun
// can't represent, so the comparison would be meaningless.
const UNSUPPORTED_PRAGMAS = new Set([
  "debug", // snap IR-dump mode; .expect.md is not JS
  "hookPattern",
  "customHooks",
  "moduleTypeProvider",
  "eslintSuppressionRules",
  "validateBlocklistedImports",
  // Bun handles HMR via its own React Refresh transform and never populates
  // `env.code`, so the extra source-hash slot is never emitted (codegen.rs).
  "enableResetCacheOnSourceFileChanges",
  // Upstream test-only pass that walks the generated *Babel* AST post-codegen.
  // Bun emits bun_ast, so the pass is structurally unportable (DESIGN.md).
  "validateSourceLocations",
  // Bails on `$FlowFixMe[react-rule-*]` suppressions. Bun has no Flow comment
  // scanner, so the bailout never fires and error fixtures would mis-compare.
  "enableFlowSuppressions",
  // Selects upstream's pre-HIR reactive-scope fork that Bun never ported.
  "enableReactiveScopesInHIR",
]);

// Fixtures Bun's React Compiler integration cannot run yet.
function shouldSkip(relPath: string, pragmas: Pragmas): string | null {
  // Flow syntax: Bun has no Flow parser. `relPath` is the fixture stem (no ext).
  if (relPath.endsWith(".flow") || pragmas.has("flow")) return "flow";
  // fbt: Meta-internal i18n JSX, unsupported.
  if (relPath.startsWith("fbt/") || /\bfbt\b/.test(basename(relPath))) return "fbt";
  // meta-isms: Meta-internal type providers.
  if (relPath.startsWith("meta-isms/")) return "meta-isms";
  // Upstream's own skip pragma.
  if (pragmas.has("skip")) return "@skip";

  // Any remaining pragma maps to an EnvironmentConfig / PluginOptions field
  // Bun cannot set per-invocation yet. Running with the wrong config produces
  // a meaningless diff, so skip until the option lands.
  let needsPragmaSupport = false;
  for (const key of pragmas.keys()) {
    if (IGNORED_PRAGMAS.has(key)) continue;
    if (HANDLED_PRAGMAS.has(key)) {
      needsPragmaSupport = true;
      continue;
    }
    if (UNSUPPORTED_PRAGMAS.has(key)) return `pragma:@${key} (unsupported)`;
    return `pragma:@${key}`;
  }
  if (needsPragmaSupport && !HAS_FIXTURE_PRAGMA_SUPPORT) {
    return "release build (pragma parsing compiled out)";
  }

  return null;
}

// Known divergences from upstream — Bun produces a different (or no) result.
// Grow this from CI; each entry must say why.
// `__proto__: null`: a fixture named "constructor" exists.
const TODO: Record<string, string> = Object.assign(Object.create(null), {});

type Fixture = {
  name: string;
  inputPath: string;
  expectPath: string;
  source: string;
  pragmas: Pragmas;
  skip: string | null;
  todo: string | undefined;
};

function discover(): Fixture[] {
  const out: Fixture[] = [];
  for (const md of new Bun.Glob("**/*.expect.md").scanSync(FIXTURE_ROOT)) {
    // Bun.build output paths are POSIX; normalize so `compiled.get(name)` matches on Windows.
    const stem = md.slice(0, -".expect.md".length).replaceAll("\\", "/");
    let inputPath: string | undefined;
    for (const ext of INPUT_EXTS) {
      const p = join(FIXTURE_ROOT, stem + ext);
      if (existsSync(p)) {
        inputPath = p;
        break;
      }
    }
    if (!inputPath) continue;
    const source = readFileSync(inputPath, "utf8");
    const pragmas = parsePragmas(source);
    out.push({
      name: stem,
      inputPath,
      expectPath: join(FIXTURE_ROOT, md),
      source,
      pragmas,
      skip: shouldSkip(stem, pragmas),
      todo: TODO[stem],
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// `.expect.md` layout: `## Input` fence, then either `## Code` fence (success)
// or `## Error` fence (compile error). Some have a trailing `### Eval output`.
function parseExpect(md: string): { code: string | null; error: string | null } {
  const sections: Record<string, string> = {};
  // Match "## Heading" followed by a fenced block.
  const re = /^## (\w+)\s*\n+```[a-z]*\n([\s\S]*?)\n```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) sections[m[1]] = m[2];
  return { code: sections.Code ?? null, error: sections.Error ?? null };
}

// `sub` appears in `full` in order (not necessarily contiguous).
function isSubsequence(sub: readonly number[], full: readonly number[]): boolean {
  let i = 0;
  for (const v of full) if (i < sub.length && v === sub[i]) i++;
  return i === sub.length;
}

// All `_c(N)` / `useMemoCache(N)` slot counts in source order (the emitted
// callee depends on `@target`).
function slotCounts(src: string): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(/\b(?:_c|useMemoCache)\((\d+)\)/g)) out.push(Number(m[1]));
  return out;
}

const fixtures = discover();
const filtered = FILTER ? fixtures.filter(f => f.name.includes(FILTER)) : fixtures;
// Only fixtures whose assertions actually run get compiled. `todo` fixtures are
// included so a fix flips them to "passing" without a harness change.
const compilable = filtered.filter(f => f.skip == null);

// fixture name -> compiled JS text, or a build-error message.
const compiled = new Map<string, { output: string } | { error: string }>();

// Bun.build aborts the print stage when ANY entrypoint errors, so we can't get
// per-file output from a partially-failing batch. Instead: build, record the
// erroring files from `result.logs`, drop them, and rebuild until the batch is
// clean. In practice this converges in 1-2 rounds (only a handful of fixtures
// are genuine parse errors).
async function compileAll(): Promise<void> {
  const byInput = new Map<string, Fixture>();
  for (const f of compilable) byInput.set(f.inputPath, f);
  let pending = new Set(byInput.keys());

  for (let round = 0; pending.size > 0; round++) {
    if (round > 20) throw new Error(`Bun.build did not converge after ${round} rounds (${pending.size} left)`);

    const result = await Bun.build({
      entrypoints: [...pending],
      root: FIXTURE_ROOT,
      target: "browser",
      format: "esm",
      splitting: false,
      external: ["*"],
      treeShaking: false,
      // @ts-expect-error — wired in JSBundler.rs but not yet in bun-types
      reactCompiler: true,
      reactCompilerParseTestPragmas: true,
      // Upstream's Babel harness enables the TS plugin unconditionally, so
      // many `.js` fixtures contain TS syntax (casts, type params).
      loader: { ".js": "tsx", ".mjs": "tsx" },
      throw: false,
    });

    if (result.success) {
      for (const artifact of result.outputs) {
        if (artifact.kind !== "entry-point") continue;
        // Output path is relative to `root` with a `.js` extension; strip both
        // to recover the fixture stem.
        let stem = artifact.path.replace(/^\.\//, "").replace(/\.js$/, "");
        compiled.set(stem, { output: await artifact.text() });
      }
      return;
    }

    // Attribute every error log to an input file and drop it from the next round.
    let removed = 0;
    for (const log of result.logs) {
      if (log.level !== "error") continue;
      const file = (log as any).position?.file as string | undefined;
      if (!file || !pending.has(file)) continue;
      const f = byInput.get(file)!;
      const prev = compiled.get(f.name);
      const msg = String(log.message ?? log);
      compiled.set(f.name, { error: prev && "error" in prev ? prev.error + "\n" + msg : msg });
      pending.delete(file);
      removed++;
    }
    if (removed === 0) {
      // Unattributable failure — surface the raw logs so the test points at it.
      throw new AggregateError(result.logs, "Bun.build failed with no per-file error attribution");
    }
  }
}

describe("react-compiler upstream fixtures", () => {
  beforeAll(compileAll);

  test("fixture corpus is present", () => {
    // Guards against an accidentally-empty sync.
    expect(fixtures.length).toBeGreaterThan(1000);
  });

  describe.each(filtered.map(f => [f.name, f] as const))("%s", (name, f) => {
    const { pragmas, skip, todo } = f;
    const fn = skip ? test.skip : todo ? test.todo : test.concurrent;

    // Upstream snap harness defaults to `all`; Bun defaults to `infer`. When
    // the effective mode is not `infer` we cannot force Bun to compile, so we
    // only assert when Bun *did* compile.
    const effectiveMode = pragmas.get("compilationMode") ?? "all";
    const modeMatchesBun = effectiveMode === "infer";

    fn(skip ? `SKIP (${skip})` : todo ? `TODO (${todo})` : "compile", async () => {
      const expected = parseExpect(await Bun.file(f.expectPath).text());
      const isErrorFixture =
        expected.error != null ||
        pragmas.has("expectNothingCompiled") ||
        /(^|\/)(error|todo\.error|bail)/.test(basename(name));

      // `@panicThreshold:"none"` on an error-named fixture means upstream
      // expects the compiler to *bail* (skip the function) rather than throw,
      // and the `.expect.md` contains the unmodified input under `## Code`.
      // Either way Bun must not emit a memo cache.
      const isBailFixture =
        pragmas.get("panicThreshold") === "none" && /(^|\/)(error|todo\.error)/.test(basename(name));

      const result = compiled.get(name);
      if (result == null) throw new Error(`no Bun.build result recorded for fixture "${name}"`);
      const output = "output" in result ? result.output : "";
      const buildError = "error" in result ? result.error : null;

      if (SNAPSHOT_BUN_OUTPUT) {
        expect({ buildError, output }).toMatchSnapshot();
      }

      if (isErrorFixture || isBailFixture) {
        // Upstream expects a compile error / bailout. Bun may surface this as a
        // build error or as an unmodified passthrough; either is acceptable, but
        // it must NOT have produced memoized output.
        expect({
          fixture: name,
          slotCounts: slotCounts(output),
          note: "error fixture should not be memoized",
        }).toEqual({ fixture: name, slotCounts: [], note: "error fixture should not be memoized" });
        return;
      }

      // Success fixture.
      expect({ fixture: name, buildError }).toEqual({ fixture: name, buildError: null });

      const want = slotCounts(expected.code ?? "");
      const got = slotCounts(output);

      const wantRuntime = (expected.code ?? "").includes("react/compiler-runtime");
      const gotRuntime = output.includes("react/compiler-runtime");

      // compilationMode mismatch: upstream compiled under `all`, Bun ran under
      // `infer`. Bun may legitimately compile NONE of the functions, or only a
      // SUBSET (e.g. fixture has both an uppercase JSX component `infer` picks
      // up and a lowercase helper only `all` would compile). Accept when Bun's
      // slot list is a subsequence of upstream's; only fall through to strict
      // equality when Bun compiled every function upstream did.
      if (!modeMatchesBun) {
        // A surviving `react/compiler-runtime` import is not evidence a compiled
        // function survived: when the fixture has no `export`, `bun build`
        // tree-shakes the compiled body but the injected import remains. Only
        // `_c(N)` calls prove a memoized function reached the output.
        if (got.length === 0 && (want.length > 0 || wantRuntime)) {
          return; // Bun compiled nothing
        }
        if (got.length > 0 && got.length < want.length && isSubsequence(got, want)) {
          expect({ fixture: name, importsCompilerRuntime: gotRuntime }).toEqual({
            fixture: name,
            importsCompilerRuntime: wantRuntime,
          });
          return; // Bun compiled a strict subset
        }
      }

      expect({
        fixture: name,
        slotCounts: got,
        importsCompilerRuntime: gotRuntime,
      }).toEqual({
        fixture: name,
        slotCounts: want,
        importsCompilerRuntime: wantRuntime,
      });
    });
  });
});
