import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";

describe("Headers initialization", () => {
  test("allows undefined", () => {
    expect(() => new Headers()).not.toThrow();
  });

  describe("with array of header entries", () => {
    test("fails on invalid array-based init", () => {
      expect(() => new Headers([["undici", "fetch"], ["fetch"]])).toThrow(TypeError);
      expect(() => new Headers(["undici", "fetch", "fetch"])).toThrow(TypeError);
      expect(() => new Headers([0, 1, 2])).toThrow(TypeError);
    });

    test("allows even length init", () => {
      const init = [
        ["undici", "fetch"],
        ["fetch", "undici"],
      ];
      expect(() => new Headers(init)).not.toThrow();
    });

    test("fails for event flattened init", () => {
      const init = ["undici", "fetch", "fetch", "undici"];
      expect(() => new Headers(init)).toThrow(TypeError);
    });
  });

  test("with object of header entries", () => {
    const init = {
      undici: "fetch",
      fetch: "undici",
    };
    expect(() => new Headers(init)).not.toThrow();
  });

  test("fails silently if a boxed primitive object is passed", () => {
    /* eslint-disable no-new-wrappers */
    expect(() => new Headers(new Number())).not.toThrow();
    expect(() => new Headers(new Boolean())).not.toThrow();
    expect(() => new Headers(new String())).not.toThrow();
    /* eslint-enable no-new-wrappers */
  });

  test("fails if primitive is passed", () => {
    const expectedTypeError = TypeError;
    expect(() => new Headers(1)).toThrow(expectedTypeError);
    expect(() => new Headers("1")).toThrow(expectedTypeError);
  });

  test("allows some weird stuff (because of webidl)", () => {
    expect(() => {
      new Headers(function () {}); // eslint-disable-line no-new
    }).not.toThrow();

    expect(() => {
      new Headers(Function); // eslint-disable-line no-new
    }).not.toThrow();
  });

  test("allows a myriad of header values to be passed", () => {
    // Headers constructor uses Headers.append

    expect(() => {
      new Headers([
        ["a", ["b", "c"]],
        ["d", ["e", "f"]],
      ]);
    }).not.toThrow();
    expect(() => new Headers([["key", null]])).not.toThrow(); // allow null values
    expect(() => new Headers([["key"]])).toThrow();
    expect(() => new Headers([["key", "value", "value2"]])).toThrow();
  });

  test("accepts headers as objects with array values", () => {
    const headers = new Headers({
      c: "5",
      b: ["3", "4"],
      a: ["1", "2"],
    });

    expect([...headers.entries()]).toEqual([
      ["a", "1,2"],
      ["b", "3,4"],
      ["c", "5"],
    ]);
  });
});

describe("Headers append", () => {
  test("adds valid header entry to instance", () => {
    const headers = new Headers();

    const name = "undici";
    const value = "fetch";
    expect(() => headers.append(name, value)).not.toThrow();
    expect(headers.get(name)).toBe(value);
  });

  test("adds valid header to existing entry", () => {
    const headers = new Headers();

    const name = "undici";
    const value1 = "fetch1";
    const value2 = "fetch2";
    const value3 = "fetch3";
    headers.append(name, value1);
    expect(headers.get(name)).toBe(value1);
    expect(() => headers.append(name, value2)).not.toThrow();
    expect(() => headers.append(name, value3)).not.toThrow();
    expect(headers.get(name)).toEqual([value1, value2, value3].join(", "));
  });

  test("throws on invalid entry", () => {
    const headers = new Headers();

    expect(() => headers.append()).toThrow();
    expect(() => headers.append("undici")).toThrow();
    expect(() => headers.append("invalid @ header ? name", "valid value")).toThrow();
  });
});

