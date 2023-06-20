test("works on functions", () => {
  var obj = {
    original() {
      return 42;
    },
  };
  const fn = jest.spyOn(obj, "original");
  expect(fn).toBe(obj.original);
  expect(fn).not.toHaveBeenCalled();
  expect(() => expect(fn).toHaveBeenCalled()).toThrow();
  expect(obj.original()).toBe(42);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(() => expect(fn).not.toHaveBeenCalled()).toThrow();
  expect(() => expect(fn).not.toHaveBeenCalledTimes(1)).toThrow();
  expect(fn.mock.calls).toHaveLength(1);
  expect(fn.mock.calls[0]).toBeEmpty();
  jest.restoreAllMocks();
  expect(() => expect(obj.original).toHaveBeenCalled()).toThrow();
});
