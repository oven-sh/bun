import { expect, test, describe } from "bun:test";

describe("Response.redirect", () => {
  test("should validate URL parameter type - number", () => {
    expect(() => {
      Response.redirect(420, "blaze it");
    }).toThrow('The "url" argument must be of type string');
  });

  test("should validate URL parameter type - null", () => {
    expect(() => {
      Response.redirect(null);
    }).toThrow('The "url" argument must be of type string');
  });

  test("should validate URL parameter type - undefined", () => {
    expect(() => {
      Response.redirect(undefined);
    }).toThrow('The "url" argument must be of type string');
  });

  test("accepts arrays with toString", () => {
    const response = Response.redirect(["not", "a", "url"]);
    expect(response.headers.get("Location")).toBe("not,a,url");
  });

  test("rejects a plain object as URL", () => {
    expect(() => {
      Response.redirect({ not: "a url" });
    }).toThrow('The "url" argument must be of type string');
  });

  test("accepts a string URL with default status code", () => {
    const response = Response.redirect("https://example.com");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com");
  });

  test("accepts a string URL with valid redirect status code", () => {
    const response = Response.redirect("https://example.com", 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://example.com");
  });

  test("accepts a URL object as first parameter", () => {
    const url = new URL("https://example.com");
    const response = Response.redirect(url, 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://example.com/");
  });

  test("accepts objects with toString method as first parameter", () => {
    const urlLike = { toString: () => "https://example.com" };
    const response = Response.redirect(urlLike, 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://example.com");
  });

  test("rejects an invalid redirect status code", () => {
    expect(() => {
      Response.redirect("https://example.com", 420);
    }).toThrow();
  });
});
