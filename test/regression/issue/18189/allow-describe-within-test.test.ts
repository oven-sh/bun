let did_run_describe = false;

describe("one", () => {
  test("two", () => {
    describe("three", () => {
      did_run_describe = true;
    });
  });
});
test("four", () => {
  expect(did_run_describe).toBe(true);
});
