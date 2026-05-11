// Should not crash
test("abc", () => {
  expect(async () => {
    await Bun.sleep(100);
    throw new Error("uh oh!");
  }).toThrow("uh oh!");
}, 50);