describe("Headers delete", () => {
  test("deletes valid header entry from instance", () => {
    const headers = new Headers();

    const name = "undici";
    const value = "fetch";
    headers.append(name, value);
    expect(headers.get(name)).toBe(value);
    expect(() => headers.delete(name)).not.toThrow();
    expect(headers.get(name)).toBeNull();
  });

  test("does not mutate internal list when no match is found", () => {
    const headers = new Headers();
    const name = "undici";
    const value = "fetch";
    headers.append(name, value);
    expect(headers.get(name)).toBe(value);
    expect(() => headers.delete("not-undici")).not.toThrow();
    expect(headers.get(name)).toBe(value);
  });

  test("throws on invalid entry", () => {
    const headers = new Headers();

    expect(() => headers.delete()).toThrow();
    expect(() => headers.delete("invalid @ header ? name")).toThrow();
  });

  // https://github.com/nodejs/undici/issues/2429
  test("`Headers#delete` returns undefined", () => {
    const headers = new Headers({ test: "test" });

    expect(headers.delete("test")).toBeUndefined();
    expect(headers.delete("test2")).toBeUndefined();
  });
});

describe("Headers get", () => {
  test("returns null if not found in instance", () => {
    const headers = new Headers();
    headers.append("undici", "fetch");

    expect(headers.get("not-undici")).toBeNull();
  });

  test("returns header values from valid header name", () => {
    const headers = new Headers();

    const name = "undici";
    const value1 = "fetch1";
    const value2 = "fetch2";
    headers.append(name, value1);
    expect(headers.get(name)).toBe(value1);
    headers.append(name, value2);
    expect(headers.get(name)).toEqual([value1, value2].join(", "));
  });

  test("throws on invalid entry", () => {
    const headers = new Headers();

    expect(() => headers.get()).toThrow();
    expect(() => headers.get("invalid @ header ? name")).toThrow();
  });
});

describe("Headers has", () => {
  test("returns boolean existence for a header name", () => {
    const headers = new Headers();

    const name = "undici";
    headers.append("not-undici", "fetch");
    expect(headers.has(name)).toBe(false);
    headers.append(name, "fetch");
    expect(headers.has(name)).toBe(true);
  });

  test("throws on invalid entry", () => {
    const headers = new Headers();

    expect(() => headers.has()).toThrow();
    expect(() => headers.has("invalid @ header ? name")).toThrow();
  });
});

describe("Headers set", async () => {
  test("sets valid header entry to instance", () => {
    const headers = new Headers();

    const name = "undici";
    const value = "fetch";
    headers.append("not-undici", "fetch");
    expect(() => headers.set(name, value)).not.toThrow();
    expect(headers.get(name)).toBe(value);
  });

  test("overwrites existing entry", () => {
    const headers = new Headers();

    const name = "undici";
    const value1 = "fetch1";
    const value2 = "fetch2";
    expect(() => headers.set(name, value1)).not.toThrow();
    expect(headers.get(name)).toBe(value1);
    expect(() => headers.set(name, value2)).not.toThrow();
    expect(headers.get(name)).toBe(value2);
  });

  test("allows setting a myriad of values", () => {
    const headers = new Headers();

    expect(() => headers.set("a", ["b", "c"])).not.toThrow();
    expect(() => headers.set("b", null)).not.toThrow();
    expect(() => headers.set("c")).toThrow();
    expect(() => headers.set("c", "d", "e")).not.toThrow();
  });

  test("throws on invalid entry", () => {
    const headers = new Headers();

    expect(() => headers.set()).toThrow();
    expect(() => headers.set("undici")).toThrow();
    expect(() => headers.set("invalid @ header ? name", "valid value")).toThrow();
  });

  // https://github.com/nodejs/undici/issues/2431
  test("`Headers#set` returns undefined", () => {
    const headers = new Headers();

    expect(headers.set("a", "b")).toBeUndefined();

    expect(headers.set("c", "d") instanceof Map).toBe(false);
  });
});

