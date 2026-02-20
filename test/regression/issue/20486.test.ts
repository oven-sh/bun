import { expect, test } from "bun:test";

// GitHub Issue #20486: Native fetch incompatibilities with NodeJS error format and codes
// Fetch errors should be TypeError with "fetch failed" message and a .cause property
// containing the detailed error information, matching Node.js behavior.

test("fetch DNS failure returns TypeError with ENOTFOUND cause", async () => {
  try {
    await fetch("http://non-existing-domain-ever.com/");
    expect.unreachable();
  } catch (e: any) {
    // Outer error should be a TypeError with message "fetch failed"
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe("fetch failed");

    // Should have a .cause property
    expect(e.cause).toBeDefined();
    expect(e.cause).toBeInstanceOf(Error);

    // Cause should have ENOTFOUND code and getaddrinfo syscall
    expect(e.cause.code).toBe("ENOTFOUND");
    expect(e.cause.syscall).toBe("getaddrinfo");
    expect(e.cause.hostname).toBe("non-existing-domain-ever.com");
  }
}, 30_000);

test("fetch connection refused returns TypeError with ECONNREFUSED cause", async () => {
  try {
    await fetch("http://localhost:19999/");
    expect.unreachable();
  } catch (e: any) {
    // Outer error should be a TypeError with message "fetch failed"
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe("fetch failed");

    // Should have a .cause property
    expect(e.cause).toBeDefined();
    expect(e.cause).toBeInstanceOf(Error);

    // Cause should have ECONNREFUSED code and connect syscall
    expect(e.cause.code).toBe("ECONNREFUSED");
    expect(e.cause.syscall).toBe("connect");
  }
});

test("fetch invalid URL returns TypeError with ERR_INVALID_URL cause", async () => {
  try {
    await fetch("invalid-url");
    expect.unreachable();
  } catch (e: any) {
    // Outer error should be a TypeError
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe("Failed to parse URL from invalid-url");

    // Should have a .cause property that is also a TypeError
    expect(e.cause).toBeDefined();
    expect(e.cause).toBeInstanceOf(TypeError);

    // Cause should have ERR_INVALID_URL code and input property
    expect(e.cause.code).toBe("ERR_INVALID_URL");
    expect(e.cause.input).toBe("invalid-url");
  }
});

test("fetch invalid protocol returns TypeError with cause", async () => {
  try {
    await fetch("ftp://example.com");
    expect.unreachable();
  } catch (e: any) {
    // Outer error should be a TypeError with "fetch failed" message
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe("fetch failed");

    // Should have a .cause property
    expect(e.cause).toBeDefined();
    expect(e.cause).toBeInstanceOf(Error);
    expect(e.cause.message).toBe("unknown scheme");
  }
});

test("fetch DNS failure is distinguishable from connection refused", async () => {
  // DNS failure
  let dnsError: any;
  try {
    await fetch("http://non-existing-domain-ever.com/");
  } catch (e: any) {
    dnsError = e;
  }

  // Connection refused
  let connError: any;
  try {
    await fetch("http://localhost:19999/");
  } catch (e: any) {
    connError = e;
  }

  // Both should be TypeErrors with "fetch failed" message
  expect(dnsError).toBeInstanceOf(TypeError);
  expect(connError).toBeInstanceOf(TypeError);
  expect(dnsError.message).toBe("fetch failed");
  expect(connError.message).toBe("fetch failed");

  // But their causes should have different error codes
  expect(dnsError.cause.code).toBe("ENOTFOUND");
  expect(connError.cause.code).toBe("ECONNREFUSED");

  // And different syscalls
  expect(dnsError.cause.syscall).toBe("getaddrinfo");
  expect(connError.cause.syscall).toBe("connect");
}, 30_000);
