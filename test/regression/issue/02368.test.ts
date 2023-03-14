import { test, expect } from "bun:test";

test("can clone a response", () => {
  const response = new Response("bun", {
    status: 201,
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
  });
  // @ts-ignore
  const clone = new Response(response);
  expect(clone.status).toBe(201);
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(async () => await response.text()).toBe("bun");
  expect(async () => await clone.text()).toBe("bun");
});

test("can clone a request", () => {
  const request = new Request("http://example.com/", {
    method: "PUT",
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
    body: "bun",
  });
  // @ts-ignore
  const clone = new Request(request);
  expect(clone.method).toBe("PUT");
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(async () => await request.text()).toBe("bun");
  expect(async () => await clone.text()).toBe("bun");
});
