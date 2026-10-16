import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { test } from "./supported";

// The prototype object of a class of the program is fixed under --aot. `bun run --aot` prints what is recorded of the executable.
const programs = join(import.meta.dir, "programs");

test.concurrent.each([
  "type-rules/the-prototype-object-of-a-class-is-fixed",
  "type-rules/methods-and-super",
  "type-rules/object-assign",
  "type-rules/for-in",
  "type-rules/accessors-in-typed-code",
  "type-rules/an-optional-field-found-on-a-changed-prototype-chain",
  "type-rules/optional-fields-found-on-the-prototype",
  "calls/inspecting-class-prototypes",
  "classes-and-closures/instanceof-program-classes-in-loops",
  "async-and-generators/iteration-replaced",
  "type-rules/delete-of-a-field-that-is-not-optional",
  "type-rules/delete-of-fields",
  "type-rules/delete-of-required-fields-throws",
  "type-rules/key-order-with-indices-and-symbols",
  "type-rules/objects-changed-during-a-loop",
  "type-rules/stores-through-another-type",
  "type-rules/any-enters-an-annotated-parameter",
  "typed-objects/two-classes-of-one-name",
])("%s", async name => {
  const file = existsSync(join(programs, name + ".ts")) ? join(programs, name + ".ts") : join(programs, name, "main.ts");
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", "--aot", file], cwd: dirname(file), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"), exitCode: 0 });
});
