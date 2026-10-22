import { describe, expect, jest, test } from "bun:test";
import { normalizeBunSnapshot } from "harness";

test("zero args returns an otherwise empty 200 response", () => {
  const response = new Response();
  expect(response.status).toBe(200);
  expect(response.statusText).toBe("");
});

test("calling cancel() on response body doesn't throw", () => {
  expect(() => new Response("").body?.cancel()).not.toThrow();
});

test("undefined args don't throw", () => {
  const response = new Response("", {
    status: undefined,
    statusText: undefined,
    headers: undefined,
  });
  expect(response.status).toBe(200);
  expect(response.statusText).toBe("");
});

test("1-arg form returns a 200 response", () => {
  const response = new Response("body text");

  expect(response.status).toBe(200);
  expect(response.statusText).toBe("");
});

describe("2-arg form", () => {
  test("can fill in status/statusText, and it works", () => {
    const response = new Response("body text", {
      status: 202,
      statusText: "Accepted.",
    });

    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted.");
  });
  test('empty object continues to return 200/""', () => {
    const response = new Response("body text", {});

    expect(response.status).toBe(200);
    expect(response.statusText).toBe("");
  });
});

test("print size", () => {
  expect(normalizeBunSnapshot(Bun.inspect(new Response(Bun.file(import.meta.filename)))), import.meta.dir)
    .toMatchInlineSnapshot(`
    "Response (12.73 KB) {
      ok: true,
      url: "",
      status: 200,
      statusText: "",
      headers: Headers {
        "content-type": "text/javascript;charset=utf-8",
      },
      redirected: false,
      bodyUsed: false,
      FileRef ("<cwd>/test/js/web/fetch/response.test.ts") {
        type: "text/javascript;charset=utf-8"
      }
    }"
  `);
});

test("Response.redirect with invalid arguments should not crash", () => {
  // issue #18414
  // Passing a number as URL and string as init should handle gracefully
  expect(() => (Response as any).redirect(400, "a")).not.toThrow();

  // Test various invalid argument combinations
  expect(() => (Response as any).redirect(42, "test")).not.toThrow();
  expect(() => (Response as any).redirect(true, "string")).not.toThrow();
  expect(() => (Response as any).redirect(null, "init")).not.toThrow();
  expect(() => (Response as any).redirect(undefined, "value")).not.toThrow();
});

test("Response.redirect status code validation", () => {
  // Valid redirect status codes should work
  expect(() => Response.redirect("url", 301)).not.toThrow();
  expect(() => Response.redirect("url", 302)).not.toThrow();
  expect(() => Response.redirect("url", 303)).not.toThrow();
  expect(() => Response.redirect("url", 307)).not.toThrow();
  expect(() => Response.redirect("url", 308)).not.toThrow();

  // Invalid status codes should throw RangeError
  expect(() => Response.redirect("url", 200)).toThrow(RangeError);
  expect(() => Response.redirect("url", 400)).toThrow(RangeError);
  expect(() => Response.redirect("url", 500)).toThrow(RangeError);

  // Status in object should also be validated
  expect(() => Response.redirect("url", { status: 307 })).not.toThrow();
  expect(() => Response.redirect("url", { status: 400 })).toThrow(RangeError);

  // Check that the correct status is set
  expect(Response.redirect("url", 301).status).toBe(301);
  expect(Response.redirect("url", { status: 308 }).status).toBe(308);
});

// https://fetch.spec.whatwg.org/#dom-response-redirect
// `Location` gets the serialization of the parsed url, not the raw input string.
test.each([
  // percent-encoding
  ["http://example.com/a b", "http://example.com/a%20b"],
  ["http://x/é", "http://x/%C3%A9"],
  // ASCII tab and newline are stripped by the URL parser instead of
  // surfacing as a header-validation TypeError
  ["http://x/a\nb", "http://x/ab"],
  ["http://x/a\tb", "http://x/ab"],
  // scheme/host lowercased, default port removed, dot-segments resolved
  ["HTTP://U:P@EX.COM:80/p/../q", "http://U:P@ex.com/q"],
  // empty path serializes as "/"
  ["http://example.com", "http://example.com/"],
  // IDN host is punycode-encoded
  ["http://bücher.example/", "http://xn--bcher-kva.example/"],
])("Response.redirect(%j) serializes the url into Location", (input, expected) => {
  expect(Response.redirect(input).headers.get("location")).toBe(expected);
  // every arity takes the same path into the Location header
  expect(Response.redirect(input, 307).headers.get("location")).toBe(expected);
  expect(Response.redirect(input, { status: 308 }).headers.get("location")).toBe(expected);
});

