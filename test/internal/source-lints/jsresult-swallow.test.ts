import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  isPathExpr,
  parseRustFragment,
  pathLast,
  unwrapParens,
  type Expr,
  type Local,
  type MethodCall,
  type Node,
  type RustFile,
  type Span,
} from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// A `JsResult` that comes back `Err` means an exception is pending on the VM (or the VM was terminated).
// A frame that observes that and carries on — discarding the result of a call that entered script,
// collapsing the `JsResult` into an `Option`/`bool` on the spot, or taking the exception and dropping it —
// keeps running native code (and often more script) over a state it no longer understands. When the
// exception is a worker's TerminationException that shows up as asserts and use-after-frees far from
// the swallow. Propagate with `?`, or, at a genuine boundary (a uSockets/uWS/timer trampoline), fold it:
// `bun_jsc::task::report_error_or_terminate` / `dispatch::fold`.
//
// The three shapes are queries over the parsed Rust AST (scripts/rust-parser), so a statement is judged
// whole however rustfmt wrapped it, and prose in comments or string literals is never a site.
//
// This is a ratchet: `jsresult-swallow.inventory.json` counts today's offenders per file and pattern.
// New ones fail the test; fixing one requires lowering its count (the test tells you). Regenerate with
// `bun test/internal/source-lints/jsresult-swallow.test.ts --update` (run as a script) only when removing.

const INVENTORY = import.meta.dir + "/jsresult-swallow.inventory.json";
const SCOPED = ["src/jsc/", "src/runtime/", "src/sql_jsc/", "src/http_jsc/", "src/js_parser_jsc/"];

// Calls whose `JsResult` is legitimately discarded at terminal frames: reporting/folding helpers (their
// `Err` is "the VM stopped", already acted on), and throw helpers (their return *is* the `Err` the caller
// is about to propagate by returning empty).
const TERMINAL =
  /^(report_error_or_terminate|uncaught_exception|handle_rejected_promises|throw_value|throw_error|throw_js|throw\w*|reject\w*|resolve\w*|emit_error\w*)$/;

// Calls that enter script, by callee name: a free or associated function (`jsc::from_js_host_call_generic`,
// `JSValue::call_next_tick_1`) or a method (`.call_with_this`, `.delete_property`, `.to_object`).
const ENTERS_SCRIPT =
  /^(from_js\w*|call\w*|call_check_slow\w*|from_js_host_call\w*|run_from_js\w*|delete_property|call_next_tick\w*|to_object|call_event_handler|call_write_callback)$/;

const TAKES_EXCEPTION = /^(take_exception|try_take_exception|take_error)$/;

// Spellings of the global object argument.
const GLOBALS = ["global", "global_this", "global_object", "globalThis"];

function isGlobal(expr: Expr): boolean {
  return GLOBALS.some(name => isPathExpr(expr, name));
}

/** The callee name of a `Call` (last path segment) or `MethodCall` (method), else null. */
function calleeName(node: Node): string | null {
  if (node.kind === "MethodCall") return node.method;
  if (node.kind !== "Call") return null;
  const callee = unwrapParens(node.callee);
  return callee.kind === "PathExpr" ? pathLast(callee.path) : null;
}

/** Calls under `root` (`root` included) whose callee name matches `name`. */
function callsNamed(file: RustFile, root: Node, name: RegExp): Node[] {
  return file.findAll(node => {
    const callee = calleeName(node);
    return callee !== null && name.test(callee);
  }, root);
}

/** A call that enters script, including `.for_each(global, ...)` (iteration that calls back into JS). */
function entersScript(node: Node): boolean {
  const callee = calleeName(node);
  if (callee === null) return false;
  if (ENTERS_SCRIPT.test(callee)) return true;
  return callee === "for_each" && node.kind === "MethodCall" && node.args.length > 0 && isGlobal(node.args[0]);
}

/** `let _ = <expr>;` */
function discards(file: RustFile): { local: Local; init: Expr }[] {
  const out: { local: Local; init: Expr }[] = [];
  for (const local of file.find("Local")) {
    if (local.pat.kind === "PatWild" && local.init !== null) out.push({ local, init: local.init });
  }
  return out;
}

function findDiscardedScriptCalls(file: RustFile): Local[] {
  return discards(file)
    .filter(({ init }) => {
      // `let _ = f()?;` has propagated the Err; only the Ok value is discarded.
      if (unwrapParens(init).kind === "Try") return false;
      if (file.findAll(entersScript, init).length === 0) return false;
      return callsNamed(file, init, TERMINAL).length === 0;
    })
    .map(({ local }) => local);
}

