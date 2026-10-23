import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

// The prototype object of a class of the program is fixed under --aot. `bun run --aot` prints what is recorded of the executable,
// and what `bun run` prints where nothing is recorded.
const programs = join(import.meta.dir, "programs");

test.concurrent.each([
  "type-rules/class-prototype-object-immutable",
  "type-rules/methods-and-super",
  "type-rules/object-assign",
  "type-rules/for-in",
  "type-rules/accessors-in-typed-code",
  "type-rules/optional-field-on-changed-prototype-chain",
  "type-rules/optional-fields-on-prototype",
  "calls/inspecting-class-prototypes",
  "classes-and-closures/instanceof-program-classes-in-loops",
  "async-and-generators/iteration-replaced",
  "type-rules/delete-required-field",
  "type-rules/delete-fields",
  "type-rules/delete-required-fields-throws",
  "type-rules/key-order-indices-and-symbols",
  "type-rules/objects-mutated-during-loop",
  "type-rules/stores-through-another-type",
  "type-rules/any-into-annotated-parameter",
  "typed-objects/two-classes-same-name",
])(
  "%s",
  async name => {
    const file = existsSync(join(programs, name + ".ts"))
      ? join(programs, name + ".ts")
      : join(programs, name, "main.ts");
    let expected: string;
    if (existsSync(join(programs, name + ".expected.txt")))
      expected = readFileSync(join(programs, name + ".expected.txt"), "utf8");
    else {
      await using plain = Bun.spawn({
        cmd: [bunExe(), "run", file],
        cwd: dirname(file),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      [expected] = await Promise.all([plain.stdout.text(), plain.exited]);
    }
    // From the sources, and as compiled code.
    for (const flag of ["--aot", "--debug-aot"]) {
      const { stdout, exitCode } = await run([bunExe(), "run", flag, file], dirname(file));
      expect({ flag, stdout, exitCode }).toEqual({ flag, stdout: expected, exitCode: 0 });
    }
  },
  120_000,
);
