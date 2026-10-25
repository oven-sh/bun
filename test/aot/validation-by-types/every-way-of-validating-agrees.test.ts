// `validate<T>(value)` and `JSON.parse<T>(text)` give the same answer however the program is run, and so does
// `new Bun.Validator(schema)` with the JSON Schema that says the same as `T`.
//
// every-way-of-validating-agrees/types.jsonl   one case a line: a type, its schema, and values that fit it. The types are those that the programs in test/aot validate by.
// every-way-of-validating-agrees/driver.ts     changes the values in many ways and prints what each validator answers: the result, or the error's message
// every-way-of-validating-agrees/expected.txt  what it prints. UPDATE_EXPECTED=1 writes it again from `bun run`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../harness/run";
import { unsupported } from "../run-programs";

const kept = join(import.meta.dir, "every-way-of-validating-agrees");
type Case = { declarations: string; type: string; samples: string[]; schema: unknown };
const cases: Case[] = readFileSync(join(kept, "types.jsonl"), "utf8")
  .trimEnd()
  .split("\n")
  .map(line => JSON.parse(line));

// A type with a default value takes no reviver.

const byTypes = `import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { add, print } from "./driver";
${cases
  .map(
    ({ declarations, type, samples }) => `{
  ${declarations}
  add(${JSON.stringify(samples)}, value => validate<${type}>(value), text => JSON.parse<${type}>(text), ${
    (declarations + type).includes("Schema.Default<")
      ? "undefined"
      : `(text, reviver) => JSON.parse<${type}>(text, reviver)`
  });
}`,
  )
  .join("\n")}
print();
`;

const bySchemas = `import { add, print } from "./driver";
import { readFileSync } from "node:fs";
for (const line of readFileSync(${JSON.stringify(join(kept, "types.jsonl"))}, "utf8").trimEnd().split("\\n")) {
  const { samples, schema } = JSON.parse(line);
  const validator = new Bun.Validator(schema);
  const revive = line.includes('"default":') ? undefined : (text, reviver) => validator.parse(text, reviver);
  add(samples, value => validator.validate(value), text => validator.parse(text), revive);
}
print();
`;

let folder: string;
beforeAll(() => {
  folder = String(
    tempDir("every-way-of-validating-agrees", {
      "driver.ts": readFileSync(join(kept, "driver.ts"), "utf8"),
      "types.ts": byTypes,
      "schemas.ts": bySchemas,
      "types.test.ts": `import "./types.ts";\ntest("the program ran", () => {});`,
    }),
  );
});

afterAll(() => rmSync(folder, { recursive: true, force: true }));

const executable = (name: string) => join(folder, isWindows ? name + ".exe" : name);
type Result = { stdout: string; stderr: string; exitCode: number };
async function buildAndRun(flags: string[], output: string[]): Promise<Result> {
  const built = await run([bunExe(), "build", "./types.ts", ...flags], folder);
  return built.exitCode ? built : run(output, folder);
}

const ways: Record<string, () => Promise<Result>> = {
  "bun run": () => run([bunExe(), "run", "./types.ts"], folder),
  "bun test": async () => {
    const { stdout, ...rest } = await run([bunExe(), "test", "./types.test.ts"], folder);
    return { stdout: stdout.slice(stdout.indexOf("# 0\n")), ...rest };
  },
  "bun build --target=bun": () =>
    buildAndRun(["--target=bun", "--outfile", "bundle.js"], [bunExe(), "run", "./bundle.js"]),
  "bun build --compile": () => buildAndRun(["--compile", "--outfile", executable("plain")], [executable("plain")]),
  "bun run --aot": () => run([bunExe(), "run", "--aot", "./types.ts"], folder),
  "bun build --compile --aot": () =>
    buildAndRun(["--compile", "--aot", "--outfile", executable("compiled")], [executable("compiled")]),
  "new Bun.Validator(schema)": () => run([bunExe(), "run", "./schemas.ts"], folder),
};

/** The answers by case: `# <index>` begins one. */
function answersOf(stdout: string): string[][] {
  return stdout
    .replaceAll("\r\n", "\n")
    .split(/^# \d+\n/m)
    .slice(1)
    .map(part => part.trimEnd().split("\n"));
}

const hasValidator = typeof (Bun as any).Validator === "function";

for (const way of Object.keys(ways)) {
  const it =
    way.startsWith("new Bun.Validator") && !hasValidator
      ? test.todo
      : test.skipIf(way.endsWith("--aot") && !!unsupported);
  it(
    way,
    async () => {
      const { stdout, stderr, exitCode } = await ways[way]();
      if (process.env.UPDATE_EXPECTED && way === "bun run") writeFileSync(join(kept, "expected.txt"), stdout);
      const expected = answersOf(readFileSync(join(kept, "expected.txt"), "utf8"));
      const answers = answersOf(stdout);
      // The first line that differs in each case, for at most 20 cases.
      const differences: object[] = [];
      for (const [index, lines] of expected.entries()) {
        const received = answers[index] ?? [];
        const at = lines.findIndex((line, i) => line !== received[i]);
        if (at < 0 && lines.length === received.length) continue;
        const i = at < 0 ? lines.length : at;
        differences.push({ case: index, type: cases[index].type, expected: lines[i], received: received[i] });
        if (differences.length === 20) break;
      }
      expect({ differences, cases: answers.length, stderr: exitCode ? stderr.slice(0, 4000) : "", exitCode }).toEqual({
        differences: [],
        cases: cases.length,
        stderr: "",
        exitCode: 0,
      });
    },
    isASAN || isDebug ? 1_800_000 : 300_000,
  );
}
