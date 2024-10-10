describe("desc1", () => {
  beforeAll(() => {
    expect.unreachable();
  });
  test("test1", () => {
    expect.unreachable();
  });
});

describe.only("desc2", () => {
  beforeAll(() => {
    expect().pass();
  });
  test("test2", () => {
    expect().pass();
  });
});
