test("doesn't crash", () => {
  expect(typeof Uint8Array !== undefined + "").toBe(true);
  expect(typeof Uint8Array !== "undefine" + "d").toBe(true);
});
