test.failing("This should fail but it doesnt", () => {
  expect(1).toBe(1);
});

test.failing("This should fail but it doesnt (async)", async () => {
  expect(1).toBe(1);
});
