// Should not crash
test("abc", () => {
  expect(() => {
    expect(async () => {
      await Bun.sleep(100);
      throw new Error("uh oh!");
    }).toThrow("abc");
  }).toThrow();
}, 50);
