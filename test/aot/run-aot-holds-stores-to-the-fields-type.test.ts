import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { test } from "./supported";

// A store from untyped code into an object of a declared type is held to the type of the field. `bun run --aot` prints what is recorded of the executable.
const programs = join(import.meta.dir, "programs");

test.concurrent.each([
  "type-rules/null-and-undefined-in-fields",
  "type-rules/objects-reaching-untyped-code-indirectly",
  "type-rules/required-fields-and-numbers-cannot-be-cleared",
  "typed-objects/typescript-unsoundness-reaching-primitive-types",
  "type-rules/literals-made-with-their-discriminant-keep-their-shape",
])("%s", async name => {
  const file = existsSync(join(programs, name + ".ts")) ? join(programs, name + ".ts") : join(programs, name, "main.ts");
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", "--aot", file], cwd: dirname(file), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"), exitCode: 0 });
});
