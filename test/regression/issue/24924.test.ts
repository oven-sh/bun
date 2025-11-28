import { expect, test } from "bun:test";
import { tls } from "harness";
import * as http2 from "http2";

test("Http2Server.setTimeout returns server instance for method chaining", () => {
  const server = http2.createServer();

  try {
    const result = server.setTimeout(1000);
    expect(result).toBe(server);
  } finally {
    server.close();
  }
});

test("Http2Server.setTimeout with callback returns server instance", () => {
  const server = http2.createServer();
  const callback = () => {};

  try {
    const result = server.setTimeout(1000, callback);
    expect(result).toBe(server);
  } finally {
    server.close();
  }
});

test("Http2Server.setTimeout allows method chaining with close", () => {
  const server = http2.createServer();

  // This should not throw - chaining should work
  expect(() => {
    server.setTimeout(1000).close();
  }).not.toThrow();
});

test("Http2SecureServer.setTimeout returns server instance for method chaining", () => {
  const server = http2.createSecureServer(tls);

  try {
    const result = server.setTimeout(1000);
    expect(result).toBe(server);
  } finally {
    server.close();
  }
});

test("Http2SecureServer.setTimeout with callback returns server instance", () => {
  const server = http2.createSecureServer(tls);
  const callback = () => {};

  try {
    const result = server.setTimeout(1000, callback);
    expect(result).toBe(server);
  } finally {
    server.close();
  }
});

test("Http2SecureServer.setTimeout allows method chaining with close", () => {
  const server = http2.createSecureServer(tls);

  // This should not throw - chaining should work
  expect(() => {
    server.setTimeout(1000).close();
  }).not.toThrow();
});
