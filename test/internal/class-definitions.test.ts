/**
 * `define()` in src/codegen/class-definitions.ts is the input validator for
 * every `*.classes.ts` file that generate-classes.ts turns into C++ and Rust.
 *
 * `call: true` hands the generated `JS<Name>Constructor` a call target, so
 * `Name(...)` without `new` constructs an instance. With `noConstructor: true`
 * no constructor class is generated, and the flag only emitted a thunk and an
 * extern declaration that nothing referenced. `define()` rejects that
 * combination so the inert flag cannot come back.
 */
import { describe, expect, test } from "bun:test";

import { define } from "../../src/codegen/class-definitions.ts";
import jestClasses from "../../src/runtime/test_runner/jest.classes.ts";

describe("define()", () => {
  test("rejects call: true on a class without a constructor", () => {
    expect(() =>
      define({
        name: "NoCtor",
        noConstructor: true,
        call: true,
        klass: {},
        proto: {},
      }),
    ).toThrow("NoCtor: `call: true` has no effect with `noConstructor: true`");
  });

  test("accepts a callable class that has a constructor", () => {
    const def = define({
      name: "WithCtor",
      construct: true,
      call: true,
      klass: {},
      proto: {},
    });
    expect(def).toMatchObject({ name: "WithCtor", call: true, construct: true });
  });

  test("accepts a non-callable class without a constructor", () => {
    const def = define({
      name: "NoCtor",
      noConstructor: true,
      call: false,
      finalize: true,
      klass: {},
      proto: {},
    });
    expect(def).toMatchObject({ name: "NoCtor", call: false, noConstructor: true });
  });

  test("only the jest classes with a constructor are callable", () => {
    expect(jestClasses.filter(def => def.noConstructor && def.call).map(def => def.name)).toEqual([]);
    expect(jestClasses.filter(def => def.call).map(def => def.name)).toEqual(["Expect", "ExpectTypeOf"]);
  });
});
