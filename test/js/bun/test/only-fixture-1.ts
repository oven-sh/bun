test.only("only this one should run", () => {
  expect().pass();
});

test("this one should not run #1", () => {
  expect.unreachable();
});

test("this one should not run #2", () => {
  expect.unreachable();
});
