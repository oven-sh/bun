it("handles direct and indirect eval calls properly", async () => {
  const PASS = "PASS";

  // Indirect calls should only be bound to `globalThis`.
  function indirect() {
    return (0, eval)(`bar()`);
  }
  // ❌ Bun was transpiling direct calls to indirect calls.
  // ✅ Direct calls should be able to access upper scopes.
  function direct() {
    return eval(`bar()`);
  }

  function bar() {
    return PASS;
  }

  expect(direct()).toBe(PASS);
  // @ts-ignore
  expect(globalThis.bar).toBeUndefined();
  expect(() => indirect()).toThrow();
});
