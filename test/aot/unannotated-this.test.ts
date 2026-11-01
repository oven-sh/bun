// The checker ran out of stack on the type of a `this` parameter without an annotation, and the build stopped with "internal compiler error (Check)".
// test/cli/check/unannotated-this.test.ts has what the type is.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const source = `function get<V>(collection: { [key: string]: V }, key: string): V | undefined { return collection[key]; }
const found = get({ x: "xx", get: function (this, key: string) { return this[key]; } }, "get");
console.log(typeof get({ x: "xx", get: function (this, key: string) { return this[key]; } }, "x"), typeof found);
`;

test("a function expression with a `this` parameter without an annotation, as a member of an argument", async () => {
  using dir = tempDir("aot-this-parameter-without-an-annotation", { "program.ts": source });
  const directory = String(dir);
  const executable = join(directory, `program${isWindows ? ".exe" : ""}`);
  const plain = await run([bunExe(), "program.ts"], directory, bunEnv);
  expect(plain.stdout).toBe("string function\n");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", executable],
    directory,
    bunEnv,
  );
  expect({ exitCode: built.exitCode, stderr: built.stderr.includes("ran out of stack") }).toEqual({
    exitCode: 0,
    stderr: false,
  });
  expect((await run([executable], directory, bunEnv)).stdout).toBe(plain.stdout);
});
