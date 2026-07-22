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
  expect(normalizeBunSnapshot(Bun.inspect(new Response(Bun.file(import.meta.filename)))), import.meta.dir)
    .toMatchInlineSnapshot(`
    "Response (11.89 KB) {
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
  // Covers https://github.com/oven-sh/bun/pull/23961: a stack overflow during
  // text()'s promise resolution must surface as a catchable JS error.
  // The wide recursive call fattens each frame: debug builds spend ~0.2ms per
  // frame in the Response constructor, and overflowing the stack with small
  // frames takes ~26k frames, longer than the test timeout.
  const pad = new Array(1024).fill(0);
  function f0(a1, a2) {
    const v4 = new Response();
    // @ts-ignore
    const v5 = v4.text(a2, a2, v4, f0, f0);
    a1(a1, a2, ...pad); // Recursive call causes stack overflow
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

// https://github.com/oven-sh/bun/issues/32043
describe("null body status", () => {
  // https://fetch.spec.whatwg.org/#null-body-status
  // The spec throws a TypeError for a non-null body with one of these
  // statuses; Bun drops the body instead so existing code that builds such
  // responses keeps working. 103 is excluded here: the constructor's status
  // range check rejects it first.
  const nullBodyStatuses = [101, 204, 205, 304];

  describe.each(nullBodyStatuses)("status %i", status => {
    test("constructor drops a string body", async () => {
      const res = new Response("body", { status });
      expect({ status: res.status, body: res.body }).toEqual({ status, body: null });
      expect(await res.text()).toBe("");
    });

    test("constructor drops an empty string body", () => {
      expect(new Response("", { status }).body).toBe(null);
    });

    test("constructor accepts null and undefined bodies", () => {
      const fromNull = new Response(null, { status });
      const fromUndefined = new Response(undefined, { status });
      expect({ status: fromNull.status, body: fromNull.body }).toEqual({ status, body: null });
      expect({ status: fromUndefined.status, body: fromUndefined.body }).toEqual({ status, body: null });
    });

    test("Response.json drops the body", async () => {
      const res = Response.json({ a: 1 }, { status });
      expect({ status: res.status, body: res.body }).toEqual({ status, body: null });
      expect(await res.text()).toBe("");
      // Bun also accepts a bare number as init
      expect(Response.json({ a: 1 }, status).body).toBe(null);
    });
  });

  test("constructor drops other body types", () => {
    expect(new Response(new Blob(["body"]), { status: 204 }).body).toBe(null);
    expect(new Response(new Uint8Array([1, 2, 3]), { status: 205 }).body).toBe(null);
    expect(new Response(new URLSearchParams({ a: "1" }), { status: 304 }).body).toBe(null);
  });

  test("a ReadableStream body is left unlocked and usable", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const res = new Response(stream, { status: 204 });
    expect(res.body).toBe(null);
    expect(stream.locked).toBe(false);
    expect((await stream.getReader().read()).value).toEqual(new Uint8Array([1]));
  });

  test("Response.json(null) still serializes to a body, so it is dropped too", () => {
    expect(Response.json(null, { status: 204 }).body).toBe(null);
  });

  test("Response.json with bare number init 103 drops the body", () => {
    // the bare-number init path skips the [200, 599] range check, so 103 is
    // reachable here (unlike in the constructor)
    expect(Response.json({ a: 1 }, 103).body).toBe(null);
  });

  test("Response.json with object init 103 is rejected by the range check first", () => {
    expect(() => Response.json({ a: 1 }, { status: 103 })).toThrow(RangeError);
  });

  test("statuses outside the null body set still accept a body", () => {
    for (const status of [200, 203, 206, 303, 305]) {
      const res = new Response("body", { status });
      expect({ status: res.status, hasBody: res.body !== null }).toEqual({ status, hasBody: true });
    }
  });

  test("103 with a body is rejected by the range check first", () => {
    expect(() => new Response("body", { status: 103 })).toThrow(RangeError);
  });
});
