// The walk that prints an object (console.log, Bun.inspect) does not call a
// native getter of `Expect`, `ExpectStatic` or `ExpectTypeOf`: `callsChainGetter`
// in src/jsc/bindings/bindings.cpp names the three classes. Each getter of
// these answers its own class (`getter: b.self`), so a call changes the object,
// or makes one more object with the same getter and the print does not end.
// A class that gains such a getter has to be named there too.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ClassType, type Getter, OptionalType } from "../../../src/codegen/bindgen-lib-internal.ts";
import * as expectSchema from "../../../src/runtime/test_runner/expect.bind.ts";

const root = join(import.meta.dir, "../../..");

const answersItsClass = (getter: Getter, type: ClassType) =>
  getter.type === type || (getter.type instanceof OptionalType && getter.type.inner === type);

test("callsChainGetter names the classes of expect.bind.ts whose getters answer their own class", () => {
  const classes = Object.entries(expectSchema).filter(
    (entry): entry is [string, ClassType] => entry[1] instanceof ClassType,
  );
  const chains = classes.filter(([, type]) => type.getters.some(getter => answersItsClass(getter, type)));

  const source = readFileSync(join(root, "src/jsc/bindings/bindings.cpp"), "utf8");
  const body = /^static bool callsChainGetter\(.*?^\}/ms.exec(source)?.[0] ?? "";
  const named = Array.from(body.matchAll(/\bJS(\w+)::info\(\)/g), match => match[1]);

  expect({ named: named.toSorted(), declared: chains.map(([name]) => name).toSorted() }).toEqual({
    named: ["Expect", "ExpectStatic", "ExpectTypeOf"],
    declared: ["Expect", "ExpectStatic", "ExpectTypeOf"],
  });
  // The walk asks for the class and not for the name of the getter: a getter of another kind would print as [Getter] too.
  expect(
    chains.flatMap(([name, type]) =>
      [...type.getters.filter(getter => !answersItsClass(getter, type)), ...type.internalFieldAccessors].map(
        accessor => `${name}.${accessor.name}`,
      ),
    ),
  ).toEqual([]);
});

// The other schemas are read as text: some of them load only where the engine's generators are.
test("no other schema declares a getter that answers its own class", () => {
  const schemas = Array.from(new Glob("src/**/*.bind.ts").scanSync({ cwd: root }), file => file.replaceAll("\\", "/"));
  expect(schemas.length).toBeGreaterThan(100);
  // `b.self`, `b.self.optional` and `b.self.nullable`.
  expect(schemas.filter(file => /getter:\s*b\.self\b/.test(readFileSync(join(root, file), "utf8")))).toEqual([
    "src/runtime/test_runner/expect.bind.ts",
  ]);
});
