/**
 * The `$ERR_*(` / `$inherits*(` macro expansion bundle-modules applies to the
 * builtin JS sources (src/codegen/replacements.ts). The error ids must follow
 * the numbering ErrorCode.ts implies (one id per code, then one per extra
 * constructor, in file order), because the C++ side that backs
 * `$makeErrorWithCode` is generated from the same list.
 */
import { expect, test } from "bun:test";

import { sliceSourceCode } from "../../src/codegen/builtin-parser.ts";
import { applyReplacements } from "../../src/codegen/replacements.ts";
import NodeErrors from "../../src/jsc/bindings/ErrorCode.ts";
import jsclasses from "../../src/jsc/bindings/js_classes.ts";

/** Runs the code-chunk replacements over `code` as one chunk. */
function replaceAll(code: string): string {
  const [replaced, rest] = applyReplacements(code, code.length);
  expect(rest).toBe("");
  return replaced as string;
}

/** `{ name: id }` for every `$<name>(` error macro, numbered the way ErrorCode.ts implies. */
function expectedErrorIds(): Map<string, number> {
  const ids = new Map<string, number>();
  let id = 0;
  for (const [code, , , ...extraConstructors] of NodeErrors) {
    if (!ids.has(code)) ids.set(code, id);
    id++;
    for (const ctor of extraConstructors) {
      if (ctor == null) continue;
      const name = `${code}_${ctor.name}`;
      if (!ids.has(name)) ids.set(name, id);
      id++;
    }
  }
  return ids;
}

test("every error code expands to $makeErrorWithCode with its id", () => {
  const ids = expectedErrorIds();
  expect(ids.size).toBeGreaterThan(300);
  for (const [name, id] of ids) {
    expect(replaceAll(` throw $${name}("x");`)).toBe(` throw __intrinsic__makeErrorWithCode(${id}, "x");`);
  }
  // The `<code>_<Constructor>` variants are part of what was just checked.
  const plainCodes = new Set(NodeErrors.map(([code]) => code));
  expect([...ids.keys()].filter(name => !plainCodes.has(name)).length).toBeGreaterThan(0);
});

test("$inherits<Class>( expands to $inherits(<index>, ", () => {
  jsclasses.forEach(([name], index) => {
    expect(replaceAll(` return $inherits${name}(value);`)).toBe(` return __intrinsic__inherits(${index}, value);`);
  });
});

test("unknown intrinsics, non-call uses and mid-identifier dollars are left alone", () => {
  const [firstCode] = NodeErrors[0];
  expect(replaceAll(` $notAnErrorCode(1)`)).toBe(` __intrinsic__notAnErrorCode(1)`);
  // Only calls expand: a bare reference keeps the generic intrinsic spelling.
  expect(replaceAll(` const f = $${firstCode};`)).toBe(` const f = __intrinsic__${firstCode};`);
  // `$` inside an identifier is not a macro.
  expect(replaceAll(` foo$${firstCode}(1)`)).toBe(` foo$${firstCode}(1)`);
  // A longer name that merely starts with a known code is a different (unknown) macro.
  expect(replaceAll(` $${firstCode}_NOT_A_CONSTRUCTOR(1)`)).toBe(` __intrinsic__${firstCode}_NOT_A_CONSTRUCTOR(1)`);
});

test("nested macros expand in one pass and compose with the other rules", () => {
  const ids = expectedErrorIds();
  const [a] = NodeErrors[0];
  const [b] = NodeErrors[1];
  const [klass] = jsclasses[0];
  expect(replaceAll(` f($${a}($${b}(x)), $inherits${klass}(y)); throw new TypeError("t");`)).toBe(
    ` f(__intrinsic__makeErrorWithCode(${ids.get(a)}, __intrinsic__makeErrorWithCode(${ids.get(b)}, x)), ` +
      `__intrinsic__inherits(0, y)); __intrinsic__throwTypeError("t");`,
  );
});

test("sliceSourceCode applies the expansion to code but not to string contents", () => {
  const [code] = NodeErrors[0];
  const id = expectedErrorIds().get(code);
  const { result, rest } = sliceSourceCode(`{ const s = "$${code}("; return $${code}(s); }`, true);
  expect(rest).toBe("");
  expect(result).toBe(`{ const s = "$${code}("; return __intrinsic__makeErrorWithCode(${id}, s); }`);
});
