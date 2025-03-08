it("the correct file was preloaded", () => {
  expect(globalThis.preload).toBe("simple/preload.ts");
});
