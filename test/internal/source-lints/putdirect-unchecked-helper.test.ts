import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A JSC helper that allocates under its own ThrowScope returns null with an
// exception pending when anything inside it throws. Because RETURN_IF_EXCEPTION
// services VM traps, "anything" includes a worker termination request or a vm
// watchdog timeout surfacing at one of the helper's internal checks, so the
// null return is reachable on paths that never visibly throw. Passing such a
// call inline as the value argument of putDirect/putDirectIndex consumes the
// empty JSValue before the caller's RETURN_IF_EXCEPTION runs; putDirectIndex
// dereferences the value in ASSERT(!value.isCustomGetterSetterSlow()) and
// crashes (this was a fuzzer-caught SEGV in createNodePathBinding).
//
// The fix shape, per REVIEW.md ("exception checks after every call that can
// enter JS ... before its result is used"):
//   JSValue v = helper(globalObject, ...);
//   RETURN_IF_EXCEPTION(scope, {});
//   obj->putDirectIndex(globalObject, i, v);
//
// The rules below name the helper families that can return an empty value:
// create*/.toJS taking a global object as the first argument, constructEmptyArray
// (which has RETURN_IF_EXCEPTION(scope, nullptr) inside), and zero-argument
// construct*/create* calls (the scope-capturing local lambdas process.report
// builds its sections with). vm-first helpers like jsString(vm, ...) and
// jsNumber(...) cannot throw and stay fine inline. The Rust flavor of the same
// invariant is linted by empty-jsvalue-laundering.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const cxxSources = globAllSources().cxx;

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// A putDirect/putDirectIndex/putDirectOffset call statement; [^;] lets the
// argument list span lines, ending at the `);` that closes the statement.
const PUT_CALL = /\bputDirect(?:Index|Offset)?\s*\(([^;]*?)\)\s*;/g;

const GLOBALISH = String.raw`(?:globalObject|globalThis|lexicalGlobalObject)\b`;
const BANNED: { name: string; re: RegExp; hint: string }[] = [
  {
    name: "create*(globalObject, ...) inline",
    re: new RegExp(String.raw`(?:^|[\s(,!&*]|->|\.|::)create[A-Z]\w*\s*\(\s*${GLOBALISH}`),
    hint: "hoist into a local and RETURN_IF_EXCEPTION before the putDirect*",
  },
  {
    name: ".toJS(globalObject, ...) inline",
    re: new RegExp(String.raw`(?:->|\.)\s*toJS\s*\(\s*${GLOBALISH}`),
    hint: "hoist into a local and RETURN_IF_EXCEPTION before the putDirect*",
  },
  {
    name: "constructEmptyArray(...) inline",
    re: /(?:^|[\s(,!&*]|::)constructEmptyArray\s*\(/,
    hint: "constructEmptyArray returns null with an exception pending; hoist and RETURN_IF_EXCEPTION before the putDirect*",
  },
  {
    name: "construct*()/create*() inline",
    re: /(?:^|[\s(,!&*])(?:construct|create)[A-Z]\w*\s*\(\s*\)/,
    hint: "a zero-arg scope-capturing helper returns an empty JSValue on exception; hoist and RETURN_IF_EXCEPTION before the putDirect*",
  },
];

const offenders: string[] = [];
let scanned = 0;
for (const abs of cxxSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Blank comments out instead of deleting them so reported line numbers stay accurate.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
  for (const m of stripped.matchAll(PUT_CALL)) {
    const argText = m[1];
    for (const { name, re, hint } of BANNED) {
      if (re.test(argText)) {
        const line = stripped.slice(0, m.index).split("\n").length;
        offenders.push(`${source}:${line}: ${name} → ${hint}`);
      }
    }
  }
}

test("scans a non-empty set of tracked C++ sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("no throwing helper is consumed inline by putDirect* before its exception check", () => {
  expect(offenders).toEqual([]);
});