/** `.ok()`, or `.unwrap_or_else(|_| ...)`. */
function collapses(call: MethodCall): boolean {
  if (call.method === "ok") return call.args.length === 0;
  if (call.method !== "unwrap_or_else" || call.args.length !== 1) return false;
  const fallback = unwrapParens(call.args[0]);
  return fallback.kind === "Closure" && fallback.params.length === 1 && fallback.params[0].pat.kind === "PatWild";
}

/** The statement (or match arm) a node belongs to, or the node itself at the top of a body. */
function enclosingStatement(file: RustFile, node: Node): Node {
  for (const ancestor of file.ancestors(node)) {
    if (ancestor.kind === "ExprStmt" || ancestor.kind === "Local" || ancestor.kind === "MatchArm") return ancestor;
  }
  return node;
}

// `.ok()` / `.unwrap_or_else(|_| …)` straight off a call taking the global object: the Err is gone
// and native code carries on. (`unwrap_or` on an `Option` and `is_err()`-then-bail are not this.)
// The call and the collapse are judged as one expression, so a chain rustfmt split over several
// lines (`interface\n.get(global, "x")\n.ok()`) counts; the line match this replaced never saw those.
function findCollapsedOnTheSpot(file: RustFile): MethodCall[] {
  return file.find("MethodCall").filter(call => {
    if (!collapses(call)) return false;
    const receiver = unwrapParens(call.receiver);
    if (receiver.kind !== "Call" && receiver.kind !== "MethodCall") return false;
    if (receiver.args.length === 0 || !isGlobal(receiver.args[0])) return false;
    return callsNamed(file, enclosingStatement(file, call), TERMINAL).length === 0;
  });
}

function findDiscardedTakenExceptions(file: RustFile): Local[] {
  return discards(file)
    .filter(({ init }) => callsNamed(file, init, TAKES_EXCEPTION).length > 0)
    .map(({ local }) => local);
}

const PATTERNS: [name: string, find: (file: RustFile) => Span[]][] = [
  ["discarded result of a call that enters script", findDiscardedScriptCalls],
  ["JsResult collapsed on the spot", findCollapsedOnTheSpot],
  ["taken exception discarded", findDiscardedTakenExceptions],
];

type Inventory = Record<string, Record<string, number>>;
const found: Inventory = {};
const sites: { path: string; name: string; message: string }[] = [];

const sources = rustSources({ scope: SCOPED });
for (const src of sources) {
  for (const [name, find] of PATTERNS) {
    for (const site of find(src.file)) {
      const byName = (found[src.path] ??= {});
      byName[name] = (byName[name] ?? 0) + 1;
      sites.push({
        path: src.path,
        name,
        message: `${src.file.location(site)}: ${name}: ${src.file.text(site).replace(/\s+/g, " ")}`,
      });
    }
  }
}

