import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/30932 (and #18477)
//
// Every case in a switch shares one lexical scope but each case is entered
// conditionally, so a `const` declared in one case does not dominate references
// to the same name in sibling cases. Two inlining passes in the parser used to
// ignore this and produced code that silently bypassed the spec-required TDZ
// `ReferenceError`:
//
//   1. const-local-prefix inlining — `const X = literal` in the first case was
//      recorded and every later reference to `X` in the switch body was
//      rewritten to `literal`.
//   2. single-use substitution — `visit_stmts` ran once per case body but
//      `use_count_estimate` is global, so when visiting `case "*"` the
//      counter had only seen `case "*"`s references. `const X = expr` +
//      `return X` read as single-use and the decl was deleted, leaving
//      sibling-case references dangling.
describe("switch-case const does not leak across cases", () => {
  test("literal-initialized const is not inlined into sibling case", () => {
    function test(action: string) {
      switch (action) {
        case "*":
          const CONSTANT = 2;
          return "matched " + CONSTANT;
        case "a":
          return "a=" + CONSTANT;
      }
    }
    expect(() => test("a")).toThrow(ReferenceError);
    expect(test("*")).toBe("matched 2");
  });

  test("non-foldable const is not substituted out of sibling case", () => {
    function test(action: string) {
      switch (action) {
        case "*":
          const X = Math.random();
          return "* " + X;
        case "a":
          return "a " + X;
      }
    }
    // Post-fix JSC raises "Cannot access 'X' before initialization" (TDZ).
    // Pre-fix, Bun deleted the `const X` decl entirely as a single-use
    // substitution while visiting case "*", turning the case "a" reference
    // into an unbound "X is not defined" — also a ReferenceError, but with
    // different semantics — so match on name + message shape.
    expect(() => test("a")).toThrow(
      expect.objectContaining({
        name: "ReferenceError",
        message: expect.stringContaining("before initialization"),
      }),
    );
  });

  test("outer const is shadowed by inner const, not leaked through", () => {
    const CONSTANT = 1;
    function test(action: string) {
      switch (action) {
        case "*":
          const CONSTANT = 2;
          return "* " + CONSTANT;
        case "a":
          return "a " + CONSTANT;
      }
      return "outer=" + CONSTANT;
    }
    // The inner `const CONSTANT` hoists over the entire switch body and
    // shadows the outer one, so touching it from `case "a"` before the
    // `case "*"` declaration has evaluated is TDZ.
    expect(() => test("a")).toThrow(ReferenceError);
    expect(test("*")).toBe("* 2");
    // Outside the switch body the outer `CONSTANT` is still visible.
    expect(test("other")).toBe("outer=1");
  });

  test("const in a nested block inside a case still inlines", () => {
    // The `{}` pushes a fresh scope where `is_after_const_local_prefix`
    // starts false, so the decl goes through the same const-local-prefix
    // inliner a top-level block would — i.e. the switch-body guard does
    // not pessimize nested-block bodies.
    function test() {
      switch ("a") {
        case "a": {
          const X = 42;
          return X;
        }
      }
    }
    expect(test()).toBe(42);
  });

  test("fall-through from declaring case still initializes binding", () => {
    function test() {
      switch ("a") {
        case "a":
          const X = 100;
        case "b":
          return "X=" + X;
      }
    }
    expect(test()).toBe("X=100");
  });
});
