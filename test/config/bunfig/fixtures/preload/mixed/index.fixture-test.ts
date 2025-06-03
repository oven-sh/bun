it("the correct file was preloaded", () => {
  expect(globalThis.preload).toBeDefined();
  expect(globalThis.preload).toBeArrayOfSize(1);
  expect(globalThis.preload[0]).toEqual("mixed/preload-test.ts");
});
