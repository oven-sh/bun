import { test, expect } from "bun:test";
import http from "node:http";

test("HTTP headers with arrays should be preserved like Node.js", () => {
  const res = new http.OutgoingMessage();
  
  // Set various types of headers
  res.setHeader("array-header", ["first", "second"]);
  res.setHeader("string-header", "single-value");
  res.setHeader("array-single", ["single"]);
  res.setHeader("array-multiple", ["one", "two", "three"]);
  
  const headers = res.getHeaders();
  
  // Arrays should be preserved as arrays
  expect(headers["array-header"]).toEqual(["first", "second"]);
  expect(headers["array-single"]).toEqual(["single"]);
  expect(headers["array-multiple"]).toEqual(["one", "two", "three"]);
  
  // Strings should remain strings
  expect(headers["string-header"]).toBe("single-value");
});

test("HTTP header array validation should validate each element", () => {
  const res = new http.OutgoingMessage();
  
  // Valid arrays should work
  expect(() => {
    res.setHeader("valid-array", ["valid1", "valid2"]);
  }).not.toThrow();
  
  // Invalid array elements should throw
  expect(() => {
    res.setHeader("invalid-array", ["valid", "invalid\x00char"]);
  }).toThrow();
});

test("HTTP header case insensitivity should work with arrays", () => {
  const res = new http.OutgoingMessage();
  
  res.setHeader("Content-Type", ["text/html", "charset=utf-8"]);
  res.setHeader("content-type", ["application/json"]);  // Should overwrite
  
  const headers = res.getHeaders();
  
  // Should have the last set value
  expect(headers["content-type"]).toEqual(["application/json"]);
});

test("removeHeader should work with both string and array headers", () => {
  const res = new http.OutgoingMessage();
  
  res.setHeader("array-header", ["first", "second"]);
  res.setHeader("string-header", "value");
  
  let headers = res.getHeaders();
  expect(headers["array-header"]).toEqual(["first", "second"]);
  expect(headers["string-header"]).toBe("value");
  
  // Remove headers
  res.removeHeader("array-header");
  res.removeHeader("string-header");
  
  headers = res.getHeaders();
  expect(headers["array-header"]).toBeUndefined();
  expect(headers["string-header"]).toBeUndefined();
});

test("getHeaders should return a copy, not reference", () => {
  const res = new http.OutgoingMessage();
  res.setHeader("test-header", ["original", "value"]);
  
  const headers1 = res.getHeaders();
  const headers2 = res.getHeaders();
  
  // Should be different objects
  expect(headers1).not.toBe(headers2);
  
  // But with same content
  expect(headers1["test-header"]).toEqual(headers2["test-header"]);
  
  // Modifying returned object shouldn't affect internal state
  headers1["test-header"].push("modified");
  
  const headers3 = res.getHeaders();
  expect(headers3["test-header"]).toEqual(["original", "value"]);
});

test("HTTP header arrays should work with actual HTTP requests", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Custom-Array", ["value1", "value2"]);
    res.setHeader("Custom-String", "single-value");
    
    const responseHeaders = res.getHeaders();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      customArray: responseHeaders["custom-array"],
      customString: responseHeaders["custom-string"],
    }));
  });
  
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  
  const port = (server.address() as any)?.port;
  
  try {
    const response = await fetch(`http://localhost:${port}`);
    const data = await response.json();
    
    expect(data.customArray).toEqual(["value1", "value2"]);
    expect(data.customString).toBe("single-value");
    
    // Verify actual HTTP headers were sent correctly (joined for transmission)
    const receivedCustomArray = response.headers.get("custom-array");
    expect(receivedCustomArray).toBe("value1, value2");
  } finally {
    server.close();
  }
});

test("Edge cases with empty arrays and special values", () => {
  const res = new http.OutgoingMessage();
  
  // Empty array
  res.setHeader("empty-array", []);
  
  // Array with empty string
  res.setHeader("array-with-empty", ["", "value"]);
  
  // Array with only empty strings
  res.setHeader("only-empty", ["", ""]);
  
  const headers = res.getHeaders();
  
  expect(headers["empty-array"]).toEqual([]);
  expect(headers["array-with-empty"]).toEqual(["", "value"]);
  expect(headers["only-empty"]).toEqual(["", ""]);
});

test("setHeader overwrites previous values correctly", () => {
  const res = new http.OutgoingMessage();
  
  // Set initial values
  res.setHeader("test-header", "string-value");
  expect(res.getHeaders()["test-header"]).toBe("string-value");
  
  // Overwrite with array
  res.setHeader("test-header", ["array", "value"]);
  expect(res.getHeaders()["test-header"]).toEqual(["array", "value"]);
  
  // Overwrite back to string
  res.setHeader("test-header", "new-string");
  expect(res.getHeaders()["test-header"]).toBe("new-string");
});

test("Multiple headers with same name should behave like Node.js", () => {
  const res = new http.OutgoingMessage();
  
  // Test the set-cookie special case behavior
  res.setHeader("set-cookie", ["cookie1=value1", "cookie2=value2"]);
  
  const headers = res.getHeaders();
  expect(headers["set-cookie"]).toEqual(["cookie1=value1", "cookie2=value2"]);
});

test("Header array preservation works with various HTTP methods", () => {
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
    const req = new http.OutgoingMessage();
    req.method = method;
    
    req.setHeader("custom-array", ["method", method]);
    req.setHeader("custom-string", `single-${method}`);
    
    const headers = req.getHeaders();
    expect(headers["custom-array"]).toEqual(["method", method]);
    expect(headers["custom-string"]).toBe(`single-${method}`);
  }
});