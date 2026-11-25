// What the front end lowers a regular expression literal to goes by what the engine says of its pattern. The tests of ./ir link no engine, so
// there every literal is a NewRegExp. Here a Bun that has the engine writes its program with --aot-out, and `testaot print` prints it.
//
//   fromRecord    the pattern can be built: NewRegExp, which cannot throw
//   neverBuilt    the pattern can never be built: the SyntaxError is made and thrown, nothing parses the pattern, and what stands behind the literal is gone
//   nestedDeep    nested deeper than the build analyzes: a call of RegExp, whose error becomes the SyntaxError that a literal throws
//
// What such literals answer is held by the programs of ./parallel/regexp.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { built, spawned } from "./harness/commands";
import { buildFlags, compileCommand, withProgramOutput } from "./harness/flags";
import { test } from "./supported";

// Above Limits::regExpParenthesesDepth of the engine, which is 256.
const depth = 300;

const program = `
function fromRecord() {
  return /a+/;
}
function neverBuilt() {
  const re = /a{2147483648}a{2147483648}/;
  return behind(re);
}
function nestedDeep() {
  return /${"(".repeat(depth)}a${")".repeat(depth)}/;
}
function behind(re: RegExp) {
  return re.source;
}
for (const create of [fromRecord, neverBuilt, nestedDeep]) {
  try {
    console.log(String(create()));
  } catch (error) {
    console.log(String(error));
  }
}
`;

const watchedOperations = /^(?:NewRegExp|Construct\w*|Call\w*|CatchValue|Throw|Return\w*)$/;

const declared = without("testaot") ? test.skip : test;

declared("a literal is lowered by what the engine says of its pattern", async () => {
  using folder = tempDir("aot-regexp-literal-forms", { "main.ts": program });
  const file = join(String(folder), "program.aot");
  // Nothing here runs the program.
  const flags = [withProgramOutput(file), buildFlags.withoutExecutable];
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.ts"], String(folder), bunEnv));
  const { lines, stderr, exitCode } = await run("print", file);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

  function bodyOf(name: string) {
    const head = lines.findIndex(line => line.startsWith("function ") && line.includes(` name="${name}"`));
    return head < 0 ? [] : lines.slice(head + 1, lines.indexOf("}", head));
  }
  const operationsOf = (name: string) =>
    bodyOf(name)
      .flatMap(line => /^ {4}(?:v\d+ = )?([A-Z]\w*)/.exec(line)?.[1] ?? [])
      .filter(operation => watchedOperations.test(operation))
      .sort();
  const constructorsOf = (name: string) =>
    bodyOf(name)
      .filter(line => line.includes(" = Builtin "))
      .flatMap(line => line.match(/\b(?:RegExp|SyntaxError)\b/g) ?? [])
      .sort();

  expect({
    fromRecord: operationsOf("fromRecord"),
    neverBuilt: operationsOf("neverBuilt"),
    nestedDeep: operationsOf("nestedDeep"),
  }).toEqual({
    fromRecord: ["NewRegExp", "Return"],
    neverBuilt: ["Construct", "Throw"],
    nestedDeep: ["CatchValue", "Construct", "Construct", "Return", "Throw"],
  });
  expect({ neverBuilt: constructorsOf("neverBuilt"), nestedDeep: constructorsOf("nestedDeep") }).toEqual({
    neverBuilt: ["SyntaxError"],
    nestedDeep: ["RegExp", "SyntaxError"],
  });

  const neverBuilt = bodyOf("neverBuilt").join("\n");
  expect(neverBuilt).toContain("Invalid regular expression: ");
  expect(neverBuilt).not.toContain("2147483648");
  expect(bodyOf("nestedDeep").join("\n")).toContain("Invalid regular expression: too many nested disjunctions");
});
