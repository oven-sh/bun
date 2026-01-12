import { expect, test } from "bun:test";
import http from "node:http";

test("ServerResponse.writableEnded should be true after end() when no socket", () => {
  const req = new http.IncomingMessage(null);
  const res = new http.ServerResponse(req);

  expect(res.finished).toBe(false);
  expect(res.writableEnded).toBe(false);

  res.end();

  expect(res.finished).toBe(true);
  expect(res.writableEnded).toBe(true);
});

test("ServerResponse.writableEnded should be true after end() with callback when no socket", async () => {
  const req = new http.IncomingMessage(null);
  const res = new http.ServerResponse(req);

  expect(res.finished).toBe(false);
  expect(res.writableEnded).toBe(false);

  let callbackCalled = false;
  res.end(() => {
    callbackCalled = true;
  });

  expect(res.finished).toBe(true);
  expect(res.writableEnded).toBe(true);

  // Wait for the callback to be called via process.nextTick
  await new Promise(resolve => process.nextTick(resolve));
  expect(callbackCalled).toBe(true);
});

test("ServerResponse.writableEnded should be true after end() with chunk when no socket", () => {
  const req = new http.IncomingMessage(null);
  const res = new http.ServerResponse(req);

  expect(res.finished).toBe(false);
  expect(res.writableEnded).toBe(false);

  res.end("test");

  expect(res.finished).toBe(true);
  expect(res.writableEnded).toBe(true);
});
