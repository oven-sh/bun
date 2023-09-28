import { test, expect } from "bun:test";

test("response status/statusText can be filled in", () => {
  const response = new Response("body text", {
    status: 202,
    statusText: "Accepted.",
  });

  expect(response.status).toBe(202);
  expect(response.statusText).toBe("Accepted.");
});

test("zero args returns an otherwise empty 200 response", () => {
  const response = new Response();
  expect(response.status).toBe(200);
  expect(response.statusText).toBe("");
});
