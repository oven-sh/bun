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
// instead (Process_stubEmptyArray in BunProcess.cpp). This lint requires the
// statements following every stored call to be checks of the scope or of the
// result, ending in one that leaves the function or loop body (a check that
// only asserts or logs does not protect the use after it); returning the
// result untouched also counts, since the caller then holds the same contract.
// It models the stored-result flavor only; passing the call inline as an
// argument is a different shape.

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

// Blank out comments and the contents of string and character literals (so
// braces and parens inside them do not take part in matching below), keeping
// every newline so reported line numbers hold.
function stripForScan(content: string): string {
  let out = "";
  let i = 0;
  const blank = (end: number) => {
    out += content.slice(i, end).replace(/[^\n]/g, " ");
    i = end;
  };
  while (i < content.length) {
    const rest = content.slice(i, i + 2);
    if (rest === "//") {
      const eol = content.indexOf("\n", i);
      blank(eol === -1 ? content.length : eol);
    } else if (rest === "/*") {
      const close = content.indexOf("*/", i + 2);
      blank(close === -1 ? content.length : close + 2);
    } else if (rest[0] === '"' || (rest[0] === "'" && !/\w/.test(content[i - 1] ?? ""))) {
      const quote = rest[0]!;
      let j = i + 1;
      while (j < content.length && content[j] !== quote && content[j] !== "\n") j += content[j] === "\\" ? 2 : 1;
      out += quote;
      i++;
      blank(j);
      if (content[j] === quote) {
        out += quote;
        i++;
      }
    } else {
      out += content[i]!;
      i++;
    }
  }
  return out;
}

// Index just past the bracket matching the opener at `open`.
function closeOf(text: string, open: number): number {
  const [opener, closer] = text[open] === "(" ? ["(", ")"] : ["{", "}"];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer && --depth === 0) return i + 1;
  }
  return text.length;
}

type Statement = { condition: string; body: string; end: number; display: string };

