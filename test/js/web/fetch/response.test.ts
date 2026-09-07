import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, normalizeBunSnapshot } from "harness";

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
  // this file's own size changes with every edit, so pin only the shape
  const inspected = normalizeBunSnapshot(Bun.inspect(new Response(Bun.file(import.meta.filename)))).replace(
    /^Response \(\d+(?:\.\d+)? KB\)/,
    "Response (<size> KB)",
  );
  expect(inspected).toMatchInlineSnapshot(`
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
  // This should not crash - issue #18414
  // Passing a number as URL and string as init should handle gracefully
  expect(() => Response.redirect(400, "a")).not.toThrow();

  // Test various invalid argument combinations - should not crash
  expect(() => Response.redirect(42, "test")).not.toThrow();
  expect(() => Response.redirect(true, "string")).not.toThrow();
  expect(() => Response.redirect(null, "init")).not.toThrow();
  expect(() => Response.redirect(undefined, "value")).not.toThrow();
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

test("Response.redirect with a ResponseInit checks status the same way as the number form", () => {
  // no `status` member: the redirect default, not the ResponseInit default of 200
  expect(Response.redirect("url", {}).status).toBe(302);
  expect(Response.redirect("url", { statusText: "Found It" }).status).toBe(302);
  const withHeaders = Response.redirect("http://x/", { headers: { "X-A": "1" } });
  expect(withHeaders.status).toBe(302);
  expect(withHeaders.headers.get("X-A")).toBe("1");
  expect(withHeaders.headers.get("Location")).toBe("http://x/");

  // a `status` member goes through the same check as `Response.redirect(url, status)`
  for (const status of [301, 302, 303, 307, 308]) {
    expect(Response.redirect("url", { status }).status).toBe(status);
    expect(Response.redirect("url", { status: String(status) }).status).toBe(status);
  }
  for (const status of [0, 101, 200, 204, 304, 399, 404, 600, NaN, "200"]) {
    expect(() => Response.redirect("url", { status })).toThrow(RangeError);
  }
  // a Response used as the init lends its status, which must still be a redirect status
  expect(() => Response.redirect("url", new Response())).toThrow(RangeError);
  expect(Response.redirect("url", Response.redirect("other", 307)).status).toBe(307);

  // `status` is read once
  let reads = 0;
  const init = {
    get status() {
      reads++;
      return 307;
    },
  };
  expect(Response.redirect("url", init).status).toBe(307);
  expect(reads).toBe(1);
});

test("Response.json(data, status) checks status the same way as Response.json(data, { status })", () => {
  for (const status of [101, 200, 201, 204, 301, 404, 418, 500, 599]) {
    expect(Response.json({}, status).status).toBe(status);
    expect(Response.json({}, { status }).status).toBe(status);
  }
  expect(Response.json({}, 404.9).status).toBe(404);
  for (const status of [0, -1, 99, 100, 103, 199, 600, 999, 65536 + 200, NaN, Infinity, -Infinity]) {
    expect(() => Response.json({}, status)).toThrow(RangeError);
    expect(() => Response.json({}, { status })).toThrow(RangeError);
  }
  // null and undefined still mean "no init"
  expect(Response.json({}, null).status).toBe(200);
  expect(Response.json({}, undefined).status).toBe(200);
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
  expect(() => Response.redirect("/€")).toThrow("Header 'Location' has invalid value: '/€'");
  expect(() => Response.redirect("/搜索")).toThrow("Header 'Location' has invalid value: '/搜索'");
});

test("new Response(123, { statusText: 123 }) does not throw", () => {
  // @ts-expect-error
  expect(new Response("123", { statusText: 123 }).statusText).toBe("123");
});

test("new Response(123, { method: 456 }) does not throw", () => {
  // @ts-expect-error
  expect(() => new Response("123", { method: 456 })).not.toThrow();
});

test(
  "handle stack overflow",
  () => {
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
  },
  // one Response and one pending text() per frame until the stack runs out: seconds under ASAN
  isDebug || isASAN ? 30_000 : 5000,
);

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
