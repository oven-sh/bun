import { expect, test } from "bun:test";

test("can clone a response", async () => {
  const response = new Response("bun", {
    status: 201,
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
  });
  // @ts-ignore
  const clone = response.clone();
  expect(clone.status).toBe(201);
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(await response.text()).toBe("bun");
  expect(await clone.text()).toBe("bun");
});

test("can clone a request", async () => {
  const request = new Request("http://example.com/", {
    method: "PUT",
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
    body: "bun",
  });
  expect(request.method).toBe("PUT");
  // @ts-ignore
  const clone = new Request(request);
  expect(clone.method).toBe("PUT");
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(await request.text()).toBe("bun");
  expect(await clone.text()).toBe("bun");
});
