describe.only("only-outer", () => {
  test("should not run", () => console.log("should not run"));
  describe("only-inner", () => {
    test("should not run", () => console.log("should not run"));
    test.only("should run", () => console.log("should run"));
  });
  test("should not run", () => console.log("should not run"));
});