describe("Headers forEach", async () => {
  const headers = new Headers([
    ["a", "b"],
    ["c", "d"],
  ]);

  test("standard", () => {
    expect(typeof headers.forEach).toBe("function");

    headers.forEach((value, key, headerInstance) => {
      expect(value === "b" || value === "d").toBeTrue();
      expect(key === "a" || key === "c").toBeTrue();
      expect(headers).toBe(headerInstance);
    });
  });

  test("with thisArg", () => {
    const thisArg = { a: Math.random() };
    headers.forEach(function () {
      expect(this).toBe(thisArg);
    }, thisArg);
  });
});

describe("Headers as Iterable", () => {
  test("should freeze values while iterating", () => {
    const init = [
      ["foo", "123"],
      ["bar", "456"],
    ];
    const expected = [
      ["foo", "123"],
      ["x-x-bar", "456"],
    ];
    const headers = new Headers(init);
    for (const [key, val] of headers) {
      headers.delete(key);
      headers.set(`x-${key}`, val);
    }
    expect([...headers]).toEqual(expected);
  });

  test("returns combined and sorted entries using .forEach()", () => {
    const init = [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
      ["abc", "4"],
      ["b", "5"],
    ];
    const expected = [
      ["a", "1"],
      ["abc", "4"],
      ["b", "2, 5"],
      ["c", "3"],
    ];
    const headers = new Headers(init);
    const that = {};
    let i = 0;
    headers.forEach(function (value, key, _headers) {
      expect(expected[i++]).toEqual([key, value]);
      expect(this).toBe(that);
    }, that);
  });

  test("returns combined and sorted entries using .entries()", () => {
    const init = [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
      ["abc", "4"],
      ["b", "5"],
    ];
    const expected = [
      ["a", "1"],
      ["abc", "4"],
      ["b", "2, 5"],
      ["c", "3"],
    ];
    const headers = new Headers(init);
    let i = 0;
    for (const header of headers.entries()) {
      expect(header).toEqual(expected[i++]);
    }
  });

  test("returns combined and sorted keys using .keys()", () => {
    const init = [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
      ["abc", "4"],
      ["b", "5"],
    ];
    const expected = ["a", "abc", "b", "c"];
    const headers = new Headers(init);
    let i = 0;
    for (const key of headers.keys()) {
      expect(key).toEqual(expected[i++]);
    }
  });

  test("returns combined and sorted values using .values()", () => {
    const init = [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
      ["abc", "4"],
      ["b", "5"],
    ];
    const expected = ["1", "4", "2, 5", "3"];
    const headers = new Headers(init);
    let i = 0;
    for (const value of headers.values()) {
      expect(value).toEqual(expected[i++]);
    }
  });

  test("returns combined and sorted entries using for...of loop", () => {
    const init = [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
      ["abc", "4"],
      ["b", "5"],
      ["d", ["6", "7"]],
    ];
    const expected = [
      ["a", "1"],
      ["abc", "4"],
      ["b", "2, 5"],
      ["c", "3"],
      ["d", "6,7"],
    ];
    let i = 0;
    for (const header of new Headers(init)) {
      expect(header).toEqual(expected[i++]);
    }
  });

  test("validate append ordering", () => {
    const headers = new Headers([
      ["b", "2"],
      ["c", "3"],
      ["e", "5"],
    ]);
    headers.append("d", "4");
    headers.append("a", "1");
    headers.append("f", "6");
    headers.append("c", "7");
    headers.append("abc", "8");

    const expected = [
      ...new Map([
        ["a", "1"],
        ["abc", "8"],
        ["b", "2"],
        ["c", "3, 7"],
        ["d", "4"],
        ["e", "5"],
        ["f", "6"],
      ]),
    ];

    expect([...headers]).toEqual(expected);
  });

  test("always use the same prototype Iterator", () => {
    const HeadersIteratorNext = Function.call.bind(new Headers()[Symbol.iterator]().next);

    const init = [
      ["a", "1"],
      ["b", "2"],
    ];

    const headers = new Headers(init);
    const iterator = headers[Symbol.iterator]();
    expect(HeadersIteratorNext(iterator)).toEqual({ value: init[0], done: false });
    expect(HeadersIteratorNext(iterator)).toEqual({ value: init[1], done: false });
    expect(HeadersIteratorNext(iterator)).toEqual({ value: undefined, done: true });
  });
});

