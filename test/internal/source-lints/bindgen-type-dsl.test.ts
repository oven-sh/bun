import { expect, test } from "bun:test";
import type { t as T } from "../../../src/codegen/bindgen-lib.ts";
import type { TypeImpl as TypeImplClass } from "../../../src/codegen/bindgen-lib-internal.ts";

// `TypeImpl` records the `.bind.ts` file that created each type by walking the
// stack for the first frame outside src/codegen. bindgen.ts loads every file
// with `import.meta.require`, which leaves a frame for that walk to find; a
// static ESM import of the DSL evaluates it with no such frame and throws.
const { t } = require("../../../src/codegen/bindgen-lib.ts") as { t: typeof T };
const { TypeImpl } = require("../../../src/codegen/bindgen-lib-internal.ts") as { TypeImpl: typeof TypeImplClass };

// `t` in src/codegen/bindgen-lib.ts is the type DSL that every `*.bind.ts` file
// uses. Its keys are the `TypeKind` set that bindgen-lib-internal.ts switches
// over. A kind that the DSL offers but the lowering cannot handle (an arm that
// throws, or a constructor that produces a different kind than its name) only
// fails when someone writes a `.bind.ts` file that uses it.
const builtins = Object.entries(t).filter((entry): entry is [string, TypeImpl] => entry[1] instanceof TypeImpl);

test("every builtin type in `t` reports its own name as its kind", () => {
  expect(builtins.length).toBeGreaterThan(10);
  for (const [name, type] of builtins) {
    expect(type.kind).toBe(name);
  }
});

test("every builtin type in `t` lowers to a C ABI type", () => {
  for (const [name, type] of builtins) {
    expect(type.canDirectlyMapToCAbi(), name).not.toBeNull();
  }
});

test("the composite constructors produce the kind they are named after", () => {
  expect(t.sequence(t.u8).kind).toBe("sequence");
  expect(t.oneOf(t.u8, t.DOMString).kind).toBe("oneOf");
  expect(t.dictionary({ a: t.u8 }).kind).toBe("dictionary");
  expect(t.stringEnum("a", "b").kind).toBe("stringEnum");
  expect(t.ref("Request").kind).toBe("ref");
});

test("only dictionaries are object types", () => {
  expect(t.dictionary({ a: t.u8 }).isObjectType()).toBe(true);
  expect(t.ref("Request").isObjectType()).toBe(false);
  for (const [, type] of builtins) {
    expect(type.isObjectType()).toBe(false);
  }
});
