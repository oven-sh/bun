import { expect, test } from "bun:test";
import { Request as NodeFetchRequest } from "node-fetch";

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

// Regression test for #2993
test("Request cache option is set correctly", () => {
  const cacheValues = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"] as const;

  for (const cache of cacheValues) {
    const request = new Request("http://localhost:8080/", { cache });
    expect(request.cache).toBe(cache);
  }
});

// Regression test for #2993
test("Request mode option is set correctly", () => {
  const modeValues = ["same-origin", "no-cors", "cors", "navigate"] as const;

  for (const mode of modeValues) {
    const request = new Request("http://localhost:8080/", { mode });
    expect(request.mode).toBe(mode);
  }
});

// Regression test for #2993
test("Request cache defaults to 'default'", () => {
  const request = new Request("http://localhost:8080/");
  expect(request.cache).toBe("default");
});

// Regression test for #2993
test("Request mode defaults to 'cors'", () => {
  const request = new Request("http://localhost:8080/");
  expect(request.mode).toBe("cors");
});

// Regression test for #2993
test("Request.clone() preserves cache and mode options", () => {
  const original = new Request("http://localhost:8080/", { cache: "no-cache", mode: "same-origin" });
  const cloned = original.clone();

  expect(cloned.cache).toBe("no-cache");
  expect(cloned.mode).toBe("same-origin");
});

// Regression test for #2993
test("new Request(request) preserves cache and mode options", () => {
  const original = new Request("http://localhost:8080/", { cache: "force-cache", mode: "no-cors" });
  const newRequest = new Request(original);

  expect(newRequest.cache).toBe("force-cache");
  expect(newRequest.mode).toBe("no-cors");
});

// Regression test for #2993
test("new Request(request, init) allows overriding cache and mode", () => {
  const original = new Request("http://localhost:8080/", { cache: "default", mode: "cors" });
  const newRequest = new Request(original, { cache: "no-cache", mode: "same-origin" });

  expect(newRequest.cache).toBe("no-cache");
  expect(newRequest.mode).toBe("same-origin");
});

// Regression test for #14865
test("node fetch Request URL field is set even with a valid URL", () => {
  expect(new NodeFetchRequest("/").url).toBe("/");
  expect(new NodeFetchRequest("https://bun.sh/").url).toBe("https://bun.sh/");
  expect(new NodeFetchRequest(new URL("https://bun.sh/")).url).toBe("https://bun.sh/");
});
