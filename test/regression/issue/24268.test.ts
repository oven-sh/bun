import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

test("IncomingMessage.headersDistinct returns headers with array values", async () => {
  let headersDistinct: any;
  let trailersDistinct: any;
  let headers: any;

  await using server = http.createServer((req, res) => {
    headers = req.headers;
    headersDistinct = req.headersDistinct;
    trailersDistinct = req.trailersDistinct;
    res.end("ok");
  });

  await once(server.listen(0), "listening");
  const PORT = (server.address() as AddressInfo).port;

  // Make a request
  const response = await fetch(`http://localhost:${PORT}/`, {
    headers: {
      "Content-Type": "application/json",
      "X-Custom-Header": "test-value",
      "User-Agent": "bun-test",
    },
  });

  await response.text();

  // headersDistinct should be an object (not null or undefined)
  expect(typeof headersDistinct).toBe("object");
  expect(headersDistinct).not.toBeNull();

  // All header values should be arrays
  for (const key in headersDistinct) {
    expect(Array.isArray(headersDistinct[key])).toBe(true);
    expect(headersDistinct[key].length).toBeGreaterThan(0);
    for (const val of headersDistinct[key]) {
      expect(typeof val).toBe("string");
    }
  }

  // Check specific headers we sent
  expect(headersDistinct["content-type"]).toEqual(["application/json"]);
  expect(headersDistinct["x-custom-header"]).toEqual(["test-value"]);
  expect(headersDistinct["user-agent"]).toEqual(["bun-test"]);

  // Compare with headers - headersDistinct should have the same keys but all values as arrays
  for (const key in headers) {
    const headerValue = headers[key];
    const distinctValue = headersDistinct[key];
    expect(Array.isArray(distinctValue)).toBe(true);
    if (Array.isArray(headerValue)) {
      expect(distinctValue).toEqual(headerValue);
    } else {
      expect(distinctValue).toEqual([headerValue]);
    }
  }

  // trailersDistinct should also be an object
  expect(typeof trailersDistinct).toBe("object");
  expect(trailersDistinct).not.toBeNull();
});

test("IncomingMessage.headersDistinct handles set-cookie arrays correctly", async () => {
  let responseHeadersDistinct: any;
  let responseHeaders: any;

  await using server = http.createServer((req, res) => {
    res.setHeader("Set-Cookie", ["session=abc123", "token=xyz789"]);
    res.end("ok");
  });

  await once(server.listen(0), "listening");
  const PORT = (server.address() as AddressInfo).port;

  // Use http.request to get access to the response's IncomingMessage
  await new Promise<void>((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}/`, res => {
      responseHeaders = res.headers;
      responseHeadersDistinct = res.headersDistinct;

      res.on("data", () => {});
      res.on("end", () => {
        resolve();
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.end();
  });

  // headers should have set-cookie as an array
  expect(Array.isArray(responseHeaders["set-cookie"])).toBe(true);
  expect(responseHeaders["set-cookie"]).toEqual(["session=abc123", "token=xyz789"]);

  // headersDistinct should also have set-cookie as an array (same format)
  expect(Array.isArray(responseHeadersDistinct["set-cookie"])).toBe(true);
  expect(responseHeadersDistinct["set-cookie"]).toEqual(["session=abc123", "token=xyz789"]);
});
