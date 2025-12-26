/**
 * Regression test for issue #25579
 * $.cwd('.') does not work
 *
 * @see https://github.com/oven-sh/bun/issues/25579
 */
import { describe, expect, test } from "bun:test";

describe("Shell cwd with dot", () => {
  test("$.cwd('.') should work and use current directory", async () => {
    const result = await Bun.$`pwd`.cwd(".").text();
    expect(result.trim()).toBe(process.cwd());
  });

  test("$.cwd('./') should work and use current directory", async () => {
    const result = await Bun.$`pwd`.cwd("./").text();
    expect(result.trim()).toBe(process.cwd());
  });

  test("$.cwd('') should work and use current directory", async () => {
    const result = await Bun.$`pwd`.cwd("").text();
    expect(result.trim()).toBe(process.cwd());
  });

  test("$.cwd() without argument should work", async () => {
    const result = await Bun.$`pwd`.cwd().text();
    expect(result.trim()).toBe(process.cwd());
  });

  test("$.cwd('/tmp') should work with absolute path", async () => {
    const result = await Bun.$`pwd`.cwd("/tmp").text();
    // On macOS, /tmp is symlinked to /private/tmp
    expect(result.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
  });
});
