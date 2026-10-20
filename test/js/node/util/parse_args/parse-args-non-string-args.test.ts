import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { parseArgs } from "node:util";

// parseArgs converts an `args` element to a string once. It builds `rawName` and the strict-mode
// messages from that string. An element that is not a string can convert to another string the
// next time, so a second conversion does not have to agree with the first one.
describe("parseArgs: args elements that are not strings", () => {
  const kinds = [
    "object with toString",
    "String subclass with toString",
    "array with toString",
    "object with Symbol.toPrimitive",
    "object with valueOf",
  ];

  // One process runs every case of the fixture. It is not this process, because a second
  // conversion made parseArgs abort the process in the last eight cases.
  let lines: { case: string; kind?: string }[] = [];
  let exitCode: number | undefined;
  beforeAll(async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "parse-args-non-string-args-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    lines = stdout
      .split("\n")
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line));
    exitCode = await proc.exited;
  });

  test.each([
    "strict, unknown lone long option",
    "strict, unknown lone short option",
    "strict, ambiguous value after a lone short option",
    "strict, ambiguous value after a lone long option",
    "strict, allowNegative with a string option",
    "strict, unexpected positional",
    "tokens, --name=value, later string has '=' at another index",
    "tokens, --name=value, later conversion throws",
    "tokens, --name=value",
    "tokens, short option group",
    "tokens, string option inside a short option group",
    "strict, unknown --name=value",
    "strict, unknown --name=value, later string is empty",
    "strict, unknown option in a short option group",
    "strict, ambiguous value after a short option group",
    "args omitted, element in process.argv",
  ])("an element is converted once and parses like that string: %s", name => {
    const [fromString, ...fromElements] = lines.filter(line => line.case === name);
    expect(fromElements).toEqual(kinds.map(kind => ({ ...fromString, kind, conversions: 1 })));
  });

  test("the process that ran the cases exits with code 0", () => {
    expect(exitCode).toBe(0);
  });

  // Node does the same for an element that it reads as an option or as a positional.
  test("a lone option has the element as rawName, and a positional has it as value", () => {
    const short = new String("-f");
    const long = new String("--foo");
    const positional = { toString: () => "pos" };
    const args: any[] = [short, long, positional];
    const { tokens, positionals }: { tokens: any[]; positionals: unknown[] } = parseArgs({
      args,
      strict: false,
      tokens: true,
    });

    expect(tokens.map(token => token.kind)).toEqual(["option", "option", "positional"]);
    expect(tokens[0].rawName).toBe(short);
    expect(tokens[1].rawName).toBe(long);
    expect(tokens[2].value).toBe(positional);
    expect(positionals[0]).toBe(positional);
  });

  test("an element that is not read as a string is not converted", () => {
    let conversions = 0;
    const counted = (string: string) => ({
      toString() {
        conversions++;
        return string;
      },
    });

    // The value of a string option is the next element, as it is.
    const value = counted("value");
    const options = { foo: { type: "string" } } as const;
    expect(parseArgs({ args: ["--foo", value] as any, options, strict: false }).values.foo).toBe(value as any);
    expect(conversions).toBe(0);

    // An element after `--` is a positional, as it is.
    const after = counted("after");
    expect(parseArgs({ args: ["--", after] as any, allowPositionals: true }).positionals[0]).toBe(after as any);
    expect(conversions).toBe(0);

    // The message for a positional that is not allowed converts it.
    expect(() => parseArgs({ args: ["--", after] as any })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
        message: "Unexpected argument 'after'. This command does not take positional arguments",
      }),
    );
    expect(conversions).toBe(1);
  });
});

describe("parseArgs: strict-mode messages name the option as it was written", () => {
  const B = { type: "boolean" } as const;
  const S = { type: "string" } as const;

  test.each([
    ["-w", "-w"],
    ["--nope", "--nope"],
    ["--nope=1", "--nope"],
  ])("unknown option %s", (arg, rawName) => {
    expect(() => parseArgs({ args: [arg] })).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION", message: `Unknown option '${rawName}'` }),
    );
    expect(() => parseArgs({ args: [arg], allowPositionals: true })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        message:
          `Unknown option '${rawName}'. To specify a positional argument starting with a '-', ` +
          `place it at the end of the command after '--', as in '-- "${rawName}"`,
      }),
    );
  });

  // Node prints '-x' for an option of a short option group. The dash is optional in these two tests.
  test.each(["-xa", "-ax", "-axVALUE"])("unknown option x in the short option group %s", arg => {
    expect(() => parseArgs({ args: [arg], options: { a: B } })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        message: expect.stringMatching(/^Unknown option '-?x'$/),
      }),
    );
  });

  test("ambiguous value after a short option group", () => {
    const options = { a: B, file: { type: "string", short: "f" } } as const;
    expect(() => parseArgs({ args: ["-af", "-x"], options })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        message: expect.stringMatching(
          /^Option '-?f' argument is ambiguous\.\nDid you forget to specify the option argument for '-?f'\?\nTo specify an option argument starting with a dash use '--file=-XYZ' or '-?f-XYZ'\.$/,
        ),
      }),
    );
  });

  test("ambiguous value after a lone option", () => {
    const options = { file: { type: "string", short: "f" } } as const;
    expect(() => parseArgs({ args: ["-f", "-x"], options })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        message:
          "Option '-f' argument is ambiguous.\nDid you forget to specify the option argument for '-f'?\n" +
          "To specify an option argument starting with a dash use '--file=-XYZ' or '-f-XYZ'.",
      }),
    );
    expect(() => parseArgs({ args: ["--file", "-x"], options })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        message:
          "Option '--file' argument is ambiguous.\nDid you forget to specify the option argument for '--file'?\n" +
          "To specify an option argument starting with a dash use '--file=-XYZ'.",
      }),
    );
  });

  test("--no-<name> for a string option", () => {
    expect(() => parseArgs({ args: ["--no-foo"], options: { foo: S }, allowNegative: true })).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION", message: "Unknown option '--no-foo'" }),
    );
  });

  test.each([[["pos"]], [["--", "pos"]]])("unexpected positional in %j", args => {
    expect(() => parseArgs({ args })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
        message: "Unexpected argument 'pos'. This command does not take positional arguments",
      }),
    );
  });
});
