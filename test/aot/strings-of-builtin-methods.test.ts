// A method that the file adds to a built-in class evaluates an assignment of a function: it is compiled where the string follows
// from the constants that the file passes, and interpreted where it doesn't.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const timeout = 600_000;

const source = (format: string) => `
Date.formatters = { count: 0 };
Date.prototype.formatted = function (format) {
  if (Date.formatters[format] == null) Date.createFormatter(format);
  return this[Date.formatters[format]]();
};
Date.createFormatter = function (format) {
  var name = "formatter" + Date.formatters.count++;
  Date.formatters[format] = name;
  var code = "Date.prototype." + name + " = function () { return ";
  for (var i = 0; i < format.length; ++i) code += Date.codeOf(format.charAt(i));
  eval(code.substring(0, code.length - 3) + ";}");
};
Date.codeOf = function (character) {
  return character === "Y" ? "this.getUTCFullYear() + " : "'" + character.replace(/('|\\\\)/g, "\\\\$1") + "' + ";
};
var date = new Date(0);
console.log(date.formatted("Y"), date.formatted(${format}));`;

async function run(format: string) {
  using dir = tempDir("aot-builtin-methods", { "main.cjs": source(format) });
  const [executable, counts] = [join(String(dir), "program"), join(String(dir), "counts")];
  const command = [bunExe(), ...compileCommand, ...withoutDebugInformation(), "main.cjs", "--outfile", executable];
  built(await spawned(command, String(dir), bunEnv));
  const ran = await spawned([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
  const interpreted = /^(\d+)\tcounter:InterpretedFunctionCode$/m.exec(readFileSync(counts, "utf8"));
  return { stdout: ran.stdout, exitCode: ran.exitCode, isInterpreted: Number(interpreted?.[1]) > 0 };
}

describe.concurrent("compile/aot/strings of methods of built-in classes", () => {
  test.each([
    ["are compiled", `"'Y'"`, "1970 '1970'\n", false],
    ["are interpreted where they change", `process.argv[0] && "'Y"`, "1970 '1970\n", true],
  ])(
    "%s",
    (_, format, stdout, isInterpreted) =>
      slot(async () => expect(await run(format)).toEqual({ stdout, exitCode: 0, isInterpreted })),
    timeout,
  );
});
