import { expect, test } from "bun:test";

test("fetch() with no arguments should give specific error", async () => {
  try {
    // @ts-expect-error - Testing invalid arguments
    await fetch();
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("expects a string but received no arguments");
  }
});

test("fetch() with empty string should give specific error", async () => {
  try {
    await fetch("");
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("must not be a blank string");
  }
});

test("fetch() with http:// but no hostname should give specific error", async () => {
  try {
    await fetch("http://");
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("URL is invalid");
  }
});

test("fetch() with https:// but no hostname should give specific error", async () => {
  try {
    await fetch("https://");
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("URL is invalid");
  }
});

test("fetch() with path only should give invalid URL error", async () => {
  try {
    await fetch("/path");
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("URL is invalid");
  }
});

test("fetch() with object converting to path should give invalid URL error", async () => {
  try {
    // @ts-expect-error - Testing invalid arguments
    await fetch({
      toString() {
        return "/path";
      },
    });
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("must not be a blank string");
  }
});

test("fetch() with invalid protocol should give specific error", async () => {
  try {
    await fetch("ftp://example.com");
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("protocol must be http:, https: or s3:");
  }
});

test("fetch() GET with body should give specific error", async () => {
  try {
    await fetch("http://example.com", {
      method: "GET",
      body: "test data",
    });
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("cannot have body");
  }
});

test("fetch() HEAD with body should give specific error", async () => {
  try {
    await fetch("http://example.com", {
      method: "HEAD",
      body: "test data",
    });
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("cannot have body");
  }
});

test("fetch() OPTIONS with body should give specific error", async () => {
  try {
    await fetch("http://example.com", {
      method: "OPTIONS",
      body: "test data",
    });
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toContain("cannot have body");
  }
});

test("fetch() POST with body should be allowed", async () => {
  try {
    await fetch("http://example.com", {
      method: "POST",
      body: "test data",
    });
  } catch (e: any) {
    // Network errors are acceptable, but not body validation errors
    expect(e.message).not.toContain("cannot have body");
  }
});

test("fetch() with S3 URL should not give protocol error", async () => {
  try {
    await fetch("s3://bucket/key");
  } catch (e: any) {
    // S3 is a supported protocol
    expect(e.message).not.toContain("protocol must be");
  }
});

test("fetch() with valid HTTP URL should not give URL validation errors", async () => {
  try {
    await fetch("http://example.com");
  } catch (e: any) {
    // Network errors are fine, but should not be URL validation errors
    expect(e.message).not.toContain("must not be empty");
    expect(e.message).not.toContain("must include a hostname");
    expect(e.message).not.toContain("URL is invalid");
    expect(e.message).not.toContain("protocol must be");
  }
});

test("fetch() with valid HTTPS URL should not give URL validation errors", async () => {
  try {
    await fetch("https://example.com");
  } catch (e: any) {
    // Network errors are fine, but should not be URL validation errors
    expect(e.message).not.toContain("must not be empty");
    expect(e.message).not.toContain("must include a hostname");
    expect(e.message).not.toContain("URL is invalid");
    expect(e.message).not.toContain("protocol must be");
  }
});
