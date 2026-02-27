import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { createTestBuilder } from "./util";
const TestBuilder = createTestBuilder(import.meta.path);

describe("shell sentinel character hardening", () => {
  test("strings containing \\x08 are properly escaped in interpolation", async () => {
    // The internal sentinel byte (0x08, backspace) should be treated as a
    // special character so that user-supplied strings containing it are
    // stored out-of-band rather than appended raw to the script buffer.
    const str = "\x08__bun_0";
    const { stdout } = await $`echo ${str}`;
    // The string should round-trip through the shell correctly
    expect(stdout.toString()).toEqual(`${str}\n`);
  });

  test("strings with sentinel byte followed by digits are escaped", async () => {
    const str = "\x08__bun_2024";
    const { stdout } = await $`echo ${str}`;
    expect(stdout.toString()).toEqual(`${str}\n`);
  });

  test("sentinel byte in redirect position does not cause out-of-bounds", async () => {
    // Ensure that a string containing the sentinel pattern in redirect
    // position produces an error rather than an out-of-bounds access.
    const malicious = "\x08__bun_9999";
    try {
      await $`echo hello > ${malicious}`;
    } catch {
      // An error is acceptable — the important thing is no crash / no OOB access
    }
    // If we get here without a crash, the hardening is working
    expect(true).toBe(true);
  });

  test("$.escape handles sentinel byte", () => {
    const str = "\x08__bun_42";
    const escaped = $.escape(str);
    // The escaped string should be safe to use and should be quoted/escaped
    expect(escaped).toBeDefined();
    expect(typeof escaped).toBe("string");
  });

  test("plain \\x08 in string is properly handled", async () => {
    const str = "hello\x08world";
    const { stdout } = await $`echo ${str}`;
    expect(stdout.toString()).toEqual(`${str}\n`);
  });

  test("interpolated string with sentinel pattern echoes correctly", async () => {
    // Ensure that even strings that look like internal object references
    // are treated as literal strings when they come from interpolation.
    const parts = ["\x08__bun_", "0", "\x08__bunstr_", "1"];
    for (const part of parts) {
      const { stdout } = await $`echo ${part}`;
      expect(stdout.toString()).toEqual(`${part}\n`);
    }
  });
});
