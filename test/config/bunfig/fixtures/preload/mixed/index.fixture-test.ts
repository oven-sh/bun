console.log(globalThis.preload);

it("the correct file was preloaded", () => {
  expect(globalThis.preload).toEqual(["mixed/preload-test.ts"]);
});
