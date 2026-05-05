import { expect, test } from "bun:test";

test("TOML multi-line basic strings trim leading newline and handle line ending backslash", () => {
  const toml = `
str1 = "The quick brown fox jumps over the lazy dog."

str2 = """
The quick brown \\


  fox jumps over \\
    the lazy dog."""

str3 = """\\
       The quick brown \\
       fox jumps over \\
       the lazy dog.\\
       """
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str1).toBe("The quick brown fox jumps over the lazy dog.");
  expect(result.str2).toBe("The quick brown fox jumps over the lazy dog.");
  expect(result.str3).toBe("The quick brown fox jumps over the lazy dog.");
});

test("TOML multi-line literal strings trim leading newline", () => {
  const toml = `
str1 = 'The quick brown fox jumps over the lazy dog.'

str2 = '''
The quick brown fox jumps over the lazy dog.'''
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str1).toBe("The quick brown fox jumps over the lazy dog.");
  expect(result.str2).toBe("The quick brown fox jumps over the lazy dog.");
});

test("TOML multi-line basic string with only backslash continuation", () => {
  const toml = `
str = """\\
  hello\\
  world\\
  """
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str).toBe("helloworld");
});

test("TOML multi-line strings without leading newline are unchanged", () => {
  const toml = `
str1 = """no leading newline"""
str2 = '''no leading newline'''
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str1).toBe("no leading newline");
  expect(result.str2).toBe("no leading newline");
});

test("TOML escape sequences produce correct character codes", () => {
  const toml = `
tab = "hello\\tworld"
ff = "hello\\fworld"
`;

  const result = Bun.TOML.parse(toml);
  expect(result.tab).toBe("hello\tworld");
  expect(result.ff).toBe("hello\fworld");
});