test("arg validation", () => {
  const headers = new Headers();

  // constructor
  expect(() => {
    // eslint-disable-next-line
    new Headers(0);
  }).toThrow(TypeError);

  // get [Symbol.toStringTag]
  expect(() => {
    Object.prototype.toString.call(Headers.prototype);
  }).not.toThrow();

  // toString
  expect(() => {
    Headers.prototype.toString.call(null);
  }).not.toThrow();

  // append
  expect(() => {
    Headers.prototype.append.call(null);
  }).toThrow(TypeError);
  expect(() => {
    headers.append();
  }).toThrow(TypeError);

  // delete
  expect(() => {
    Headers.prototype.delete.call(null);
  }).toThrow(TypeError);
  expect(() => {
    headers.delete();
  }).toThrow(TypeError);

  // get
  expect(() => {
    Headers.prototype.get.call(null);
  }).toThrow(TypeError);
  expect(() => {
    headers.get();
  }).toThrow(TypeError);

  // has
  expect(() => {
    Headers.prototype.has.call(null);
  }).toThrow(TypeError);
  expect(() => {
    headers.has();
  }).toThrow(TypeError);

  // set
  expect(() => {
    Headers.prototype.set.call(null);
  }).toThrow(TypeError);
  expect(() => {
    headers.set();
  }).toThrow(TypeError);

  // forEach
  expect(() => {
    Headers.prototype.forEach.call(null);
  }).toThrow(TypeError);
  expect(() => {
    headers.forEach();
  }).toThrow(TypeError);
  expect(() => {
    headers.forEach(1);
  }).toThrow(TypeError);

  // inspect
  expect(() => {
    Headers.prototype[Symbol.for("nodejs.util.inspect.custom")].call(null);
  }).toThrow(TypeError);
});

describe("function signature verification", async () => {
  test("function length", () => {
    expect(Headers.prototype.append.length, 2);
    expect(Headers.prototype.constructor.length, 0);
    expect(Headers.prototype.delete.length, 1);
    expect(Headers.prototype.entries.length, 0);
    expect(Headers.prototype.forEach.length, 1);
    expect(Headers.prototype.get.length, 1);
    expect(Headers.prototype.has.length, 1);
    expect(Headers.prototype.keys.length, 0);
    expect(Headers.prototype.set.length, 2);
    expect(Headers.prototype.values.length, 0);
    expect(Headers.prototype[Symbol.iterator].length, 0);
    expect(Headers.prototype.toString.length, 0);
  });

  test("function equality", () => {
    expect(Headers.prototype.entries, Headers.prototype[Symbol.iterator]);
    expect(Headers.prototype.toString, Object.prototype.toString);
  });

  test("toString and Symbol.toStringTag", () => {
    expect(Object.prototype.toString.call(Headers.prototype)).toBe("[object Headers]");
    expect(Headers.prototype[Symbol.toStringTag]).toBe("Headers");
    expect(Headers.prototype.toString.call(null)).toBe("[object Null]");
  });
});

test("various init paths of Headers", () => {
  const h1 = new Headers();
  const h2 = new Headers({});
  const h3 = new Headers(undefined);
  expect([...h1.entries()].length).toBe(0);
  expect([...h2.entries()].length).toBe(0);
  expect([...h3.entries()].length).toBe(0);
});