// The next statement executed after `from`: closing braces and preprocessor
// directives run nothing and are skipped. An `if` is split into its condition
// and its body (a braced block or a single statement); anything else is a
// single line with an empty condition.
function nextStatement(stripped: string, from: number): Statement {
  const lineEnd = (at: number) => {
    const eol = stripped.indexOf("\n", at);
    return eol === -1 ? stripped.length : eol;
  };
  let i = from;
  for (;;) {
    while (i < stripped.length && /\s/.test(stripped[i]!)) i++;
    if (stripped[i] === "}") i++;
    else if (stripped[i] === "#") i = lineEnd(i);
    else break;
  }
  const firstLine = stripped.slice(i, lineEnd(i)).trim();
  const display = firstLine === "" ? "<end of file>" : firstLine;
  if (!/^if\s*\(/.test(firstLine)) {
    return { condition: "", body: firstLine, end: lineEnd(i), display };
  }
  const conditionEnd = closeOf(stripped, stripped.indexOf("(", i));
  let bodyStart = conditionEnd;
  for (;;) {
    while (bodyStart < stripped.length && /\s/.test(stripped[bodyStart]!)) bodyStart++;
    if (!stripped.startsWith("[[", bodyStart)) break;
    const attributeEnd = stripped.indexOf("]]", bodyStart);
    bodyStart = attributeEnd === -1 ? stripped.length : attributeEnd + 2;
  }
  let end: number;
  if (stripped[bodyStart] === "{") end = closeOf(stripped, bodyStart);
  else {
    const semicolon = stripped.indexOf(";", bodyStart);
    end = semicolon === -1 ? stripped.length : semicolon + 1;
  }
  return { condition: stripped.slice(i, conditionEnd), body: stripped.slice(bodyStart, end), end, display };
}

// `return x;`, `return JSValue::encode(x);`, or the RELEASE_AND_RETURN forms of
// the same: the unexamined result goes straight back to the caller.
function handsOff(statement: string, ident: string): boolean {
  const value = String.raw`(?:${ident}|(?:JSC::)?JSValue::encode\s*\(\s*${ident}\s*\))`;
  return new RegExp(String.raw`^(?:return\s+${value}|RELEASE_AND_RETURN\s*\(\s*\w+\s*,\s*${value}\s*\))\s*;`).test(
    statement,
  );
}

// Returns the statement that fails the rule, or null when the result is
// protected before anything else runs.
function unprotectedUse(stripped: string, from: number, ident: string): string | null {
  const resultTest = new RegExp(String.raw`!\s*${ident}\s*(?:\)|\|\||&&)`);
  for (;;) {
    const statement = nextStatement(stripped, from);
    if (statement.condition === "") {
      if (/^(?:CLEAR_AND_)?RETURN_IF_EXCEPTION\w*\s*\(/.test(statement.body)) return null;
      return handsOff(statement.body, ident) ? null : statement.display;
    }
    if (!/\.exception\(\)/.test(statement.condition) && !resultTest.test(statement.condition)) return statement.display;
    if (/\b(?:return|goto|break|continue)\b|\bRELEASE_AND_RETURN\b/.test(statement.body)) return null;
    // A check that does not leave (an assertion, a log line): the statement
    // after it still has to protect the result.
    if (statement.end <= from) return statement.display;
    from = statement.end;
  }
}

function scanSource(content: string): { line: number; ident: string; next: string }[] {
  const stripped = stripForScan(content);
  const found: { line: number; ident: string; next: string }[] = [];
  for (const m of stripped.matchAll(STORED_CALL)) {
    const ident = m[1]!;
    const next = unprotectedUse(stripped, m.index! + m[0].length, ident);
    if (next === null) continue;
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
const detects: { label: string; ident: string; line: number; next: string; cpp: string }[] = [
  {
    label: "a dereference on the next line",
    ident: "array",
    line: 2,
    next: "array->putDirectIndex(global, 0, existingValue);",
    cpp: `void f() {\n    JSC::JSArray* array = JSC::constructEmptyArray(global, nullptr, 2);\n    array->putDirectIndex(global, 0, existingValue);\n    RETURN_IF_EXCEPTION(scope, {});\n}\n`,
  },
  {
    label: "an unrelated statement before the use",
    ident: "methods",
    line: 2,
    next: "int index = 0;",
    cpp: `void f() {\n    JSArray* methods = constructEmptyArray(globalObject, nullptr, 35);\n\n    int index = 0;\n    methods->putDirectIndex(globalObject, index++, value);\n}\n`,
  },
  {
    label: "a comment standing in for the check",
    ident: "arr",
    line: 2,
    next: "arr->putDirectIndex(globalObject, 0, name);",
    cpp: `void f() {\n    auto arr = JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 2);\n    // RETURN_IF_EXCEPTION\n    arr->putDirectIndex(globalObject, 0, name);\n}\n`,
  },
  {
    label: "assignment to an existing variable",
    ident: "result",
    line: 3,
    next: "result->push(globalObject, value);",
    cpp: `void f() {\n    JSArray* result = nullptr;\n    result = constructEmptyArray(globalObject, nullptr, 0);\n    result->push(globalObject, value);\n}\n`,
  },
  {
    label: "an argument list spanning lines",
    ident: "raw",
    line: 2,
    next: "raw->putDirectIndex(globalObject, 0, value);",
    cpp: `void f() {\n    JSC::JSArray* raw = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(\n        count * 2));\n    raw->putDirectIndex(globalObject, 0, value);\n}\n`,
  },
  {
    label: "a non-branching assertion",
    ident: "array",
    line: 2,
    next: "scope.assertNoExceptionExceptTermination();",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    scope.assertNoExceptionExceptTermination();\n    array->push(globalObject, value);\n}\n`,
  },
  {
    label: "a check whose branch only logs",
    ident: "array",
    line: 2,
    next: "array->push(globalObject, value);",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    if (scope.exception()) [[unlikely]] {\n        dataLogLn("allocation failed");\n    }\n    array->push(globalObject, value);\n}\n`,
  },
  {
    label: "a null test that dereferences the result",
    ident: "array",
    line: 2,
    next: "if (!array->length())",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    if (!array->length())\n        return;\n}\n`,
  },
  {
    label: "a return that dereferences the result",
    ident: "array",
    line: 2,
    next: "return array->length();",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    return array->length();\n}\n`,
  },
  {
    label: "a return that passes the result on",
    ident: "array",
    line: 2,
    next: "return wrap(globalObject, array);",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    return wrap(globalObject, array);\n}\n`,
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
    cpp: `void f() {\n    auto* rawHeaders = JSC::constructEmptyArray(globalObject, nullptr, headers.size() * 2);\n    if (!rawHeaders || scope.exception()) [[unlikely]] {\n        scope.clearExceptionExceptTermination();\n        return;\n    }\n    rawHeaders->push(globalObject, value);\n}\n`,
  },
  {
    label: "a brace-less branch that jumps out",
    cpp: `void f() {\n    JSArray* outArray = constructEmptyArray(globalObject, nullptr, length);\n    if (scope.exception()) [[unlikely]]\n        goto error;\n    outArray->push(globalObject, value);\nerror:\n    return;\n}\n`,
  },
  {
    label: "an assertion on the result followed by the real test",
    cpp: `void f() {\n    val = JSC::constructEmptyArray(globalObject(), nullptr, 0);\n    if (!val) ASSERT_PENDING_EXCEPTION(globalObject());\n    if (!val) return {};\n    this->calls.set(vm(), this, val);\n}\n`,
  },
  {
    label: "a branch whose message contains braces and parens",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr);\n    if (!array) {\n        throwTypeError(globalObject, scope, "expected {} or ()"_s);\n        return {};\n    }\n    array->push(globalObject, value);\n}\n`,
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
    label: "returning the result untouched",
    cpp: `void f() {\n    JSArray* result = constructEmptyArray(globalObject, nullptr);\n    return result;\n}\n`,
  },
  {
    label: "returning the encoded result untouched",
    cpp: `void f() {\n    JSArray* result = constructEmptyArray(globalObject, nullptr);\n    return JSC::JSValue::encode(result);\n}\n`,
  },
  {
    label: "releasing the scope and returning the result untouched",
    cpp: `void f() {\n    auto* array = constructEmptyArray(globalObject, nullptr, 0);\n    RELEASE_AND_RETURN(scope, JSValue::encode(array));\n}\n`,
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
  {
    label: "an offending shape inside a string literal",
    cpp: `void f() {\n    return jsString(vm, "auto* array = constructEmptyArray(globalObject, nullptr); array->push(globalObject, value);"_s);\n}\n`,
  },
];

for (const { label, ident, line, next, cpp } of detects) {
  test(`detects ${label}`, () => {
    expect(scanSource(cpp)).toEqual([{ line, ident, next }]);
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
