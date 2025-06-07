test("constant fold ==", () => {
  // @ts-expect-error
  expect("0" + "1" == 0).toBe(false);
});
