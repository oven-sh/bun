test("boxed number", () => {
  expect(new Number(2)).not.toEqual(new Number(1));
  expect(2).not.toEqual(new Number(2));
});
test("boxed symbol", () => {
  expect(Object(Symbol())).not.toEqual(Object(Symbol()));
});
