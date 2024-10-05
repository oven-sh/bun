describe.only("Parent describe.only", () => {
  describe.skip("skipped child describe", () => {
    test("should not run", () => {
      expect.unreachable();
    });
  });

  describe.todo("todo child describe", () => {
    test("should not run", () => {
      expect.unreachable();
    });
  });

  describe("non-only child describe", () => {
    test("test should run", () => {
      expect().pass();
    });
  });
});
