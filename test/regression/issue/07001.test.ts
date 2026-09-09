import { expect, test } from "bun:test";

test("req.body.locked is true after body is consumed", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  await new Response(req.body).arrayBuffer();

  expect(req.body.locked).toBe(true);
});

test("req.bodyUsed is true after body is consumed", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  await new Response(req.body).arrayBuffer();

  expect(req.bodyUsed).toBe(true);
});

test("await fetch(req) throws if req.body is already consumed (arrayBuffer)", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  await new Response(req.body).arrayBuffer();
  expect(() => fetch(req)).toThrow();
  expect(req.bodyUsed).toBe(true);
});

test("await fetch(req) throws if req.body is already consumed (text)", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  await new Response(req.body).text();
  expect(() => fetch(req)).toThrow();
  expect(req.bodyUsed).toBe(true);
});

test("await fetch(req) throws if req.body is already consumed (stream that has been read)", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  await req.body.getReader().read();
  expect(() => fetch(req)).toThrow();
  expect(req.bodyUsed).toBe(true);
});

test("await fetch(req) throws if req.body is locked (stream)", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  req.body.getReader();
  expect(() => fetch(req)).toThrow();
  // Holding a reader makes the body unusable, but it does not disturb the stream,
  // so the body is locked without being used.
  expect(req.body.locked).toBe(true);
  expect(req.bodyUsed).toBe(false);
});

test("await fetch(req) throws if req.body is locked (tee)", async () => {
  const req = new Request("https://example.com/", {
    body: "test",
    method: "POST",
  });

  req.body.tee();
  expect(() => fetch(req)).toThrow();
  expect(req.body.locked).toBe(true);
  expect(req.bodyUsed).toBe(false);
});
