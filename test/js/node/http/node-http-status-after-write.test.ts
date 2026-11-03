/**
 * This test must also pass in Node.js.
 */
import { expect, test } from "bun:test";
import { once } from "node:events";
import type { RequestListener, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

async function respondWith(listener: RequestListener) {
  const server = createServer(listener);
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    return { status: response.status, statusText: response.statusText, body: await response.text() };
  } finally {
    server.close();
  }
}

// write() renders the head, so the status line is the one the response had at that call.
test.each([
  ["statusCode", (res: ServerResponse) => void (res.statusCode = 404)],
  ["statusMessage", (res: ServerResponse) => void (res.statusMessage = "Nope")],
  ["a statusCode that is out of range", (res: ServerResponse) => void (res.statusCode = 1000)],
  // @ts-expect-error
  ["a deleted statusCode", (res: ServerResponse) => void delete res.statusCode],
])("%s assigned between write() and end() does not reach the wire", async (_name, change) => {
  const response = await respondWith((req, res) => {
    res.setHeader("Content-Length", 5);
    res.write("hello");
    change(res);
    res.end();
  });
  expect(response).toEqual({ status: 200, statusText: "OK", body: "hello" });
});

test("an empty write() renders the head too", async () => {
  const response = await respondWith((req, res) => {
    res.setHeader("Content-Length", 5);
    res.write("");
    res.statusCode = 404;
    res.end("hello");
  });
  expect(response).toEqual({ status: 200, statusText: "OK", body: "hello" });
});

test("write() is the call that throws for a statusMessage with an invalid character", async () => {
  let code: unknown;
  const response = await respondWith((req, res) => {
    res.setHeader("Content-Length", 5);
    res.statusMessage = "a\nb";
    try {
      res.write("hello");
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    res.statusMessage = "Fine";
    res.end("hello");
  });
  expect(code).toBe("ERR_INVALID_CHAR");
  expect(response).toEqual({ status: 200, statusText: "Fine", body: "hello" });
});
