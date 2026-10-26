/**
 * Node expands a short option group into one arg per member ('-axb' into '-a', '-x', '-b'), so
 * the raw name of a member is '-' and that member:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/parse_args/parse_args.js#L234-L251
 * The strict error messages and `tokens[].rawName` both print that raw name.
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`,
 * which is where the expected values (including the exact error messages) come from. It cannot
 * import from "harness" for the same reason, so it manages its own temporary directory.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parseArgs, type ParseArgsConfig } from "node:util";

const options: ParseArgsConfig["options"] = {
  a: { type: "boolean", short: "a" },
  b: { type: "boolean", short: "b" },
  foo: { type: "string", short: "f" },
  bar: { type: "boolean" },
};

function thrown(config: ParseArgsConfig) {
  try {
    parseArgs(config);
  } catch (e) {
    const { name, code, message } = e as NodeJS.ErrnoException;
    return { name, code, message };
  }
}

function optionTokens(config: ParseArgsConfig) {
  const { tokens } = parseArgs({ ...config, tokens: true as const });
  return tokens.flatMap(token => (token.kind === "option" ? [token] : []));
}

function codeUnits(str: string) {
  return Array.from({ length: str.length }, (_, i) => str.charCodeAt(i));
}

describe("util.parseArgs: raw name of an option inside a short option group", () => {
  const rows: [args: string[], rawName: string][] = [
    [["-axb"], "-x"],
    [["-xa"], "-x"],
    [["-ax"], "-x"],
    [["-axfVAL"], "-x"],
    [["-a=5"], "-="],
    [["-a1"], "-1"],
    [["-a\u00e9"], "-\u00e9"],
    [["-a\u4e2d"], "-\u4e2d"],
    [["-ax\u4e2d"], "-x"],
  ];
  for (const [args, rawName] of rows) {
    test(`unknown option in ${JSON.stringify(args)} is named ${JSON.stringify(rawName)}`, () => {
      assert.deepStrictEqual(thrown({ args, options }), {
        name: "TypeError",
        code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        message: `Unknown option '${rawName}'`,
      });
      assert.deepStrictEqual(thrown({ args, options, allowPositionals: true }), {
        name: "TypeError",
        code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        message: `Unknown option '${rawName}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- ${JSON.stringify(rawName)}`,
      });
      assert.ok(optionTokens({ args, options, strict: false }).some(token => token.rawName === rawName));
    });
  }

  test("ambiguous value of a string option that ends a group", () => {
    assert.deepStrictEqual(thrown({ args: ["-af", "--bar"], options }), {
      name: "TypeError",
      code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
      message:
        "Option '-f' argument is ambiguous.\n" +
        "Did you forget to specify the option argument for '-f'?\n" +
        "To specify an option argument starting with a dash use '--foo=-XYZ' or '-f-XYZ'.",
    });
  });

  test("unknown option in a group taken from process.argv", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parse-args-short-group-"));
    try {
      const script = path.join(dir, "script.mjs");
      fs.writeFileSync(
        script,
        `import { parseArgs } from "node:util";
try {
  parseArgs({ options: { a: { type: "boolean", short: "a" } } });
} catch (e) {
  console.log(JSON.stringify({ code: e.code, message: e.message }));
}
`,
      );
      const { stdout, status } = spawnSync(process.execPath, [script, "-axb"], { encoding: "utf8" });
      assert.deepStrictEqual(
        { stdout: stdout.trim(), status },
        {
          stdout: JSON.stringify({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION", message: "Unknown option '-x'" }),
          status: 0,
        },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Node splits a group by code unit, so an astral character gives two members, one per surrogate.
  test("tokens[].rawName keeps a member that is a lone surrogate", () => {
    assert.deepStrictEqual(
      optionTokens({ args: ["-a\u{1F600}"], options, strict: false }).map(token => [
        codeUnits(token.name),
        codeUnits(token.rawName),
      ]),
      [
        [[0x61], [0x2d, 0x61]],
        [[0xd83d], [0x2d, 0xd83d]],
        [[0xde00], [0x2d, 0xde00]],
      ],
    );
  });

  test("tokens[].rawName keeps a lone surrogate string option in the middle of a group", () => {
    assert.deepStrictEqual(
      optionTokens({
        args: ["-a\ud83dVAL"],
        options: { a: { type: "boolean", short: "a" }, s: { type: "string", short: "\ud83d" } },
      }).map(token => [token.name, codeUnits(token.rawName), token.value]),
      [
        ["a", [0x2d, 0x61], undefined],
        ["s", [0x2d, 0xd83d], "VAL"],
      ],
    );
  });

  // After the '-', Node prints the lone surrogate. Bun prints U+FFFD: it formats the message as UTF-8.
  const loneSurrogates: [label: string, arg: string][] = [
    ["the first half of a surrogate pair after a known option", "-a\u{1F600}"],
    ["the first half of a surrogate pair", "-\u{1F600}"],
    ["a lone high surrogate", "-a\ud83d"],
    ["a lone low surrogate", "-a\ude00"],
  ];
  for (const [label, arg] of loneSurrogates) {
    test(`unknown option that is ${label} keeps its '-' in the message`, () => {
      const error = thrown({ args: [arg], options });
      assert.strictEqual(error?.code, "ERR_PARSE_ARGS_UNKNOWN_OPTION");
      assert.match(error.message, /^Unknown option '-[^]'$/);
    });
  }

  // Bun converts the element to a string a second time to name the option. When that conversion is
  // empty, `group_member_raw_name` (parse_args.rs) has no member to name. Node does not throw here.
  // https://github.com/oven-sh/bun/pull/46324 removes the second conversion: delete this test with it.
  test("element whose second string conversion is empty", { skip: typeof Bun === "undefined" }, () => {
    const element = () => {
      let conversions = 0;
      return { toString: () => (conversions++ === 0 ? "-axb" : "") } as unknown as string;
    };
    assert.deepStrictEqual(thrown({ args: [element()], options }), {
      name: "TypeError",
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      message: "Unknown option '-'",
    });
    assert.deepStrictEqual(
      optionTokens({ args: [element()], options, strict: false }).map(token => token.rawName),
      ["-", "-", "-"],
    );
  });
});
