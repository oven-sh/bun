import { describe, expect, test } from "bun:test";
import { parseEnv } from "node:util";

// Node.js parity: these are the grammar rules where Bun's own dotenv parser
// intentionally differs, but `util.parseEnv` must match Node exactly.
// Reference: node's src/node_dotenv.cc Dotenv::ParseContent.
describe("util.parseEnv node-parity grammar", () => {
  test("does not accept YAML-style ': ' as a separator", () => {
    expect(parseEnv("A: 1\nB=2\n")).toEqual({ B: "2" });
  });

  test("does not join a key across a newline to find '='", () => {
    expect(parseEnv("A\n=1\nB=2\n")).toEqual({ B: "2" });
  });

  test("trims only space/tab/newline (not VT, FF, NBSP)", () => {
    expect(parseEnv("A=\x0Bv\x0C\n")).toEqual({ A: "\x0Bv\x0C" });
    expect(parseEnv("A=\xA0v\xA0\n")).toEqual({ A: "\xA0v\xA0" });
  });

  test("backslash does not escape the closing single quote", () => {
    expect(parseEnv("A='a\\'b'\n")).toEqual({ A: "a\\" });
  });

  test("backslash does not escape the closing backtick", () => {
    expect(parseEnv("A=`a\\`b`\n")).toEqual({ A: "a\\" });
  });

  test("backslash does not escape the closing double quote", () => {
    expect(parseEnv('A="a\\nb\\tc\\"d"\n')).toEqual({ A: "a\nb\\tc\\" });
  });

  test("only \\n is expanded inside double quotes (not \\r or \\t)", () => {
    expect(parseEnv('A="a\\rb"\n')).toEqual({ A: "a\\rb" });
    expect(parseEnv('A="a\\tb"\n')).toEqual({ A: "a\\tb" });
    expect(parseEnv('A="a\\nb"\n')).toEqual({ A: "a\nb" });
  });

  test("\\n is not expanded inside single quotes or backticks", () => {
    expect(parseEnv("A='a\\nb'\n")).toEqual({ A: "a\\nb" });
    expect(parseEnv("A=`a\\nb`\n")).toEqual({ A: "a\\nb" });
  });

  test("key has no character-set restriction", () => {
    expect(parseEnv('"A"=1\nB=2\n')).toEqual({ '"A"': "1", B: "2" });
    expect(parseEnv("A#B=1\n")).toEqual({ "A#B": "1" });
  });

  test("lone \\r is stripped, not treated as a line break", () => {
    expect(parseEnv("A=1\rB=2\r")).toEqual({ A: "1B=2" });
    expect(parseEnv("A=1\r2\n")).toEqual({ A: "12" });
    expect(parseEnv("A='1\r2'\n")).toEqual({ A: "12" });
  });

  test("'=' alone stores an empty key when followed by newline", () => {
    expect(parseEnv("=\nB=2\n")).toEqual({ "": "", B: "2" });
  });

  test("empty key with a value is skipped", () => {
    expect(parseEnv("=x\nB=2\n")).toEqual({ B: "2" });
    expect(parseEnv("   =val\n")).toEqual({});
  });

  test("CRLF line endings are handled", () => {
    expect(parseEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });

  test("unclosed quote takes the rest of the line including the quote char", () => {
    expect(parseEnv("A='unclosed\nB=2\n")).toEqual({ A: "'unclosed", B: "2" });
    expect(parseEnv('A="unclosed\nB=2\n')).toEqual({ A: '"unclosed', B: "2" });
    expect(parseEnv("A=`unclosed\nB=2\n")).toEqual({ A: "`unclosed", B: "2" });
  });

  test("multiline quoted values", () => {
    expect(parseEnv("A='line1\nline2'\nB=2\n")).toEqual({ A: "line1\nline2", B: "2" });
    expect(parseEnv('A="line1\nline2"\nB=2\n')).toEqual({ A: "line1\nline2", B: "2" });
    expect(parseEnv("A=`line1\nline2`\nB=2\n")).toEqual({ A: "line1\nline2", B: "2" });
  });

  test("'export ' prefix is stripped from the key", () => {
    expect(parseEnv("export FOO=bar\n")).toEqual({ FOO: "bar" });
    expect(parseEnv("export   FOO=bar\n")).toEqual({ FOO: "bar" });
    expect(parseEnv("export=1\n")).toEqual({ export: "1" });
    expect(parseEnv("export export=1\n")).toEqual({ export: "1" });
  });

  test("inline '#' starts a comment only in unquoted values", () => {
    expect(parseEnv("A=val # comment\n")).toEqual({ A: "val" });
    expect(parseEnv("A=#val\n")).toEqual({ A: "" });
    expect(parseEnv("A='val # not comment'\n")).toEqual({ A: "val # not comment" });
  });

  test("last assignment wins", () => {
    expect(parseEnv("FOO=bar\nFOO=baz\n")).toEqual({ FOO: "baz" });
  });

  test("keys are case-sensitive on every platform", () => {
    expect(parseEnv("FOO=1\nfoo=2\n")).toEqual({ FOO: "1", foo: "2" });
  });

  test("empty and whitespace-only input", () => {
    expect(parseEnv("")).toEqual({});
    expect(parseEnv("   \n\t\n")).toEqual({});
    expect(parseEnv("# comment only\n")).toEqual({});
  });

  test("key and value with no trailing newline", () => {
    expect(parseEnv("A=1")).toEqual({ A: "1" });
    expect(parseEnv("A='1'")).toEqual({ A: "1" });
    expect(parseEnv("A=")).toEqual({ A: "" });
  });

  test("does not perform ${} or $ expansion", () => {
    expect(parseEnv("A=1\nB=$A\n")).toEqual({ A: "1", B: "$A" });
    expect(parseEnv("A=1\nB=${A}\n")).toEqual({ A: "1", B: "${A}" });
    expect(parseEnv("A=1\nB='$A'\n")).toEqual({ A: "1", B: "$A" });
  });

  test("throws ERR_INVALID_ARG_TYPE for non-string input", () => {
    for (const value of [null, undefined, {}, [], 42, true]) {
      expect(() => parseEnv(value as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    }
  });
});