if (process.argv.includes("--update")) {
  const sorted: Inventory = {};
  for (const f of Object.keys(found).sort()) {
    sorted[f] = {};
    for (const n of Object.keys(found[f]).sort()) sorted[f][n] = found[f][n];
  }
  await Bun.write(INVENTORY, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await Bun.file(INVENTORY)
  .json()
  .catch(() => ({}));

describe("JsResult swallowing (ratchet)", () => {
  test("scans a non-empty set of tracked Rust sources", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  test("the queries recognize the spellings they claim to", () => {
    const hits = (name: string, snippet: string) => {
      const [, find] = PATTERNS.find(([n]) => n === name)!;
      return find(parseRustFragment(snippet)).length;
    };
    const banned: [name: string, snippet: string][] = [
      [
        "discarded result of a call that enters script",
        "let _ = jsc::from_js_host_call_generic(global, || { dispatch(global, code) });",
      ],
      [
        "discarded result of a call that enters script",
        "let _ = self.handlers.get().call_event_handler(event, this_value, ctx_value, &[value]);",
      ],
      ["discarded result of a call that enters script", "let _ = JSValue::call_next_tick_1(cb, global, reply);"],
      ["discarded result of a call that enters script", "let _ = unsafe { (*this).run_from_js(global) };"],
      ["discarded result of a call that enters script", "let _ = object.to_object(env.to_js());"],
      ["discarded result of a call that enters script", "let _ = vm.for_each(global, ctx, callback);"],
      // rustfmt-wrapped, and spellings the old line match missed.
      [
        "discarded result of a call that enters script",
        "let _ = self\n    .handlers\n    .get()\n    .call_write_callback(callback, &[]);",
      ],
      ["discarded result of a call that enters script", "let _: JsResult<JSValue> = callback.call(global, this, &[]);"],
      ["JsResult collapsed on the spot", "self.clone(global_this).ok()"],
      ["JsResult collapsed on the spot", "let n = value.to_number(global).ok();"],
      ["JsResult collapsed on the spot", 'obj.get(global, "x").unwrap_or_else(|_| JSValue::UNDEFINED)'],
      ["JsResult collapsed on the spot", "(self.get(global_object)).ok()"],
      ["JsResult collapsed on the spot", "value\n    .to_number(globalThis)\n    .ok()"],
      ["taken exception discarded", "let _ = global_object.try_take_exception();"],
      ["taken exception discarded", "let _ = scope.take_exception();"],
      ["taken exception discarded", "let _ = unsafe { (*vm).take_error() };"],
    ];
    const allowed: [name: string, snippet: string][] = [
      // Propagated, folded at a boundary, or bound: the Err is acted on.
      ["discarded result of a call that enters script", "let _ = callback.call(global, this, &[])?;"],
      [
        "discarded result of a call that enters script",
        "let _ = callback\n    .call(global, this, &[])\n    .map_err(|e| e)?;",
      ],
      [
        "discarded result of a call that enters script",
        "let _ = callback.call(global, this, &[]).unwrap_or_else(|_| throw_value(global));",
      ],
      [
        "discarded result of a call that enters script",
        "let _ = promise.call(global, &[]).map_err(|e| vm.report_error_or_terminate(e));",
      ],
      ["discarded result of a call that enters script", "let result = callback.call(global, this, &[]);"],
      ["discarded result of a call that enters script", "let _ = socket.write(&bytes);"],
      ["JsResult collapsed on the spot", "self.throw_if_body_unusable(global_this).ok()?;"],
      [
        "JsResult collapsed on the spot",
        "value.to_number(global).unwrap_or_else(|e| { vm.report_error_or_terminate(e); 0.0 })",
      ],
      ["JsResult collapsed on the spot", "value.to_number(global).unwrap_or(0.0)"],
      ["JsResult collapsed on the spot", "self.map.get(key).ok()"],
      ["JsResult collapsed on the spot", "if value.to_number(global).is_err() { return; }"],
      ["taken exception discarded", "let exception = global_object.try_take_exception();"],
      ["taken exception discarded", "if let Some(e) = scope.take_exception() { vm.report_error_or_terminate(e); }"],
      ["taken exception discarded", "let _ = scope.take_exception_count();"],
      // Prose about the shape is not the shape.
      ["discarded result of a call that enters script", "// let _ = callback.call(global, this, &[]);"],
      ["JsResult collapsed on the spot", 'log("self.clone(global_this).ok()");'],
      ["taken exception discarded", "// let _ = scope.take_exception();"],
    ];
    expect(banned.map(([name, snippet]) => hits(name, snippet))).toEqual(banned.map(() => 1));
    expect(allowed.map(([name, snippet]) => hits(name, snippet))).toEqual(allowed.map(() => 0));
  });

  test("no new swallowed JsResult", () => {
    const grown: string[] = [];
    for (const [f, byName] of Object.entries(found)) {
      for (const [name, count] of Object.entries(byName)) {
        const allowed = inventory[f]?.[name] ?? 0;
        if (count > allowed) {
          grown.push(`${f}: "${name}" ${allowed} → ${count}`);
          for (const s of sites) if (s.path === f && s.name === name) grown.push("    " + s.message);
        }
      }
    }
    expect(
      grown,
      "propagate with `?`, or fold at a real boundary (report_error_or_terminate / dispatch::fold) — see the header of this test",
    ).toEqual([]);
  });

  test("inventory shrinks when a swallow is fixed", () => {
    const stale: string[] = [];
    for (const [f, byName] of Object.entries(inventory)) {
      for (const [name, allowed] of Object.entries(byName)) {
        const count = found[f]?.[name] ?? 0;
        if (count < allowed) stale.push(`${f}: "${name}" is ${count} now, inventory says ${allowed} — lower it`);
      }
    }
    expect(stale).toEqual([]);
  });
});
