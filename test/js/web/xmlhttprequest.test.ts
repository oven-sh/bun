import { test, expect } from "bun:test";

test("XMLHttpRequest exists", () => {
  expect(typeof XMLHttpRequest).toBe("function");
  expect(XMLHttpRequest.name).toBe("XMLHttpRequest");
});

test("XMLHttpRequest constructor", () => {
  const xhr = new XMLHttpRequest();
  expect(xhr).toBeDefined();
  expect(xhr instanceof XMLHttpRequest).toBe(true);
});

test("XMLHttpRequest constants", () => {
  expect(XMLHttpRequest.UNSENT).toBe(0);
  expect(XMLHttpRequest.OPENED).toBe(1);
  expect(XMLHttpRequest.HEADERS_RECEIVED).toBe(2);
  expect(XMLHttpRequest.LOADING).toBe(3);
  expect(XMLHttpRequest.DONE).toBe(4);
});

test("XMLHttpRequest instance constants", () => {
  const xhr = new XMLHttpRequest();
  expect(xhr.UNSENT).toBe(0);
  expect(xhr.OPENED).toBe(1);
  expect(xhr.HEADERS_RECEIVED).toBe(2);
  expect(xhr.LOADING).toBe(3);
  expect(xhr.DONE).toBe(4);
});

test("XMLHttpRequest initial state", () => {
  const xhr = new XMLHttpRequest();
  expect(xhr.readyState).toBe(XMLHttpRequest.UNSENT);
  expect(xhr.status).toBe(0);
  expect(xhr.statusText).toBe("");
  expect(xhr.responseText).toBe("");
  expect(xhr.responseURL).toBe("");
  expect(xhr.response).toBe("");
  expect(xhr.responseType).toBe("");
  expect(xhr.timeout).toBe(0);
  expect(xhr.withCredentials).toBe(false);
  expect(xhr.upload).toBeDefined();
});

test("XMLHttpRequest open method", () => {
  const xhr = new XMLHttpRequest();
  
  // Test with just method and URL
  xhr.open("GET", "http://example.com");
  expect(xhr.readyState).toBe(XMLHttpRequest.OPENED);
  
  // Test with async parameter
  const xhr2 = new XMLHttpRequest();
  xhr2.open("POST", "http://example.com", true);
  expect(xhr2.readyState).toBe(XMLHttpRequest.OPENED);
  
  // Test with user and password
  const xhr3 = new XMLHttpRequest();
  xhr3.open("GET", "http://example.com", true, "user", "pass");
  expect(xhr3.readyState).toBe(XMLHttpRequest.OPENED);
});

test("XMLHttpRequest setRequestHeader", () => {
  const xhr = new XMLHttpRequest();
  
  // Should throw if not opened
  expect(() => {
    xhr.setRequestHeader("Content-Type", "application/json");
  }).toThrow();
  
  // Should work after open
  xhr.open("POST", "http://example.com");
  expect(() => {
    xhr.setRequestHeader("Content-Type", "application/json");
  }).not.toThrow();
});

test("XMLHttpRequest abort", () => {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", "http://example.com");
  
  // Abort should not throw
  expect(() => {
    xhr.abort();
  }).not.toThrow();
});

test("XMLHttpRequest responseType setter/getter", () => {
  const xhr = new XMLHttpRequest();
  
  // Default should be empty string
  expect(xhr.responseType).toBe("");
  
  // Should accept valid types
  xhr.responseType = "text";
  expect(xhr.responseType).toBe("text");
  
  xhr.responseType = "arraybuffer";
  expect(xhr.responseType).toBe("arraybuffer");
  
  xhr.responseType = "blob";
  expect(xhr.responseType).toBe("blob");
  
  xhr.responseType = "json";
  expect(xhr.responseType).toBe("json");
  
  // Setting to empty string should work
  xhr.responseType = "";
  expect(xhr.responseType).toBe("");
});

test("XMLHttpRequest timeout setter/getter", () => {
  const xhr = new XMLHttpRequest();
  
  expect(xhr.timeout).toBe(0);
  
  xhr.timeout = 5000;
  expect(xhr.timeout).toBe(5000);
});

test("XMLHttpRequest withCredentials setter/getter", () => {
  const xhr = new XMLHttpRequest();
  
  expect(xhr.withCredentials).toBe(false);
  
  xhr.withCredentials = true;
  expect(xhr.withCredentials).toBe(true);
  
  xhr.withCredentials = false;
  expect(xhr.withCredentials).toBe(false);
});

test("XMLHttpRequest event handler properties", () => {
  const xhr = new XMLHttpRequest();
  
  // Test onreadystatechange
  expect(xhr.onreadystatechange).toBeNull();
  
  const handler = () => {};
  xhr.onreadystatechange = handler;
  expect(xhr.onreadystatechange).toBe(handler);
});

test("XMLHttpRequest methods exist", () => {
  const xhr = new XMLHttpRequest();
  
  expect(typeof xhr.open).toBe("function");
  expect(typeof xhr.setRequestHeader).toBe("function");
  expect(typeof xhr.send).toBe("function");
  expect(typeof xhr.abort).toBe("function");
  expect(typeof xhr.getResponseHeader).toBe("function");
  expect(typeof xhr.getAllResponseHeaders).toBe("function");
  expect(typeof xhr.overrideMimeType).toBe("function");
});

// TODO: Add tests for actual network requests once the implementation is complete
test.todo("XMLHttpRequest GET request", async () => {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status === 200) {
          resolve(xhr.responseText);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };
    xhr.open("GET", "https://httpbin.org/get");
    xhr.send();
  });
  
  const response = await promise;
  expect(response).toBeDefined();
});