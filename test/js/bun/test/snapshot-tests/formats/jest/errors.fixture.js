class CustomError extends Error {
  code = 42;
  constructor(m) {
    super(m);
    this.name = "CustomError";
  }
}
describe("toThrowErrorMatchingSnapshot", () => {
  test("Error", () => {
    expect(() => {
      throw new Error("plain message");
    }).toThrowErrorMatchingSnapshot();
  });
  test("TypeError", () => {
    expect(() => {
      throw new TypeError("type message");
    }).toThrowErrorMatchingSnapshot();
  });
  test("custom error", () => {
    expect(() => {
      throw new CustomError("custom message");
    }).toThrowErrorMatchingSnapshot();
  });
  test("multi-line message", () => {
    expect(() => {
      throw new Error(`first
second
  third`);
    }).toThrowErrorMatchingSnapshot();
  });
  test("empty message", () => {
    expect(() => {
      throw new Error("");
    }).toThrowErrorMatchingSnapshot();
  });
  test("odd characters", () => {
    expect(() => {
      throw new Error("a `b` ${c} \\d \"e\" 'f'");
    }).toThrowErrorMatchingSnapshot();
  });
  test("with a hint", () => {
    expect(() => {
      throw new Error("hinted");
    }).toThrowErrorMatchingSnapshot("the hint");
  });
  test("twice", () => {
    expect(() => {
      throw new Error("one");
    }).toThrowErrorMatchingSnapshot();
    expect(() => {
      throw new Error("two");
    }).toThrowErrorMatchingSnapshot();
  });
  test("a thrown object", () => {
    expect(() => {
      throw { message: "object message", code: 1 };
    }).toThrowErrorMatchingSnapshot();
  });
  test("with a cause", () => {
    expect(() => {
      throw new Error("outer", { cause: new Error("inner") });
    }).toThrowErrorMatchingSnapshot();
  });
  describe("with a cause that is", () => {
    const inherits = (prototype, members) => Object.assign(Object.create(prototype), members);
    const inAnotherRealm = code => require("node:vm").runInNewContext(code);
    // What util.inherits(LegacyError, Error) makes: an instance is a plain object, not an Error.
    function LegacyError(message) {
      this.message = message;
    }
    Object.setPrototypeOf(LegacyError.prototype, Error.prototype);
    const causes = {
      "a string": () => "inner",
      "a String object": () => new String("inner"),
      "a String object with a cause": () => Object.assign(new String("inner"), { cause: new Error("never") }),
      "a String object that inherits Error.prototype": () => Object.setPrototypeOf(new String("inner"), Error.prototype),
      "a plain object": () => ({ message: "inner" }),
      "a plain object with a cause": () => ({ message: "inner", cause: new Error("never") }),
      "an object tagged Error": () => ({ [Symbol.toStringTag]: "Error", message: "inner" }),
      // Jest prints this line when Node 22 or later runs it. To Node 20 and to Bun, a DOMException is no native error.
      "a DOMException": () => new DOMException("inner", "NotFoundError"),
      "an object that inherits Error.prototype": () => inherits(Error.prototype, { message: "inner" }),
      "an instance of an ES5 class that inherits from Error": () => new LegacyError("inner"),
      "a function that inherits Error.prototype": () =>
        Object.setPrototypeOf(Object.assign(function () {}, { message: "inner" }), Error.prototype),
      "a Proxy of an Error": () => new Proxy(new Error("inner"), {}),
      "a Proxy whose getPrototypeOf trap answers Error.prototype": () =>
        new Proxy({ message: "inner" }, { getPrototypeOf: () => Error.prototype }),
      "a Proxy that is its own prototype for 500 calls, then answers Error.prototype": (calls = 0) => {
        const proxy = new Proxy({ message: "inner" }, { getPrototypeOf: () => (calls++ < 500 ? proxy : Error.prototype) });
        return proxy;
      },
      "an Error without a prototype": () => Object.setPrototypeOf(new Error("inner"), null),
      "an Error of another realm": () => inAnotherRealm(`new Error("inner")`),
      "an object that inherits the Error.prototype of another realm": () =>
        inAnotherRealm(`Object.assign(Object.create(Error.prototype), { message: "inner" })`),
      "the first of a chain": () =>
        inherits(Error.prototype, {
          message: "second",
          cause: Object.assign(new DOMException("third"), { cause: "fourth" }),
        }),
    };
    for (const [name, cause] of Object.entries(causes)) {
      test(name, () => {
        expect(() => {
          throw new Error("outer", { cause: cause() });
        }).toThrowErrorMatchingSnapshot();
      });
    }
    test("an object that inherits Error.prototype, through .rejects and .resolves", async () => {
      const thrown = () => new Error("outer", { cause: inherits(Error.prototype, { message: "inner" }) });
      await expect(Promise.reject(thrown())).rejects.toThrowErrorMatchingSnapshot();
      await expect(Promise.resolve(thrown())).resolves.toThrowErrorMatchingSnapshot();
    });
    test("a Proxy whose getPrototypeOf trap throws", () => {
      const cause = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new RangeError("from the trap");
          },
        },
      );
      expect(() => {
        expect(() => {
          throw new Error("outer", { cause });
        }).toThrowErrorMatchingSnapshot();
      }).toThrow(new RangeError("from the trap"));
      expect("the matcher that threw took no entry").toMatchSnapshot();
    });
    test("a Proxy that is its own prototype", () => {
      const cause = new Proxy({}, { getPrototypeOf: () => cause });
      expect(() => {
        expect(() => {
          throw new Error("outer", { cause });
        }).toThrowErrorMatchingSnapshot();
      }).toThrow(RangeError);
    });
  });
  test("rejects", async () => {
    await expect(Promise.reject(new Error("rejected message"))).rejects.toThrowErrorMatchingSnapshot();
  });
  test("async function rejects", async () => {
    await expect(async () => {
      throw new RangeError("async message");
    }).rejects.toThrowErrorMatchingSnapshot();
  });
  test("mixed with toMatchSnapshot", () => {
    expect(1).toMatchSnapshot();
    expect(() => {
      throw new Error("in between");
    }).toThrowErrorMatchingSnapshot();
    expect(3).toMatchSnapshot();
  });
});
describe("promises", () => {
  test("resolves", async () => {
    await expect(Promise.resolve({ r: 1 })).resolves.toMatchSnapshot();
  });
  test("rejects", async () => {
    await expect(Promise.reject(new Error("as a value"))).rejects.toMatchSnapshot();
  });
});
