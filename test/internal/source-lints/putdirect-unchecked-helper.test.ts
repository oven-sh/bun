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
// create*/.toJS taking a global object as the first argument (including
// underscore-qualified extern shims like Bun__Process__createExecArgv, whose
// Rust side returns JSValue::ZERO on a thrown or terminated error),
// constructEmptyArray (which has RETURN_IF_EXCEPTION(scope, nullptr) inside),
// and zero-argument construct*/create* calls (the scope-capturing local lambdas
// process.report builds its sections with).
//
// vm-first calls are deliberately not flagged: the common vm-first builders
// (jsString, jsNumber, constructArch, constructInternalProperty) are infallible,
// and the name alone cannot tell the rare fallible ones apart (constructVersions
// and constructProcessReleaseObject carried scopes and were hoisted by hand), so
// a rule would be mostly false positives. A vm-first helper that gains a throw
// scope needs its inline call sites hoisted by review. The Rust flavor of the
// same invariant is linted by empty-jsvalue-laundering.test.ts.

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
    re: new RegExp(String.raw`(?:^|[\s(,!&*]|->|\.|::)(?:\w+__)?create[A-Z]\w*\s*\(\s*${GLOBALISH}`),
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

// Blank out comments and the contents of string/char literals, preserving every
// newline so reported line numbers match the original file, and preserving code
// after a literal that happens to contain "//" or "/*".
function stripForScan(content: string): string {
  let out = "";
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i]!;
    const next = i + 1 < n ? content[i + 1] : "";
    if (c === "/" && next === "/") {
      while (i < n && content[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n) {
        if (content[i] === "*" && content[i + 1] === "/") {
          out += "  ";
          i += 2;
          break;
        }
        out += content[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    // raw string literal, with optional encoding prefix: (u8|u|U|L)?R"delim( ... )delim"
    const rawPrefix = /^(?:u8|u|U|L)?R"/.exec(content.slice(i, i + 4))?.[0];
    if (rawPrefix !== undefined && !/\w/.test(content[i - 1] ?? "")) {
      const open = content.indexOf("(", i + rawPrefix.length);
      const delim = open === -1 ? null : content.slice(i + rawPrefix.length, open);
      const end = delim === null ? -1 : content.indexOf(`)${delim}"`, open + 1);
      if (delim !== null && end !== -1) {
        const stop = end + delim.length + 2;
        out += content.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop;
        continue;
      }
    }
    if (c === '"' || (c === "'" && !/\d/.test(content[i - 1] ?? ""))) {
      out += c;
      i++;
      while (i < n && content[i] !== c && content[i] !== "\n") {
        out += content[i] === "\\" ? "  " : " ";
        i += content[i] === "\\" ? 2 : 1;
      }
      if (i < n && content[i] === c) {
        out += c;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function scanSource(content: string): { line: number; name: string; hint: string }[] {
  const stripped = stripForScan(content);
  const found: { line: number; name: string; hint: string }[] = [];
  for (const m of stripped.matchAll(PUT_CALL)) {
    const argText = m[1]!;
    for (const { name, re, hint } of BANNED) {
      if (re.test(argText)) {
        const line = stripped.slice(0, m.index).split("\n").length;
        found.push({ line, name, hint });
      }
    }
  }
  return found;
}

const offenders: string[] = [];
let scanned = 0;
for (const abs of cxxSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  for (const { line, name, hint } of scanSource(await file(abs).text())) {
    offenders.push(`${source}:${line}: ${name} → ${hint}`);
  }
}

// Self-test fixtures: every rule must fire on its minimal offending shape (so a
// broken regex or a no-op scanner cannot silently pass) and must stay quiet on
// the hoisted fix shape and on lookalikes that cannot return an empty value.
const detects: { label: string; rule: string; line: number; cpp: string }[] = [
  {
    label: "create* taking the global object first",
    rule: "create*(globalObject, ...) inline",
    line: 2,
    cpp: `void f() {\n    obj->putDirectIndex(globalObject, 0, createFoo(globalObject, false));\n}\n`,
  },
  {
    label: "a call spanning multiple lines",
    rule: "create*(globalObject, ...) inline",
    line: 2,
    cpp: `void f() {\n    binding->putDirectIndex(\n        globalObject,\n        (unsigned)0,\n        Zig::createPath(globalObject, false));\n}\n`,
  },
  {
    label: "method .toJS taking the global object",
    rule: ".toJS(globalObject, ...) inline",
    line: 2,
    cpp: `void f() {\n    array->putDirectIndex(globalObject, i++, request.toJS(globalObject));\n}\n`,
  },
  {
    label: "constructEmptyArray",
    rule: "constructEmptyArray(...) inline",
    line: 2,
    cpp: `void f() {\n    header->putDirect(vm, name, constructEmptyArray(globalObject, nullptr), 0);\n}\n`,
  },
  {
    label: "a zero-arg section builder",
    rule: "construct*()/create*() inline",
    line: 2,
    cpp: `void f() {\n    report->putDirect(vm, name, constructHeader(), 0);\n}\n`,
  },
  {
    label: "an offender after a string literal containing //",
    rule: "construct*()/create*() inline",
    line: 2,
    cpp: `void f() {\n    obj->putDirect(vm, Identifier::fromString(vm, "https://bun.com"_s), constructHeader(), 0);\n}\n`,
  },
  {
    label: "an offender after a multi-line block comment, at its real line",
    rule: "create*(globalObject, ...) inline",
    line: 6,
    cpp: `/*\n * license\n * header\n */\nvoid f() {\n    obj->putDirectIndex(globalObject, 0, createFoo(globalObject));\n}\n`,
  },
  {
    label: "an underscore-qualified extern create* shim",
    rule: "create*(globalObject, ...) inline",
    line: 2,
    cpp: `void f() {\n    header->putDirect(vm, name, JSValue::decode(Bun__Process__createExecArgv(globalObject)), 0);\n}\n`,
  },
  {
    label: 'an offender after a prefixed raw string containing " and //',
    rule: "construct*()/create*() inline",
    line: 3,
    cpp: `void f() {\n    obj->putDirect(vm, name, jsString(vm, u8R"(a " quote and // slashes)"_s), 0);\n    obj->putDirect(vm, other, constructHeader(), 0);\n}\n`,
  },
];
const ignores: { label: string; cpp: string }[] = [
  {
    label: "the hoisted and checked fix shape",
    cpp: `void f() {\n    auto* v = createFoo(globalObject);\n    RETURN_IF_EXCEPTION(scope, {});\n    obj->putDirectIndex(globalObject, 0, v);\n}\n`,
  },
  {
    label: "a vm-first helper, which cannot return empty",
    cpp: `void f() {\n    arr->putDirectIndex(globalObject, 0, createMockResult(vm, globalObject, type, value));\n}\n`,
  },
  {
    label: "jsString(vm, ...) inline",
    cpp: `void f() {\n    obj->putDirect(vm, name, jsString(vm, s), 0);\n}\n`,
  },
  {
    label: "a banned shape inside a comment",
    cpp: `void f() {\n    // obj->putDirectIndex(globalObject, 0, createFoo(globalObject));\n    obj->putDirectIndex(globalObject, 0, v);\n}\n`,
  },
  {
    label: "a banned shape inside a string literal",
    cpp: `void f() {\n    obj->putDirect(vm, name, jsString(vm, "createFoo(globalObject)"_s), 0);\n}\n`,
  },
  {
    label: "a vm-first construct* builder, which this lint does not model",
    cpp: `void f() {\n    array->putDirectIndex(exec, i++, constructInternalProperty(vm, exec, name, value));\n}\n`,
  },
  {
    label: "a banned shape inside a prefixed raw string literal",
    cpp: `void f() {\n    obj->putDirect(vm, name, jsString(vm, LR"(createFoo(globalObject))"_s), 0);\n}\n`,
  },
];

for (const { label, rule, line, cpp } of detects) {
  test(`detects ${label}`, () => {
    expect(scanSource(cpp)).toEqual([{ line, name: rule, hint: expect.any(String) }]);
  });
}
for (const { label, cpp } of ignores) {
  test(`ignores ${label}`, () => {
    expect(scanSource(cpp)).toEqual([]);
  });
}

test("scans a non-empty set of tracked C++ sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("no throwing helper is consumed inline by putDirect* before its exception check", () => {
  expect(offenders).toEqual([]);
});
