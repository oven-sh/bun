/** Unit tests for the `$macro(...)` expansion that bundle-modules.ts and
 * bundle-functions.ts apply to the builtin JS in src/js
 * (src/codegen/builtin-parser.ts + src/codegen/replacements.ts). Nothing here
 * needs the built binary: the preprocessor is plain TypeScript run at build time. */
import { describe, expect, test } from "bun:test";

import { sliceSourceCode } from "../../../src/codegen/builtin-parser.ts";
import { function_replacements } from "../../../src/codegen/replacements.ts";

/** One well-formed call per macro and what it expands to. The native macros
 * are resolved against the real tree (generate-js2native.ts), so their
 * arguments name files that exist in src/. */
const macros: [macro: string, args: string, expansion: string | RegExp][] = [
  ["$debug", `("x")`, `(IS_BUN_DEVELOPMENT?$debug_log("x"):void 0)`],
  ["$assert", `(ok, "x")`, `!(IS_BUN_DEVELOPMENT?$assert(ok,"ok", "x"):void 0)`],
  ["$rust", `("node_util_binding.rs", "internalErrorName")`, /^__intrinsic__lazy\(\d+\)$/],
  ["$newRustFunction", `("node_util_binding.rs", "internalErrorName", 1)`, /^__intrinsic__lazy\(\d+\)$/],
  ["$cpp", `("NodeValidator.cpp", "validateInteger")`, /^__intrinsic__lazy\(\d+\)$/],
  ["$newCppFunction", `("NodeValidator.cpp", "validateInteger", 4)`, /^__intrinsic__lazy\(\d+\)$/],
  ["$bindgenFn", `("bindgen_test.bind.ts", "add")`, /^__intrinsic__lazy\(\d+\)$/],
  ["$isPromisePending", `(p)`, `(__intrinsic__peekPromiseStatus(p) === 0)`],
  ["$isPromiseFulfilled", `(p)`, `(__intrinsic__peekPromiseStatus(p) === 1)`],
  ["$isPromiseRejected", `(p)`, `(__intrinsic__peekPromiseStatus(p) === 2)`],
];

function expand(code: string): string {
  const { result, rest } = sliceSourceCode(`{ const v = ${code}; }`, true);
  expect(rest).toBe("");
  expect(result).toStartWith("{ const v = ");
  expect(result).toEndWith("; }");
  return result.slice("{ const v = ".length, -"; }".length);
}

test("every macro the preprocessor expands is covered below", () => {
  expect(macros.map(([macro]) => macro).sort()).toEqual([...function_replacements].sort());
});

describe.each(macros)("%s", (macro, args, expansion) => {
  test("a plain call is expanded", () => {
    const expanded = expand(`${macro}${args}`);
    if (typeof expansion === "string") {
      expect(expanded).toBe(expansion);
    } else {
      expect(expanded).toMatch(expansion);
    }
  });

  // private.d.ts used to declare the native macros as generic, so
  // `$newRustFunction<() => number>(...)` type-checked, and the preprocessor
  // only looked for `$name(`: the call went into the bundle unexpanded and the
  // native side was never registered, which only surfaced later as a dead-code
  // error in cargo or as a module that fails to load.
  test("a call with type arguments is a bundle-time error", () => {
    expect(() => expand(`${macro}<() => number>${args}`)).toThrow(
      `${macro} does not accept type arguments; only '${macro}(' is expanded at bundle time. ` +
        `Cast the result instead: '${macro}(...) as T'. Found: '${macro}<() => number>${args}`,
    );
  });
});

test("type arguments inside strings and comments are not code", () => {
  const code = `{ const s = "$rust<T>(a, b)"; /* $cpp<T>(a, b) */ // $newRustFunction<T>(a, b, 0)\n}`;
  expect(sliceSourceCode(code, true)).toEqual({ result: code, rest: "" });
});

test("a macro name that is not being called passes through as a plain intrinsic", () => {
  // `$debug` is also a value: bundle-modules defines `__intrinsic__debug` to the
  // debug-logging flag, so `if ($debug)` is a real pattern in src/js.
  expect(expand(`$debug && !handle`)).toBe(`__intrinsic__debug && !handle`);
});

test("a bare reference earlier in the same chunk does not hijack the call being expanded", () => {
  expect(expand(`$debug && $debug("x")`)).toBe(`__intrinsic__debug && (IS_BUN_DEVELOPMENT?$debug_log("x"):void 0)`);
  expect(expand(`$assert && $debug("x")`)).toBe(`__intrinsic__assert && (IS_BUN_DEVELOPMENT?$debug_log("x"):void 0)`);
});
