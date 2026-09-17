import { expect, test } from "bun:test";
import {
  isPathExpr,
  parseRustFragment,
  unwrapParens,
  type MethodCall,
  type RustFile,
} from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// An empty `JSValue` is not a value: by JSC convention it means "an exception is
// pending on the VM". A native completion that converts its result to JS can
// see that conversion fail — a `worker.terminate()` landing mid-conversion is
// the common case — and `to_js(..).unwrap_or(JSValue::ZERO)` then hands the
// empty value on to a promise settlement / callback argument / property store,
// where JSC asserts or crashes.
//
// Carry the `JsResult` to the boundary instead:
//   promise.resolve(global, v.unwrap_or(JSValue::ZERO))  → promise.settle(global, v)
//   cb.call(global, this, &[v.unwrap_or(JSValue::ZERO)]) → let Ok(v) = v else { report/return }
//   fn host_getter(..) -> JSValue { v.unwrap_or(ZERO) } → v.or_pending_exception()  (bun_jsc::HostReturn)
//   opt.unwrap_or(JSValue::ZERO)  (an Option<JSValue>)   → opt.unwrap_or_default()
//
// `JSPromise::{resolve,reject}` also refuse an empty value at runtime (they turn
// it into "reject with the pending exception", or bail on a termination); this
// lint keeps the laundering pattern from being written in the first place.
//
// The query looks at every method call: `.unwrap_or(JSValue::ZERO)` with the
// path spelled exactly so, and `.unwrap_or_else(|_| JSValue::ZERO)` whose
// closure ignores its argument and returns that path.

const ZERO = "JSValue::ZERO";

const BANNED: { name: string; matches: (call: MethodCall) => boolean; hint: string }[] = [
  {
    name: "unwrap_or(JSValue::ZERO)",
    matches: call =>
      call.method === "unwrap_or" && call.args.length === 1 && isPathExpr(unwrapParens(call.args[0]), ZERO),
    hint: "carry the JsResult to the boundary (JSPromise::settle / `?` / HostReturn::or_pending_exception); for an Option use unwrap_or_default()",
  },
  {
    name: "unwrap_or_else(|_| JSValue::ZERO)",
    matches: call => {
      if (call.method !== "unwrap_or_else" || call.args.length !== 1) return false;
      const closure = unwrapParens(call.args[0]);
      return (
        closure.kind === "Closure" &&
        closure.params.length === 1 &&
        closure.params[0].pat.kind === "PatWild" &&
        isPathExpr(unwrapParens(closure.body), ZERO)
      );
    },
    hint: "as above",
  },
];

/** Every method call in the file that launders a failed conversion into an empty `JSValue`. */
function findLaunderedJsValues(file: RustFile): { name: string; hint: string; call: MethodCall }[] {
  const out: { name: string; hint: string; call: MethodCall }[] = [];
  for (const call of file.find("MethodCall")) {
    const banned = BANNED.find(b => b.matches(call));
    if (banned) out.push({ name: banned.name, hint: banned.hint, call });
  }
  return out;
}

const sources = rustSources();
const offenders: string[] = [];
for (const src of sources) {
  for (const { name, hint, call } of findLaunderedJsValues(src.file)) {
    offenders.push(`${src.file.location(call)}: ${name} → ${hint}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the spellings it claims to", () => {
  const matches = (snippet: string) => findLaunderedJsValues(parseRustFragment(snippet)).length > 0;
  const banned = [
    "promise.resolve(global, v.unwrap_or(JSValue::ZERO));",
    "cb.call(global, this, &[value.to_js(global).unwrap_or(JSValue::ZERO)]);",
    "let v = result.unwrap_or_else(|_| JSValue::ZERO);",
    // rustfmt-wrapped.
    "let v = value\n    .to_js(global)\n    .unwrap_or(\n        JSValue::ZERO,\n    );",
  ];
  const allowed = [
    "let v = opt.unwrap_or_default();",
    "let v = result.unwrap_or(JSValue::UNDEFINED);",
    "let v = result.unwrap_or_else(|e| report(e));",
    "let v = result.unwrap_or_else(|_| JSValue::UNDEFINED);",
    // Prose about the shape is not the shape.
    "// let v = result.unwrap_or(JSValue::ZERO);",
    'log("result.unwrap_or(JSValue::ZERO)");',
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no JsResult<JSValue> is laundered into an empty JSValue", () => {
  expect(offenders).toEqual([]);
});
