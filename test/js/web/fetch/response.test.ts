import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeBunSnapshot, tempDirWithFiles } from "harness";
import { join } from "node:path";

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
    "Response (11.70 KB) {
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

// The Content-Type that `new Response(body)` takes from a Blob/File body is
// part of the response from construction on (fetch spec "initialize a
// response"), so it must not depend on whether `.headers` is read before or
// after something moves the body out of its Blob state.
describe("body-derived Content-Type does not depend on access order", () => {
  let dir: string;
  beforeAll(() => {
    dir = tempDirWithFiles("response-content-type", { "page.html": "<p>hi</p>" });
  });
  const file = () => Bun.file(join(dir, "page.html"), { type: "image/png" });
  const blob = () => new Blob(["<p>hi</p>"], { type: "text/x-custom" });

  for (const [name, body, expected] of [
    ["Blob", blob, "text/x-custom"],
    ["Bun.file with type override", file, "image/png"],
  ] as const) {
    describe(name, () => {
      test(".headers first", () => {
        const res = new Response(body());
        expect(res.headers.get("content-type")).toBe(expected);
      });

      test(".body first", () => {
        const res = new Response(body());
        expect(res.body).toBeInstanceOf(ReadableStream);
        expect(res.headers.get("content-type")).toBe(expected);
      });

      test.each(["text", "arrayBuffer", "bytes", "blob"] as const)(".%s() first", async method => {
        const res = new Response(body());
        await res[method]();
        expect(res.headers.get("content-type")).toBe(expected);
      });

      test("new Response(res.body, res)", () => {
        const res = new Response(body());
        const rewrapped = new Response(res.body, res);
        expect(rewrapped.headers.get("content-type")).toBe(expected);
        expect(res.headers.get("content-type")).toBe(expected);
      });

      test("used as ResponseInit, its Content-Type wins over the new body's", () => {
        // Same as `{ headers: res.headers }`: the init's header list already
        // has a Content-Type, so the new body's is not appended.
        const res = new Response(body());
        expect(new Response(new Blob(["x"], { type: "text/plain" }), res).headers.get("content-type")).toBe(expected);
        expect(new Response("x", res).headers.get("content-type")).toBe(expected);
      });

      test("used as RequestInit", () => {
        const res = new Response(body());
        expect(new Request("http://example.com/", res).headers.get("content-type")).toBe(expected);
      });

      test("clone() after .body", () => {
        const res = new Response(body());
        void res.body;
        const clone = res.clone();
        expect(clone.headers.get("content-type")).toBe(expected);
        expect(res.headers.get("content-type")).toBe(expected);
      });

      test("HTMLRewriter output", async () => {
        const res = new Response(body());
        const out = new HTMLRewriter().on("p", { element: e => void e.setInnerContent("yo") }).transform(res);
        expect(out.headers.get("content-type")).toBe(expected);
        expect(await out.text()).toBe("<p>yo</p>");
      });
    });
  }

  test("a ReadableStream body contributes no Content-Type, the init still does", () => {
    const stream = () => new ReadableStream({ start: c => c.close() });
    expect(new Response(stream()).headers.get("content-type")).toBeNull();
    expect(new Response(stream(), new Response(blob())).headers.get("content-type")).toBe("text/x-custom");
  });

  test("an explicit Content-Type header wins over the body's", () => {
    const res = new Response(blob(), { headers: { "Content-Type": "text/plain" } });
    void res.body;
    expect(res.headers.get("content-type")).toBe("text/plain");
  });
});
