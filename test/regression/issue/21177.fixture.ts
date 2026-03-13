describe("False assertion", () => {
  beforeAll(() => {
    console.log("Running False assertion tests...");
  });

  test("false is false", () => {
    expect(false).toBe(false);
  });
});

describe("True assertion", () => {
  test("true is true", () => {
    expect(true).toBe(true);
  });
});
