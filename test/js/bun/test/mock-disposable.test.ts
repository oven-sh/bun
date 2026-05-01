import { expect, mock, spyOn, test } from "bun:test";

test("spyOn returns a disposable that calls mockRestore", () => {
  const obj = { method: () => "original" };

  {
    using spy = spyOn(obj, "method").mockReturnValue("mocked");
    expect(obj.method()).toBe("mocked");
    expect(spy).toHaveBeenCalledTimes(1);
  }

  expect(obj.method()).toBe("original");
});

test("mock() returns a disposable that calls mockRestore", () => {
  const fn = mock(() => "original");

  fn();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn[Symbol.dispose]).toBeFunction();
  fn[Symbol.dispose]();
  expect(fn).toHaveBeenCalledTimes(0);
});

test("using with spyOn auto-restores prototype methods", () => {
  class Greeter {
    greet() {
      return "hello";
    }
  }

  {
    using spy = spyOn(Greeter.prototype, "greet").mockReturnValue("hola");
    expect(new Greeter().greet()).toBe("hola");
  }

  expect(new Greeter().greet()).toBe("hello");
});
