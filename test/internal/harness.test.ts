// Tests for the behavior of test/harness.ts itself.
import { expect, test } from "bun:test";
import { randomPort } from "harness";

// The kernel assigns `port: 0` and outgoing connections from 32768-60999 on
// Linux and from 49152-65535 on macOS and Windows. A harness-chosen port in
// those ranges can have the same number as another process's `port: 0` server.
// macOS then sends that server's 127.0.0.1 connections to the harness-chosen
// listener: serve.test.ts received the verdaccio web UI page (1160 bytes) in
// place of its own 8 MiB body.
test("randomPort() stays below the ports the kernel assigns", () => {
  const ports = Array.from({ length: 10_000 }, randomPort);
  expect(ports.every(Number.isInteger)).toBe(true);
  expect(Math.min(...ports)).toBeGreaterThanOrEqual(1024);
  expect(Math.max(...ports)).toBeLessThan(32768);
});
