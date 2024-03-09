import { test, expect, mock, spyOn } from "bun:test";

// This tests that when a mocked function appears in a stack trace
// It doesn't crash when generating the stack trace.
test("#8794", () => {
  const target = {
    a() {
      throw new Error("a");
      return 1;
    },
    method() {
      return target.a();
    },
  };
  spyOn(target, "method");

  for (let i = 0; i < 20; i++) {
    try {
      target.method();
      expect.unreachable();
    } catch (e) {
      e.stack;
      expect(e.stack).toContain("at method ");
      expect(e.stack).toContain("at a ");
    }
    Bun.gc(false);
  }
});
