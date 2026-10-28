it("the correct file was preloaded", () => {
  expect(globalThis.preload).toBe("relative/preload.ts");
});
