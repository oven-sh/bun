import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// JSC::constructEmptyArray (JSGlobalObjectInlines.h) returns nullptr with an
// exception pending when it throws out of memory, and also when its internal
// RETURN_IF_EXCEPTION services a VM trap: a worker.terminate() or vm timeout
// that arrives while the caller runs first surfaces there. A caller that stores
// the result and uses it before checking the scope dereferences null.
// BUN_JSC_validateExceptionChecks does not catch this: putDirectIndex into a
// pre-sized array and putDirect(vm, ..) open no ThrowScope, so a check anywhere
// later in the function satisfies the validator with the dereference before it.
//
// The tree's shape is a check as the very next statement:
//   JSArray* array = constructEmptyArray(globalObject, nullptr, 2);
//   RETURN_IF_EXCEPTION(scope, {});
// Lazy property builders, which cannot propagate, branch on scope.exception()
// instead (Process_stubEmptyArray in BunProcess.cpp). This lint accepts those
// two forms, or a null test of the result. It models the stored-result flavor
// only; passing the call inline as an argument is a different shape.

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

// `ident = [JSC::]constructEmptyArray(...);` whether `ident` is being declared
// or assigned; the argument list may span lines. `(?!=)` keeps `==` out.
const STORED_CALL = /\b(\w+)\s*=(?!=)\s*(?:JSC::)?constructEmptyArray\s*\([^;]*\)\s*;/g;

// Blank out comments but keep every newline so reported line numbers hold.
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, "");
}

// The first line of code executed after the statement ending at `from`.
// Closing braces and preprocessor directives execute nothing, so a check that
// follows them still counts.
function nextStatement(stripped: string, from: number): string {
  let i = from;
  for (;;) {
    while (i < stripped.length && /\s/.test(stripped[i]!)) i++;
    if (stripped[i] === "}") {
      i++;
      continue;
    }
    if (stripped[i] === "#") {
      const eol = stripped.indexOf("\n", i);
      i = eol === -1 ? stripped.length : eol;
      continue;
    }
    break;
  }
  const eol = stripped.indexOf("\n", i);
  return stripped.slice(i, eol === -1 ? stripped.length : eol).trim();
}

