test.failing("no crash", () => {
  expect(() => {
    throw undefined;
  }).toThrow(TypeError);
});
