import { describe, expect, test } from "bun:test";
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
  const inspected = normalizeBunSnapshot(Bun.inspect(new Response(Bun.file(import.meta.filename))));
  expect(inspected.replace(/\([\d.]+ KB\)/, "(<size> KB)")).toMatchInlineSnapshot(`
    "Response (<size> KB) {
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

test("Response.redirect accepts a redirect status as a string", () => {
  const redirect = (status: unknown) => (Response as any).redirect("http://x/", status).status;
  expect(redirect("307")).toBe(307);
  expect(redirect("301")).toBe(301);
  for (const status of ["9999", "404", "abc", "", true, false, undefined, null]) {
    expect(redirect(status)).toBe(302);
  }
});

test("Response.redirect defaults to 302 when the ResponseInit has no status", () => {
  expect(Response.redirect("http://x/", {}).status).toBe(302);
  const response = Response.redirect("http://x/", { headers: { "Set-Cookie": "sid=1" } });
  expect(response.status).toBe(302);
  expect(response.headers.get("Set-Cookie")).toBe("sid=1");
  expect(response.headers.get("Location")).toBe("http://x/");
  expect(Response.redirect("http://x/", { status: 200 }).status).toBe(200);
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

test.each([
  ['""', () => Response.redirect("")],
  ['"", 307', () => Response.redirect("", 307)],
  ['"", { headers }', () => Response.redirect("", { headers: { "x-extra": "1" } })],
])("Response.redirect(%s) has an empty Location header", (_, redirect) => {
  const { headers } = redirect();
  expect(headers.has("location")).toBe(true);
  expect(headers.get("location")).toBe("");
  expect([...headers]).toContainEqual(["location", ""]);
  expect(new Headers(headers).get("location")).toBe("");
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
  test.each<[string, () => unknown]>([
    ["undefined", () => undefined],
    ["a Symbol", () => Symbol("s")],
    ["a function", () => function () {}],
    ["an object whose toJSON returns undefined", () => ({ toJSON() {} })],
    ["an object whose toJSON returns a function", () => ({ toJSON: () => function () {} })],
    ["a callable Proxy", () => new Proxy(function () {}, {})],
    ["a built-in constructor", () => Date],
  ])("throws a TypeError for %s", (_, make) => {
    expect(() => Response.json(make())).toThrow(new TypeError("Value is not JSON serializable"));
  });

  test.each<[string, () => unknown]>([
    ["a function", () => Object.assign(function () {}, { toJSON: () => ({ a: 1 }) })],
    ["an arrow function", () => Object.assign(() => {}, { toJSON: () => ({ a: 1 }) })],
    ["a class", () => Object.assign(class {}, { toJSON: () => ({ a: 1 }) })],
  ])("serializes %s that has a toJSON method", async (_, make) => {
    const response = Response.json(make());
    expect({ status: response.status, body: await response.text() }).toEqual({ status: 200, body: '{"a":1}' });
  });

  test("serializes a BigInt with BigInt.prototype.toJSON", async () => {
    Object.defineProperty(BigInt.prototype, "toJSON", {
      configurable: true,
      value(this: bigint) {
        return this.toString();
      },
    });
    try {
      expect(await Response.json(123n).text()).toBe('"123"');
    } finally {
      Reflect.deleteProperty(BigInt.prototype, "toJSON");
    }
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

test("handle stack overflow", async () => {
  // Calls text() with the JS stack exhausted. Only the deepest frames create a Response, because
  // creating one in every frame takes several seconds on a debug build.
  const overflows: unknown[] = [];
  const texts: Promise<string>[] = [];
  function recurse() {
    try {
      recurse();
    } catch (e) {
      overflows.push(e);
    }
    if (texts.length < 32) {
      texts.push(new Response().text());
    }
  }
  recurse();

  expect(overflows.map(String)).toEqual(["RangeError: Maximum call stack size exceeded."]);
  expect(await Promise.all(texts)).toEqual(new Array(32).fill(""));
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

describe("a fetched Response", () => {
  function serveRedirects() {
    return Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname === "/redirect") {
          return new Response(null, { status: 302, headers: { Location: "/target#section" } });
        }
        return new Response("<div>hi</div>");
      },
    });
  }

  test('has type "basic"', async () => {
    using server = serveRedirects();
    const response = await fetch(server.url);
    expect(response.type).toBe("basic");
    expect(response.clone().type).toBe("basic");
    expect(new HTMLRewriter().transform(response).type).toBe("basic");
    expect((await fetch(new URL("/redirect", server.url))).type).toBe("basic");
    expect((await fetch(new URL("/redirect", server.url), { redirect: "manual" })).type).toBe("basic");
    expect((await fetch("data:text/plain,hello")).type).toBe("basic");
    expect((await fetch(Bun.pathToFileURL(import.meta.path))).type).toBe("basic");
    const objectURL = URL.createObjectURL(new Blob(["hello"]));
    try {
      expect((await fetch(objectURL)).type).toBe("basic");
    } finally {
      URL.revokeObjectURL(objectURL);
    }
  });

  test('a constructed Response has type "default"', () => {
    expect(new Response("hi").type).toBe("default");
    expect(new Response(null, { status: 101 }).type).toBe("default");
    expect(Response.json({}).type).toBe("default");
    expect(Response.redirect("http://x/").type).toBe("default");
    expect(new HTMLRewriter().transform(new Response("<div>hi</div>")).type).toBe("default");
    expect(Response.error().type).toBe("error");
  });

  test("has a url without the fragment", async () => {
    using server = serveRedirects();
    const origin = server.url.origin;
    const url = async (input: string | Request) => (await fetch(input)).url;
    expect(await url(`${origin}/p?q=1#frag`)).toBe(`${origin}/p?q=1`);
    expect(await url(`${origin}/p%23a#b#c`)).toBe(`${origin}/p%23a`);
    expect(await url(`${origin}/p#`)).toBe(`${origin}/p`);
    expect(await url(`${origin}/redirect#frag`)).toBe(`${origin}/target`);
    expect(await url(new Request(`${origin}/p#frag`))).toBe(`${origin}/p`);
    expect(await url(`${Bun.pathToFileURL(import.meta.path)}#frag`)).toBe(Bun.pathToFileURL(import.meta.path).href);
  });

  test("ignores the fragment of a data: URL", async () => {
    const response = await fetch("data:text/plain,hello#frag");
    expect(response.url).toBe("data:text/plain,hello");
    expect(await response.text()).toBe("hello");
    expect(await (await fetch("data:text/plain,a%23b#frag")).text()).toBe("a#b");
    expect(await (await fetch("data:text/plain;base64,aGVsbG8=#frag")).text()).toBe("hello");
  });

  test("ignores the fragment of a blob: URL", async () => {
    const objectURL = URL.createObjectURL(new Blob(["hello"]));
    try {
      const response = await fetch(`${objectURL}#frag`);
      expect(response.url).toBe(objectURL);
      expect(await response.text()).toBe("hello");
    } finally {
      URL.revokeObjectURL(objectURL);
    }
  });

  test("keeps `#` in the key of an s3: URL", async () => {
    let requested = "";
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        requested = new URL(req.url).pathname;
        return new Response("object");
      },
    });
    const response = await fetch("s3://bucket/a#b", {
      s3: { endpoint: server.url.origin, accessKeyId: "id", secretAccessKey: "secret", region: "us-east-1" },
    });
    expect(await response.text()).toBe("object");
    expect(requested).toBe("/bucket/a%23b");
  });
});
