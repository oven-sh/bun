it("the correct file was preloaded", () => {
  expect(globalThis.preload).toBe([
    // order is important b/c it shows what was loaded first
    "mixed/preload-all.ts",
    "mixed/preload-test.ts",
  ]);
});
