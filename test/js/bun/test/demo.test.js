test("lastCall works", () => {
  const fn = jest.fn(v => -v);
  fn(1, 2);

  console.log("fn.mock.lastCall === fn.mock.__proto__");
  console.log(fn.mock.lastCall === fn.mock.__proto__);

  console.log("fn.mock.lastCall === fn.mock");
  console.log(fn.mock.lastCall === fn.mock);
});
