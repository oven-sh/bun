import { $ } from "bun";
import { describe, expect, test } from "bun:test";

describe("echo -e flag support", () => {
  test("echo -e does not output -e as literal text", async () => {
    const result = await $`echo -e hello`.text();
    expect(result).toBe("hello\n");
  });

  test("echo -e interprets backslash-n", async () => {
    const result = await $`echo -e ${"hello\\nworld"}`.text();
    expect(result).toBe("hello\nworld\n");
  });

  test("echo -e interprets backslash-t", async () => {
    const result = await $`echo -e ${"hello\\tworld"}`.text();
    expect(result).toBe("hello\tworld\n");
  });

  test("echo -e interprets backslash-backslash", async () => {
    const result = await $`echo -e ${"hello\\\\world"}`.text();
    expect(result).toBe("hello\\world\n");
  });

  test("echo -e interprets \\a (bell)", async () => {
    const result = await $`echo -e ${"\\a"}`.text();
    expect(result).toBe("\x07\n");
  });

  test("echo -e interprets \\b (backspace)", async () => {
    const result = await $`echo -e ${"a\\bb"}`.text();
    expect(result).toBe("a\bb\n");
  });

  test("echo -e interprets \\r (carriage return)", async () => {
    const result = await $`echo -e ${"hello\\rworld"}`.text();
    expect(result).toBe("hello\rworld\n");
  });

  test("echo -e interprets \\f (form feed)", async () => {
    const result = await $`echo -e ${"\\f"}`.text();
    expect(result).toBe("\f\n");
  });

  test("echo -e interprets \\v (vertical tab)", async () => {
    const result = await $`echo -e ${"\\v"}`.text();
    expect(result).toBe("\v\n");
  });

  test("echo -e interprets \\0nnn (octal)", async () => {
    // \0101 = 'A' (65 decimal)
    const result = await $`echo -e ${"\\0101"}`.text();
    expect(result).toBe("A\n");
  });

  test("echo -e interprets \\xHH (hex)", async () => {
    // \x41 = 'A'
    const result = await $`echo -e ${"\\x41\\x42\\x43"}`.text();
    expect(result).toBe("ABC\n");
  });

  test("echo -e \\c stops output", async () => {
    const result = await $`echo -e ${"hello\\cworld"}`.text();
    expect(result).toBe("hello");
  });

  test("echo -e with \\e (escape character)", async () => {
    const result = await $`echo -e ${"\\e"}`.text();
    expect(result).toBe("\x1b\n");
  });

  test("echo -E disables escape interpretation", async () => {
    const result = await $`echo -E ${"hello\\nworld"}`.text();
    expect(result).toBe("hello\\nworld\n");
  });

  test("echo -eE (last wins: -E disables)", async () => {
    const result = await $`echo -eE ${"hello\\tworld"}`.text();
    expect(result).toBe("hello\\tworld\n");
  });

  test("echo -Ee (last wins: -e enables)", async () => {
    const result = await $`echo -Ee ${"hello\\tworld"}`.text();
    expect(result).toBe("hello\tworld\n");
  });

  test("echo -ne (no newline + escapes)", async () => {
    const result = await $`echo -ne ${"hello\\tworld"}`.text();
    expect(result).toBe("hello\tworld");
  });

  test("echo -en (same as -ne)", async () => {
    const result = await $`echo -en ${"hello\\tworld"}`.text();
    expect(result).toBe("hello\tworld");
  });

  test("echo -n still works (no newline)", async () => {
    const result = await $`echo -n hello`.text();
    expect(result).toBe("hello");
  });

  test("echo with invalid flag outputs literally", async () => {
    const result = await $`echo -x hello`.text();
    expect(result).toBe("-x hello\n");
  });

  test("echo -e piped to cat (original issue scenario)", async () => {
    const pw = "mypassword";
    const result = await $`echo -e ${pw} | cat`.text();
    expect(result).toBe("mypassword\n");
  });

  test("echo without -e still works normally", async () => {
    const result = await $`echo hello world`.text();
    expect(result).toBe("hello world\n");
  });
});
