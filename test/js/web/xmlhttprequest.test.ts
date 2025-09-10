import { test, expect, describe } from "bun:test";

describe("XMLHttpRequest", () => {
  test("XMLHttpRequest is defined", () => {
    expect(typeof XMLHttpRequest).toBe("function");
  });

  test("XMLHttpRequest constants", () => {
    expect(XMLHttpRequest.UNSENT).toBe(0);
    expect(XMLHttpRequest.OPENED).toBe(1);
    expect(XMLHttpRequest.HEADERS_RECEIVED).toBe(2);
    expect(XMLHttpRequest.LOADING).toBe(3);
    expect(XMLHttpRequest.DONE).toBe(4);
  });

  test("can create XMLHttpRequest instance", () => {
    const xhr = new XMLHttpRequest();
    expect(xhr).toBeDefined();
    expect(xhr.readyState).toBe(XMLHttpRequest.UNSENT);
  });

  test("has required properties", () => {
    const xhr = new XMLHttpRequest();
    
    // Properties
    expect(xhr.readyState).toBe(0);
    expect(xhr.status).toBe(0);
    expect(xhr.statusText).toBe("");
    expect(xhr.responseText).toBe("");
    expect(xhr.responseURL).toBe("");
    expect(xhr.responseType).toBe("");
    expect(xhr.response).toBeNull();
    expect(xhr.timeout).toBe(0);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.upload).toBeDefined();
    
    // Methods
    expect(typeof xhr.open).toBe("function");
    expect(typeof xhr.setRequestHeader).toBe("function");
    expect(typeof xhr.send).toBe("function");
    expect(typeof xhr.abort).toBe("function");
    expect(typeof xhr.getResponseHeader).toBe("function");
    expect(typeof xhr.getAllResponseHeaders).toBe("function");
    expect(typeof xhr.overrideMimeType).toBe("function");
  });

  test("open() method", () => {
    const xhr = new XMLHttpRequest();
    expect(() => {
      xhr.open("GET", "http://example.com");
    }).not.toThrow();
    expect(xhr.readyState).toBe(XMLHttpRequest.OPENED);
  });

  test("setRequestHeader() requires open() first", () => {
    const xhr = new XMLHttpRequest();
    expect(() => {
      xhr.setRequestHeader("Content-Type", "application/json");
    }).toThrow();
    
    xhr.open("GET", "http://example.com");
    expect(() => {
      xhr.setRequestHeader("Content-Type", "application/json");
    }).not.toThrow();
  });

  test("abort() method", () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "http://example.com");
    expect(() => {
      xhr.abort();
    }).not.toThrow();
    expect(xhr.readyState).toBe(XMLHttpRequest.DONE);
  });

  test("instance constants", () => {
    const xhr = new XMLHttpRequest();
    expect(xhr.UNSENT).toBe(0);
    expect(xhr.OPENED).toBe(1);
    expect(xhr.HEADERS_RECEIVED).toBe(2);
    expect(xhr.LOADING).toBe(3);
    expect(xhr.DONE).toBe(4);
  });

  test("responseType setter/getter", () => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = "json";
    expect(xhr.responseType).toBe("json");
    
    xhr.responseType = "arraybuffer";
    expect(xhr.responseType).toBe("arraybuffer");
  });

  test("timeout setter/getter", () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "http://example.com");
    xhr.timeout = 5000;
    expect(xhr.timeout).toBe(5000);
  });

  test("withCredentials setter/getter", () => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    expect(xhr.withCredentials).toBe(true);
    
    xhr.withCredentials = false;
    expect(xhr.withCredentials).toBe(false);
  });
});