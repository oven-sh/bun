import { test, expect } from "bun:test";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";

test("https.request URL property should be empty string like Node.js - issue #13820", async () => {
  const url = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest("https://google.com", (res) => {
      resolve(res.url);
      res.resume(); // Drain response to avoid hanging
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  // Node.js returns empty string, not "/"
  expect(url).toBe("");
});

test("https.request URL property for root path with explicit slash", async () => {
  const url = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest("https://google.com/", (res) => {
      resolve(res.url);
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  expect(url).toBe("");
});

test("https.request URL property for path", async () => {
  const url = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest("https://httpbin.org/json", (res) => {
      resolve(res.url);
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  expect(url).toBe("");
});

test("http.request URL property should also be empty string", async () => {
  const url = await new Promise<string>((resolve, reject) => {
    const req = httpRequest("http://httpbin.org/json", (res) => {
      resolve(res.url);
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  expect(url).toBe("");
});

test("https.request URL property with redirect", async () => {
  const url = await new Promise<string>((resolve, reject) => {
    const req = httpsRequest("https://httpbin.org/redirect/1", (res) => {
      resolve(res.url);
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  // Even after redirect, URL should still be empty string (Node.js behavior)
  expect(url).toBe("");
});

test("https.request URL property consistency across multiple requests", async () => {
  const urls = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const req = httpsRequest("https://httpbin.org/status/200", (res) => {
        resolve(res.url);
        res.resume();
      });
      req.on("error", reject);
      req.setTimeout(5000, () => reject(new Error("Timeout")));
      req.end();
    }),
    new Promise<string>((resolve, reject) => {
      const req = httpsRequest("https://httpbin.org/status/404", (res) => {
        resolve(res.url);
        res.resume();
      });
      req.on("error", reject);
      req.setTimeout(5000, () => reject(new Error("Timeout")));
      req.end();
    }),
  ]);

  expect(urls[0]).toBe("");
  expect(urls[1]).toBe("");
});

test("https.request URL property type should be string", async () => {
  const url = await new Promise<any>((resolve, reject) => {
    const req = httpsRequest("https://httpbin.org/json", (res) => {
      resolve(res.url);
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  expect(typeof url).toBe("string");
  expect(url).toBe("");
});

test("https.request response object should have url property", async () => {
  const hasUrlProperty = await new Promise<boolean>((resolve, reject) => {
    const req = httpsRequest("https://httpbin.org/json", (res) => {
      resolve("url" in res);
      res.resume();
    });
    req.on("error", reject);
    req.setTimeout(5000, () => reject(new Error("Timeout")));
    req.end();
  });

  expect(hasUrlProperty).toBe(true);
});