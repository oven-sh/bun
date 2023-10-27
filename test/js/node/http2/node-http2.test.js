import http2 from "node:http2";
import fs from "node:fs";
import { join } from "node:path";

function doHttp2Request(url, headers, payload) {
  const { promise, resolve, reject } = Promise.withResolvers();

  const client = http2.connect(url);
  client.on("error", reject);

  const req = client.request(headers);

  let response_headers = null;
  req.on("response", (headers, flags) => {
    response_headers = headers;
  });

  req.setEncoding("utf8");
  let data = "";
  req.on("data", chunk => {
    data += chunk;
  });
  req.on("end", () => {
    resolve({ data, headers: response_headers });
    client.close();
  });

  if (payload) {
    req.write(payload);
  }
  req.end();
  return promise;
}

function doMultipleHttp2Request(url, requests) {
  const { promise, resolve, reject } = Promise.withResolvers();

  const client = http2.connect(url);
  client.on("error", reject);
  let completed = 0;
  const results = [];
  for (let i = 0; i < requests.length; i++) {
    const { headers, payload } = requests[i];

    const req = client.request(headers);

    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });

    req.setEncoding("utf8");
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => {
      results.push({ data, headers: response_headers });
      completed++;
      if (completed === requests.length) {
        resolve(results);
        client.close();
      }
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  }
  return promise;
}

describe("Client Basics", () => {
  // we dont support server yet but we support client

  it("should be able to send a GET request", async () => {
    const result = await doHttp2Request("https://httpbin.org", { ":path": "/get", "test-header": "test-value" });
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/get");
    expect(parsed.headers["Test-Header"]).toBe("test-value");
  });

  it("should be able to send a POST request", async () => {
    const payload = JSON.stringify({ "hello": "bun" });
    const result = await doHttp2Request(
      "https://httpbin.org",
      { ":path": "/post", "test-header": "test-value", ":method": "POST" },
      payload,
    );
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/post");
    expect(parsed.headers["Test-Header"]).toBe("test-value");
    expect(parsed.json).toEqual({ "hello": "bun" });
    expect(parsed.data).toEqual(payload);
  });

  it("should be able to send data using end", async () => {
    const payload = JSON.stringify({ "hello": "bun" });

    const { promise, resolve, reject } = Promise.withResolvers();

    const client = http2.connect("https://httpbin.org");
    client.on("error", reject);

    const req = client.request({ ":path": "/post", "test-header": "test-value", ":method": "POST" });

    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });

    req.setEncoding("utf8");
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => {
      resolve({ data, headers: response_headers });
      client.close();
    });

    req.end(payload);
    const result = await promise;
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/post");
    expect(parsed.headers["Test-Header"]).toBe("test-value");
    expect(parsed.headers["Content-Length"]).toBe(payload.length.toString());
    expect(parsed.json).toEqual({ "hello": "bun" });
    expect(parsed.data).toEqual(payload);
  });

  it("should be able to do multiple GET requests", async () => {
    const results = await doMultipleHttp2Request("https://httpbin.org", [
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
    ]);
    expect(results.length).toBe(5);
    for (let i = 0; i < results.length; i++) {
      let parsed;
      expect(() => (parsed = JSON.parse(results[i].data))).not.toThrow();
      expect(parsed.url).toBe("https://httpbin.org/get");
    }
  });

  it("should be able to do multiple POST requests", async () => {
    const results = await doMultipleHttp2Request("https://httpbin.org", [
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 1 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 2 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 3 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 4 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 5 }) },
    ]);
    expect(results.length).toBe(5);
    for (let i = 0; i < results.length; i++) {
      let parsed;
      expect(() => (parsed = JSON.parse(results[i].data))).not.toThrow();
      expect(parsed.url).toBe("https://httpbin.org/post");
      expect([1, 2, 3, 4, 5]).toContain(parsed.json?.request);
    }
  });
});
