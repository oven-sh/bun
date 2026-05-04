import { expect, test } from "bun:test";

test("undefined args don't throw", () => {
  const request = new Request("https://example.com/", {
    body: undefined,
    "credentials": undefined,
    "redirect": undefined,
    "method": undefined,
    "mode": undefined,
  });

  expect(request.method).toBe("GET");
});

test("request can receive undefined signal", async () => {
  const request = new Request("http://example.com/", {
    method: "POST",
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
    body: "bun",
    signal: undefined,
  });
  expect(request.method).toBe("POST");
  // @ts-ignore
  const clone = new Request(request);
  expect(clone.method).toBe("POST");
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(await request.text()).toBe("bun");
  expect(await clone.text()).toBe("bun");
});

test("request can receive null signal", async () => {
  const request = new Request("http://example.com/", {
    method: "POST",
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
    body: "bun",
    signal: null,
  });
  expect(request.method).toBe("POST");
  // @ts-ignore
  const clone = new Request(request);
  expect(clone.method).toBe("POST");
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(await request.text()).toBe("bun");
  expect(await clone.text()).toBe("bun");
});

// https://github.com/oven-sh/bun/issues/30124
test("referrer, integrity, keepalive — defaults", () => {
  const r = new Request("https://example.org/");
  expect({
    referrer: r.referrer,
    integrity: r.integrity,
    keepalive: r.keepalive,
  }).toEqual({
    referrer: "about:client",
    integrity: "",
    keepalive: false,
  });
  expect(typeof r.keepalive).toBe("boolean");
});

test("referrer, integrity, keepalive — passed through init", () => {
  const r = new Request("https://example.org/", {
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
  expect({
    referrer: r.referrer,
    integrity: r.integrity,
    keepalive: r.keepalive,
  }).toEqual({
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
});

test("referrer, integrity, keepalive — undefined init values use defaults", () => {
  const r = new Request("https://example.org/", {
    referrer: undefined,
    integrity: undefined,
    keepalive: undefined,
  });
  expect({
    referrer: r.referrer,
    integrity: r.integrity,
    keepalive: r.keepalive,
  }).toEqual({
    referrer: "about:client",
    integrity: "",
    keepalive: false,
  });
});

test("referrer — empty string maps to no-referrer (returns '')", () => {
  const r = new Request("https://example.org/", { referrer: "" });
  expect(r.referrer).toBe("");
});

test("referrer — invalid URL throws TypeError", () => {
  expect(() => new Request("https://example.org/", { referrer: "not a url" })).toThrow(TypeError);
});

test("integrity — null coerces to 'null' string (per String() semantics)", () => {
  const r = new Request("https://example.org/", { integrity: null as any });
  expect(r.integrity).toBe("null");
});

test("keepalive — truthy/falsy values coerce via Boolean()", () => {
  expect(new Request("https://example.org/", { keepalive: 1 as any }).keepalive).toBe(true);
  expect(new Request("https://example.org/", { keepalive: 0 as any }).keepalive).toBe(false);
  expect(new Request("https://example.org/", { keepalive: "yes" as any }).keepalive).toBe(true);
  expect(new Request("https://example.org/", { keepalive: "" as any }).keepalive).toBe(false);
});

test("new Request(other) copies referrer, integrity, keepalive", () => {
  const base = new Request("https://example.org/", {
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
  const copy = new Request(base);
  expect({
    referrer: copy.referrer,
    integrity: copy.integrity,
    keepalive: copy.keepalive,
  }).toEqual({
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
});

test("new Request(other, init) lets init override", () => {
  const base = new Request("https://example.org/", {
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
  const over = new Request(base, { integrity: "sha256-xyz", keepalive: false });
  expect({
    referrer: over.referrer,
    integrity: over.integrity,
    keepalive: over.keepalive,
  }).toEqual({
    // Fetch spec step 12: a non-empty init resets referrer to "client" before
    // step 14 consults init.referrer, so the base's referrer is NOT inherited
    // when init has any recognized member. (Matches Node/undici.)
    referrer: "about:client",
    integrity: "sha256-xyz", // overridden
    keepalive: false, // overridden
  });
});

test("new Request(other, {}) preserves referrer (empty init)", () => {
  // Empty init dict (after WebIDL conversion, no recognized keys) means
  // the spec's step 12 "if init is not empty" does NOT fire, so the base
  // Request's referrer is inherited — matches Node/undici.
  const base = new Request("https://example.org/", { referrer: "https://foo.example/" });
  expect(new Request(base, {}).referrer).toBe("https://foo.example/");
  expect(new Request(base).referrer).toBe("https://foo.example/");
});

test("new Request(other, init) with explicit referrer uses init.referrer", () => {
  const base = new Request("https://example.org/", { referrer: "https://foo.example/" });
  const over = new Request(base, { referrer: "https://other.example/" });
  expect(over.referrer).toBe("https://other.example/");
});

test("clone() preserves referrer, integrity, keepalive", () => {
  const base = new Request("https://example.org/", {
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
  const c = base.clone();
  expect({
    referrer: c.referrer,
    integrity: c.integrity,
    keepalive: c.keepalive,
  }).toEqual({
    referrer: "https://foo.example/",
    integrity: "sha256-abc",
    keepalive: true,
  });
});

test("clone() does not lock original body when body was accessed before clone", async () => {
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Hello, world!"));
      controller.close();
    },
  });

  const request = new Request("http://example.com", { method: "POST", body: readableStream });

  // Access body before clone (this triggers the bug in the unfixed version)
  const bodyBeforeClone = request.body;
  expect(bodyBeforeClone?.locked).toBe(false);

  const cloned = request.clone();

  // Both should be unlocked after clone
  expect(request.body?.locked).toBe(false);
  expect(cloned.body?.locked).toBe(false);

  // Both should be readable
  const [originalText, clonedText] = await Promise.all([request.text(), cloned.text()]);

  expect(originalText).toBe("Hello, world!");
  expect(clonedText).toBe("Hello, world!");
});
