import { test, expect } from "bun:test";

// TypeError messages thrown from JSC builtin JavaScript must not leak the
// builtin's private @-prefixed identifiers (e.g. `@call`, `@getWrapForValidIteratorInternalField`)
// into user-visible `error.message`. Release builds already suppress this by
// omitting expression info for builtins; this test guards the ASSERT_ENABLED
// path (debug / ASAN) where builtins do carry expression info.

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected fn to throw");
}

test("%WrapForValidIteratorPrototype%.next on a wrapped iterator with no next method", () => {
  const msg = messageOf(() => Iterator.from({} as any).next());
  expect(msg).not.toContain("@");
  expect(msg).not.toContain("WrapForValidIterator");
  expect(msg).toBe("undefined is not a function");
});

test("%WrapForValidIteratorPrototype%.return with a non-callable return", () => {
  const msg = messageOf(() =>
    Iterator.from({ next: () => ({ done: false, value: 1 }), return: 5 } as any).return(),
  );
  expect(msg).not.toContain("@");
  expect(msg).not.toContain("returnMethod");
  expect(msg).toBe("5 is not a function");
});

test("Iterator.from with a non-callable Symbol.iterator", () => {
  const msg = messageOf(() => Iterator.from({ [Symbol.iterator]: 5 } as any));
  expect(msg).not.toContain("@");
  expect(msg).not.toContain("method");
  expect(msg).toBe("5 is not a function");
});
