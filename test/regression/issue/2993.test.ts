import { expect, test } from "bun:test";

test("Request cache option is set correctly", () => {
  const cacheValues = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"] as const;

  for (const cache of cacheValues) {
    const request = new Request("http://localhost:8080/", { cache });
    expect(request.cache).toBe(cache);
  }
});

test("Request mode option is set correctly", () => {
  const modeValues = ["same-origin", "no-cors", "cors", "navigate"] as const;

  for (const mode of modeValues) {
    const request = new Request("http://localhost:8080/", { mode });
    expect(request.mode).toBe(mode);
  }
});

test("Request cache defaults to 'default'", () => {
  const request = new Request("http://localhost:8080/");
  expect(request.cache).toBe("default");
});

test("Request mode defaults to 'cors'", () => {
  const request = new Request("http://localhost:8080/");
  expect(request.mode).toBe("cors");
});

test("Request.clone() preserves cache and mode options", () => {
  const original = new Request("http://localhost:8080/", { cache: "no-cache", mode: "same-origin" });
  const cloned = original.clone();

  expect(cloned.cache).toBe("no-cache");
  expect(cloned.mode).toBe("same-origin");
});

test("new Request(request) preserves cache and mode options", () => {
  const original = new Request("http://localhost:8080/", { cache: "force-cache", mode: "no-cors" });
  const newRequest = new Request(original);

  expect(newRequest.cache).toBe("force-cache");
  expect(newRequest.mode).toBe("no-cors");
});

test("new Request(request, init) allows overriding cache and mode", () => {
  const original = new Request("http://localhost:8080/", { cache: "default", mode: "cors" });
  const newRequest = new Request(original, { cache: "no-cache", mode: "same-origin" });

  expect(newRequest.cache).toBe("no-cache");
  expect(newRequest.mode).toBe("same-origin");
});