test("Response.redirect keeps a non-absolute url as-is in Location", () => {
  // Relative redirect targets are documented Bun behavior (see docs/runtime/http).
  expect(Response.redirect("/login").headers.get("location")).toBe("/login");
  expect(Response.redirect("/login?next=1#a").headers.get("location")).toBe("/login?next=1#a");
  // non-ASCII must round-trip, not come back as a latin-1 view of the UTF-8 bytes
  expect(Response.redirect("/café").headers.get("location")).toBe("/café");
});

test("Response.redirect rejects a non-absolute url that is not a valid header value", () => {
  // A code point above U+00FF cannot be a header value, so this throws the same
  // TypeError that `new Headers({ location: "/€" })` does, instead of silently
  // writing a latin-1-corrupted Location ("/â¬").
  expect(() => Response.redirect("/€")).toThrow(new TypeError("Header 'Location' has invalid value"));
  expect(() => Response.redirect("/搜索")).toThrow(new TypeError("Header 'Location' has invalid value"));
});

// https://infra.spec.whatwg.org/#serialize-a-javascript-value-to-a-json-string
describe("Response.json", () => {
  const notSerializable = expect.objectContaining({
    name: "TypeError",
    message: "Value is not JSON serializable",
  });

  describe("when JSON.stringify returns undefined", () => {
    test.each<[string, () => unknown]>([
      ["undefined", () => undefined],
      ["a Symbol", () => Symbol("s")],
      ["a function", () => function () {}],
      ["toJSON returns undefined", () => ({ toJSON() {} })],
      ["toJSON returns a function", () => ({ toJSON: () => function () {} })],
      ["toJSON returns a Symbol", () => ({ toJSON: () => Symbol("s") })],
      ["an inherited toJSON returns undefined", () => Object.create({ toJSON() {} })],
      ["a String object whose toJSON returns undefined", () => Object.assign(new String("s"), { toJSON() {} })],
      ["a callable Proxy", () => new Proxy(function () {}, {})],
      ["a built-in constructor", () => Date],
      ["Function.prototype", () => Function.prototype],
    ])("throws TypeError: %s", (_, make) => {
      const value = make();
      expect(JSON.stringify(value)).toBeUndefined();
      expect(() => Response.json(value)).toThrow(notSerializable);
    });

    test.each<[string, ResponseInit]>([
      ["a status out of range", { status: 99 }],
      ["a null body status", { status: 204 }],
      ["an invalid header name", { headers: { "bad name": "x" } }],
    ])("throws TypeError before it validates init: %s", (_, init) => {
      expect(() => Response.json({ toJSON() {} }, init)).toThrow(notSerializable);
    });

    test("throws TypeError from a subclass and from a detached call", () => {
      class Subclass extends Response {}
      const { json } = Response;
      expect(() => Subclass.json({ toJSON() {} })).toThrow(notSerializable);
      expect(() => json({ toJSON() {} })).toThrow(notSerializable);
    });

    test("calls toJSON once", () => {
      const toJSON = jest.fn();
      expect(() => Response.json({ toJSON })).toThrow(notSerializable);
      expect(toJSON).toHaveBeenCalledTimes(1);
    });
  });

  test.each<[string, () => unknown]>([
    ["a function", () => Object.assign(function () {}, { toJSON: () => ({ a: 1 }) })],
    ["an arrow function", () => Object.assign(() => {}, { toJSON: () => ({ a: 1 }) })],
    ["a bound function", () => Object.assign(function () {}.bind(null), { toJSON: () => ({ a: 1 }) })],
    [
      "a class",
      () =>
        class {
          static toJSON() {
            return { a: 1 };
          }
        },
    ],
  ])("serializes %s that has a toJSON method", async (_, make) => {
    const response = Response.json(make());
    expect({ status: response.status, body: await response.text() }).toEqual({ status: 200, body: '{"a":1}' });
  });

  test("looks up toJSON on a function once", () => {
    const get = jest.fn();
    const fn = Object.defineProperty(function () {}, "toJSON", { get });
    expect(() => Response.json(fn)).toThrow(notSerializable);
    expect(get).toHaveBeenCalledTimes(1);
  });

  describe("a BigInt", () => {
    function withToJSON<T>(toJSON: (this: bigint) => unknown, run: () => T): T {
      Object.defineProperty(BigInt.prototype, "toJSON", { configurable: true, value: toJSON });
      try {
        return run();
      } finally {
        Reflect.deleteProperty(BigInt.prototype, "toJSON");
      }
    }

    test("is serialized by BigInt.prototype.toJSON", async () => {
      const response = withToJSON(
        function () {
          return this.toString();
        },
        () => Response.json(123n),
      );
      expect({ status: response.status, body: await response.text() }).toEqual({ status: 200, body: '"123"' });
    });

    test("throws TypeError when BigInt.prototype.toJSON returns undefined", () => {
      expect(() =>
        withToJSON(
          () => undefined,
          () => Response.json(123n),
        ),
      ).toThrow(notSerializable);
    });

    test("throws the JSON.stringify TypeError when it has no toJSON method", () => {
      const cannotSerializeBigInt = expect.objectContaining({
        name: "TypeError",
        message: "JSON.stringify cannot serialize BigInt.",
      });
      expect(() => Response.json(123n)).toThrow(cannotSerializeBigInt);
      expect(() => Response.json({ n: 123n })).toThrow(cannotSerializeBigInt);
    });
  });

  test("rethrows what toJSON throws", () => {
    const error = new RangeError("from toJSON");
    let thrown: unknown;
    try {
      Response.json({
        toJSON() {
          throw error;
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(error);
  });
});

test("new Response(123, { statusText: 123 }) does not throw", () => {
  // @ts-expect-error
  expect(new Response("123", { statusText: 123 }).statusText).toBe("123");
});

test("new Response(123, { method: 456 }) does not throw", () => {
  // @ts-expect-error
  expect(() => new Response("123", { method: 456 })).not.toThrow();
});

test("handle stack overflow", () => {
  function f0(a1, a2) {
    const v4 = new Response();
    // @ts-ignore
    const v5 = v4.text(a2, a2, v4, f0, f0);
    a1(a1); // Recursive call causes stack overflow
    return v5;
  }
  expect(() => {
    // @ts-ignore
    f0(f0);
  }).toThrow("Maximum call stack size exceeded.");
});

describe("clone()", () => {
  test("does not lock original body when body was accessed before clone", async () => {
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello, world!"));
        controller.close();
      },
    });

    const response = new Response(readableStream);

    // Access body before clone (this triggers the bug in the unfixed version)
    const bodyBeforeClone = response.body;
    expect(bodyBeforeClone?.locked).toBe(false);

    const cloned = response.clone();

    // Both should be unlocked after clone
    expect(response.body?.locked).toBe(false);
    expect(cloned.body?.locked).toBe(false);

    // Both should be readable
    const [originalText, clonedText] = await Promise.all([response.text(), cloned.text()]);

    expect(originalText).toBe("Hello, world!");
    expect(clonedText).toBe("Hello, world!");
  });

  test("works when body is not accessed before clone", async () => {
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello, world!"));
        controller.close();
      },
    });

    const response = new Response(readableStream);

    // Do NOT access body before clone
    const cloned = response.clone();

    // Both should be unlocked after clone
    expect(response.body?.locked).toBe(false);
    expect(cloned.body?.locked).toBe(false);

    // Both should be readable
    const [originalText, clonedText] = await Promise.all([response.text(), cloned.text()]);

    expect(originalText).toBe("Hello, world!");
    expect(clonedText).toBe("Hello, world!");
  });
});
