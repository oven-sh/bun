import { test, expect } from "bun:test";
import express from "express";
import request from "supertest";

test("res.set() should coerce array values to comma-separated string", async () => {
  const app = express();

  app.get("/", (req, res) => {
    res.set("X-Foo", ["123", "456"] as any);
    res.send(JSON.stringify(res.get("X-Foo")));
  });

  const response = await request(app).get("/");

  // Express expects arrays to be joined with ", "
  expect(response.text).toBe('"123, 456"');
  expect(response.headers["x-foo"]).toBe("123, 456");
});

test("status 204 should strip Content-Length header", async () => {
  const app = express();

  app.get("/", (req, res) => {
    res.status(204).send("test body");
  });

  const response = await request(app).get("/");

  expect(response.status).toBe(204);
  expect(response.headers["content-length"]).toBeUndefined();
  expect(response.text).toBe("");
});

test("status 304 should strip Content-Length header", async () => {
  const app = express();

  app.get("/", (req, res) => {
    res.status(304).send("test body");
  });

  const response = await request(app).get("/");

  expect(response.status).toBe(304);
  expect(response.headers["content-length"]).toBeUndefined();
  expect(response.text).toBe("");
});

test("should accept If-Modified-Since header with special characters", async () => {
  const app = express();

  app.get("/", (req, res) => {
    res.set("Last-Modified", "Mon, 01 Jan 2024 00:00:00 GMT");
    res.send("ok");
  });

  // This date format has a comma which was causing the validation error
  const response = await request(app)
    .get("/")
    .set("If-Modified-Since", "Sun, 31 Dec 2023 23:59:59 GMT")
    .set("If-None-Match", '"etag"');

  expect(response.status).toBe(200);
  expect(response.text).toBe("ok");
});

// Additional test for array handling in setHeader
test("setHeader should handle array values correctly", async () => {
  const app = express();

  app.get("/", (req, res) => {
    // Test the underlying setHeader method
    res.setHeader("X-Array", ["foo", "bar"]);
    res.setHeader("X-Single", "baz");
    res.json({
      array: res.getHeader("X-Array"),
      single: res.getHeader("X-Single")
    });
  });

  const response = await request(app).get("/");

  expect(response.headers["x-array"]).toBe("foo, bar");
  expect(response.headers["x-single"]).toBe("baz");
  expect(response.body.array).toBe("foo, bar");
  expect(response.body.single).toBe("baz");
});