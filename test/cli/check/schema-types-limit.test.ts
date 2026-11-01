// `value.someName` on a `FromSchema<Schema>` whose `Schema` is a type parameter asks for the base constraint of the type: a family of conditional aliases that name one
// another, evaluated on the type of all schemas. TypeScript gives up: "Type instantiation is excessively deep" and "a union type that is too complex", after millions of
// instantiations. The checker has the same limits and went toward them at 75 microseconds an instantiation: it had not ended after an hour. Two things took the time,
// neither of them TypeScript's: for each restrictive, permissive or unique-literal instantiation it walked the whole graph of types under the type for the type parameters
// in it, and where it distributes an intersection over unions it looked at every member of every union for `null` and `undefined`.
//
// schema.d.ts.txt is cut by a script from the declaration files of two packages (LICENSE beside it). It is a text, because `tsc` checks every .ts file under test/. It is
// as long as it is because what the checker of before took goes by the size of the graphs: cut further, it ended within a minute.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../aot/harness/run";
import { test } from "../../aot/listed";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      skipLibCheck: true,
      types: [],
    },
    files: ["ask.ts"],
  }),
  "schema.d.ts": readFileSync(join(import.meta.dir, "schema-types-limit", "schema.d.ts.txt"), "utf8"),
  "ask.ts": `import type { FromSchema, JSONSchema } from "./schema";
export function ask<const Schema extends Exclude<JSONSchema, boolean> & { type: "object" }>(value: FromSchema<Schema>) {
  return value.someName;
}
`,
};

// Millions of instantiations: seconds for the Bun that ships.
test.skipIf(isASAN || isDebug)(
  "gives up where TypeScript does",
  async () => {
    using dir = tempDir("check-schema-types-limit", files);
    const { stdout, stderr, exitCode } = await run([bunExe(), "check"], String(dir), bunEnv);
    expect({ errors: (stdout + stderr).split("\n").filter(line => /error TS|^error:/.test(line)), exitCode }).toEqual({
      errors: [
        "ask.ts(3,10): error TS2589: Type instantiation is excessively deep and possibly infinite.",
        "ask.ts(3,10): error TS2590: Expression produces a union type that is too complex to represent.",
      ],
      exitCode: 1,
    });
  },
  90_000,
);
