import { expect, test } from "bun:test";
import { parseArgs } from "node:util";

// The ERR_PARSE_ARGS_UNKNOWN_OPTION message for a short option that was reached via a
// short-option group must include the leading '-', matching Node.js. Previously Bun emitted
// "Unknown option 'x'" instead of "Unknown option '-x'".

test("unknown short option inside a group: error message includes leading '-'", () => {
  const args = ["-axb"];
  const options = {
    alpha: { type: "boolean", short: "a" },
    beta: { type: "boolean", short: "b" },
  } as const;

  expect(() => parseArgs({ args, options })).toThrow(
    expect.objectContaining({
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      message: "Unknown option '-x'",
    }),
  );

  expect(() => parseArgs({ args, options, allowPositionals: true })).toThrow(
    expect.objectContaining({
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      message:
        "Unknown option '-x'. To specify a positional argument starting with a '-', " +
        `place it at the end of the command after '--', as in '-- "-x"`,
    }),
  );
});

test("unknown short option from '-x=5' group path: error message includes leading '-'", () => {
  const args = ["-x=5"];
  const options = { xx: { type: "boolean", short: "x" } } as const;

  expect(() => parseArgs({ args, options })).toThrow(
    expect.objectContaining({
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      message: "Unknown option '-='",
    }),
  );
});

test("unknown lone short option: error message already includes leading '-' (baseline)", () => {
  expect(() => parseArgs({ args: ["-w"], options: {} })).toThrow(
    expect.objectContaining({
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      message: "Unknown option '-w'",
    }),
  );
});