function isExceptionCheck(statement: string, ident: string): boolean {
  if (/^(?:CLEAR_AND_)?RETURN_IF_EXCEPTION\w*\s*\(/.test(statement)) return true;
  if (!/^if\s*\(/.test(statement)) return false;
  return /\.exception\(\)/.test(statement) || new RegExp(String.raw`!\s*${ident}\b`).test(statement);
}

function scanSource(content: string): { line: number; ident: string; next: string }[] {
  const stripped = stripComments(content);
  const found: { line: number; ident: string; next: string }[] = [];
  for (const m of stripped.matchAll(STORED_CALL)) {
    const ident = m[1]!;
    const next = nextStatement(stripped, m.index! + m[0].length);
    if (isExceptionCheck(next, ident)) continue;
    const line = stripped.slice(0, m.index!).split("\n").length;
    found.push({ line, ident, next });
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
  for (const { line, ident, next } of scanSource(await file(abs).text())) {
    offenders.push(
      `${source}:${line}: \`${ident} = constructEmptyArray(..)\` is not followed by an exception check (next statement: \`${next}\`) → ` +
        `add RETURN_IF_EXCEPTION(scope, ..) right after it, or branch on scope.exception() in a lazy property builder`,
    );
  }
}

// Self-test fixtures: the scanner must fire on each unchecked shape and stay
// quiet on each shape the tree uses for the check, so a regex that silently
// matches nothing cannot pass the tree-wide test below.
const detects: { label: string; ident: string; line: number; cpp: string }[] = [
  {
    label: "a dereference on the next line",
    ident: "array",
    line: 2,
    cpp: `void f() {\n    JSC::JSArray* array = JSC::constructEmptyArray(global, nullptr, 2);\n    array->putDirectIndex(global, 0, existingValue);\n    RETURN_IF_EXCEPTION(scope, {});\n}\n`,
  },
  {
    label: "an unrelated statement before the use",
    ident: "methods",
    line: 2,
    cpp: `void f() {\n    JSArray* methods = constructEmptyArray(globalObject, nullptr, 35);\n\n    int index = 0;\n    methods->putDirectIndex(globalObject, index++, value);\n}\n`,
  },
  {
    label: "a comment standing in for the check",
    ident: "arr",
    line: 2,
    cpp: `void f() {\n    auto arr = JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 2);\n    // RETURN_IF_EXCEPTION\n    arr->putDirectIndex(globalObject, 0, name);\n}\n`,
  },
  {
    label: "assignment to an existing variable",
    ident: "result",
    line: 3,
    cpp: `void f() {\n    JSArray* result = nullptr;\n    result = constructEmptyArray(globalObject, nullptr, 0);\n    result->push(globalObject, value);\n}\n`,
  },
  {
    label: "an argument list spanning lines",
    ident: "raw",
    line: 2,
    cpp: `void f() {\n    JSC::JSArray* raw = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(\n        count * 2));\n    raw->putDirectIndex(globalObject, 0, value);\n}\n`,
  },
  {
    label: "a non-branching assertion",
    ident: "array",
    line: 2,
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    scope.assertNoExceptionExceptTermination();\n    array->push(globalObject, value);\n}\n`,
  },
];
const ignores: { label: string; cpp: string }[] = [
  {
    label: "RETURN_IF_EXCEPTION on the next line",
    cpp: `void f() {\n    JSC::JSArray* array = JSC::constructEmptyArray(global, nullptr, 2);\n    RETURN_IF_EXCEPTION(scope, {});\n    array->putDirectIndex(global, 0, existingValue);\n}\n`,
  },
  {
    label: "RETURN_IF_EXCEPTION with another scope name and return value",
    cpp: `void f() {\n    JSC::JSArray* array = constructEmptyArray(lexicalGlobalObject, nullptr, count);\n    RETURN_IF_EXCEPTION(throwScope, jsUndefined());\n    return array;\n}\n`,
  },
  {
    label: "a check on the same line",
    cpp: `void f() {\n    auto* values = constructEmptyArray(globalObject, nullptr, 0); RETURN_IF_EXCEPTION(scope, {});\n    return values;\n}\n`,
  },
  {
    label: "the lazy property builder shape",
    cpp: `void f() {\n    JSC::JSArray* array = JSC::constructEmptyArray(processObject->globalObject(), nullptr);\n    if (auto* exception = scope.exception()) [[unlikely]] {\n        (void)scope.tryClearException();\n        return JSC::jsUndefined();\n    }\n    return array;\n}\n`,
  },
  {
    label: "a combined null and scope test",
    cpp: `void f() {\n    auto* rawHeaders = JSC::constructEmptyArray(globalObject, nullptr, headers.size() * 2);\n    if (!rawHeaders || scope.exception()) [[unlikely]] {\n        return;\n    }\n    rawHeaders->push(globalObject, value);\n}\n`,
  },
  {
    label: "a null test of the result",
    cpp: `void f() {\n    val = JSC::constructEmptyArray(globalObject(), nullptr, 0);\n    if (!val) return {};\n    this->calls.set(vm(), this, val);\n}\n`,
  },
  {
    label: "a check after the block that assigned the result",
    cpp: `void f() {\n    if (!array) {\n        array = constructEmptyArray(globalObject, nullptr);\n    }\n    RETURN_IF_EXCEPTION(scope, {});\n    array->push(globalObject, value);\n}\n`,
  },
  {
    label: "a check after a preprocessor directive",
    cpp: `void f() {\n#if OS(WINDOWS)\n    JSArray* keyArray = constructEmptyArray(globalObject, nullptr, count);\n#endif\n    RETURN_IF_EXCEPTION(scope, {});\n    return keyArray;\n}\n`,
  },
  {
    label: "the call used inline rather than stored, which this lint does not model",
    cpp: `void f() {\n    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));\n}\n`,
  },
  {
    label: "a comparison rather than an assignment",
    cpp: `void f() {\n    if (array == constructEmptyArray(globalObject, nullptr)) {\n    }\n    array->push(globalObject, value);\n}\n`,
  },
  {
    label: "an offending shape inside a block comment",
    cpp: `void f() {\n    /*\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    array->push(globalObject, value);\n    */\n}\n`,
  },
];

for (const { label, ident, line, cpp } of detects) {
  test(`detects ${label}`, () => {
    expect(scanSource(cpp)).toEqual([{ line, ident, next: expect.any(String) }]);
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

test("every stored constructEmptyArray result is exception-checked before use", () => {
  expect(offenders).toEqual([]);
});