test("invalid headers", () => {
  expect(() => new Headers({ "abcdefghijklmnopqrstuvwxyz0123456789!#$%&'*+-.^_`|~": "test" })).not.toThrow();

  const chars = '"(),/:;<=>?@[\\]{}'.split("");

  for (const char of chars) {
    expect(() => new Headers({ [char]: "test" })).toThrow(TypeError);
  }

  for (const byte of ["\r", "\n", "\t", " ", String.fromCharCode(128), ""]) {
    expect(() => {
      new Headers().set(byte, "test");
    }).toThrow(TypeError);
  }

  for (const byte of ["\0", "\r", "\n"]) {
    expect(() => {
      new Headers().set("a", `a${byte}b`);
    }).toThrow(TypeError);
  }

  expect(() => {
    new Headers().set("a", "\r");
  }).not.toThrow(TypeError);

  expect(() => {
    new Headers().set("a", "\n");
  }).not.toThrow(TypeError);
  expect(() => {
    new Headers().set("a", Symbol("symbol"));
  }).toThrow(TypeError);
});

test("headers that might cause a ReDoS", () => {
  expect(() => {
    // This test will time out if the ReDoS attack is successful.
    const headers = new Headers();
    const attack = "a" + "\t".repeat(500_000) + "\ta";
    headers.append("fhqwhgads", attack);
  }).not.toThrow(TypeError);
});

describe("Headers.prototype.getSetCookie", () => {
  test("Mutating the returned list does not affect the set-cookie list", () => {
    const h = new Headers([
      ["set-cookie", "a=b"],
      ["set-cookie", "c=d"],
    ]);

    const old = h.getSetCookie();
    h.getSetCookie().push("oh=no");
    const now = h.getSetCookie();

    expect(old).toEqual(now);
  });

  // https://github.com/nodejs/undici/issues/1935
  test("When Headers are cloned, so are the cookies (single entry)", async () => {
    await using server = createServer((req, res) => {
      res.setHeader("Set-Cookie", "test=onetwo");
      res.end("Hello World!");
    }).listen(0);

    await once(server, "listening");

    const res = await fetch(`http://localhost:${server.address().port}`);
    const entries = Object.fromEntries(res.headers.entries());

    expect(res.headers.getSetCookie()).toEqual(["test=onetwo"]);
    expect("set-cookie" in entries).toBeTrue();
  });

  test("When Headers are cloned, so are the cookies (multiple entries)", async () => {
    await using server = createServer((req, res) => {
      res.setHeader("Set-Cookie", ["test=onetwo", "test=onetwothree"]);
      res.end("Hello World!");
    }).listen(0);

    await once(server, "listening");

    const res = await fetch(`http://localhost:${server.address().port}`);
    const entries = Object.fromEntries(res.headers.entries());

    expect(res.headers.getSetCookie()).toEqual(["test=onetwo", "test=onetwothree"]);
    expect("set-cookie" in entries).toBeTrue();
  });

  test("When Headers are cloned, so are the cookies (Headers constructor)", () => {
    const headers = new Headers([
      ["set-cookie", "a"],
      ["set-cookie", "b"],
    ]);

    expect([...headers]).toEqual([...new Headers(headers)]);
  });
});

test("When the value is updated, update the cache", () => {
  const expected = [
    ["a", "a"],
    ["b", "b"],
    ["c", "c"],
  ];
  const headers = new Headers(expected);
  expect([...headers]).toEqual(expected);
  headers.append("d", "d");
  expect([...headers]).toEqual([...expected, ["d", "d"]]);
});

test("Symbol.iterator is only accessed once", () => {
  let called = 0;
  const dict = new Proxy(
    {},
    {
      get() {
        called++;

        return function* () {};
      },
    },
  );

  new Headers(dict); // eslint-disable-line no-new
  expect(called).toBe(1);
});

test("Invalid Symbol.iterators", () => {
  expect(() => new Headers({ [Symbol.iterator]: null })).toThrow(TypeError);
  expect(() => new Headers({ [Symbol.iterator]: undefined })).toThrow(TypeError);
});
