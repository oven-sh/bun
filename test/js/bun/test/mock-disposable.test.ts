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

test("an object made with `new` on a spied class keeps its class after the using block", () => {
  class Greeter {
    greet() {
      return "hello";
    }
  }
  const classes = { Greeter };
  let greeter;

  {
    using spy = spyOn(classes, "Greeter");
    greeter = new classes.Greeter();
    expect(spy).toHaveBeenCalledTimes(1);
  }

  expect(classes.Greeter).toBe(Greeter);
  expect(greeter).toBeInstanceOf(Greeter);
  expect(greeter.greet()).toBe("hello");
});
