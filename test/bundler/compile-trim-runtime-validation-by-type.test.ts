import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/run-programs";
import { canTrim } from "./compile-trim-features";

const program = `
  import { JSON } from "bun"; import { validate } from "bun:bundle";
  import { join } from "node:path";
  type Point = { x: number };
  const parsePoint = (text: string) => JSON.parse<Point>(text);
  console.log("compiled in:", parsePoint('{"x":1}').x, validate<Point>({ x: 2 }).x);
  try {
    parsePoint('{"x":"one"}');
  } catch (error) {
    console.log("compiled in:", (error as Error).name);
  }
  for (const name of process.argv.slice(2)) {
    try {
      const path = join(process.cwd(), name);
      const loaded = name.endsWith(".cts") ? require(path) : await import(path);
      console.log(name + ":", ...loaded.said);
    } catch (error) {
      console.log(name + ":", "caught", (error as Error).message);
    }
  }
`;

const fitAndMisfit = `
  function nameOfWhatIsThrown(call: () => unknown) {
    try {
      call();
      return "nothing";
    } catch (error) {
      return (error as Error).name;
    }
  }
  const said = [check({ a: 1 }).a, nameOfWhatIsThrown(() => check({ a: "one" }))];
`;

const validating = {
  "validate.ts": `import { validate } from "bun:bundle";\nconst check = (value: unknown) => validate<{ a: number }>(value);${fitAndMisfit}export { said };`,
  "imported-function.ts": `import { validate as checked } from "bun:bundle";\nconst check = (value: unknown) => checked<{ a: number }>(value);${fitAndMisfit}export { said };`,
  "imported-json.ts": `import { JSON } from "bun";\nconst check = (value: unknown) => JSON.parse<{ a: number }>(JSON.stringify(value));${fitAndMisfit}export { said };`,
  "imported-json-under-another-name.ts": `import { JSON as Codec } from "bun";\nconst check = (value: unknown) => Codec.parse<{ a: number }>(Codec.stringify(value));${fitAndMisfit}export { said };`,
  "json-of-the-bun-object.ts": `const check = (value: unknown) => Bun.JSON.parse<{ a: number }>(JSON.stringify(value));${fitAndMisfit}export { said };`,
  "json-of-the-imported-module.ts": `import * as runtime from "bun";\nconst check = (value: unknown) => runtime.JSON.parse<{ a: number }>(JSON.stringify(value));${fitAndMisfit}export { said };`,
  "required.cts": `const check = (value: unknown) => Bun.JSON.parse<{ a: number }>(JSON.stringify(value));${fitAndMisfit}module.exports = { said };`,
};

const boundToSomethingElse = {
  "other-bindings.ts": `
    import { inspect } from "bun";
    import validate from "./validate-of-its-own.ts";
    const JSON = { parse: <T,>(text: string) => ("its own parse of " + text) as T };
    function withItsOwnBun() {
      const Bun = { JSON: { parse: <T,>(value: unknown) => ("its own validate of " + value) as T } };
      return Bun.JSON.parse<string>(1);
    }
    export const said = [JSON.parse<string>("text"), withItsOwnBun(), validate<string>(2), inspect<number>(3)];
  `,
  "validate-of-its-own.ts": `export default <T,>(value: unknown) => ("a default export given " + value) as T;`,
};

const refusal =
  "--trim removed the type checker from this executable, so validate<T>() and JSON.parse<T>() don't work in code loaded at run time";
const compiledIn = "compiled in: 1 2\ncompiled in: TypeError\n";
const otherBindings = "other-bindings.ts: its own parse of text its own validate of 1 a default export given 2 3\n";
const names = [...Object.keys(validating), "other-bindings.ts"];

describe.skipIf(!canTrim || !!unsupported)("JSON.parse<T> and validate<T> in files laid down after the build", () => {
  async function runs(flags: string[]) {
    using dir = tempDir("compile-trim-runtime-validation", { "program.ts": program, "cwd/empty": "" });
    const folder = String(dir);
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", "--compile-inspector", ...flags, "program.ts", "--outfile", "program"],
      folder,
      bunEnv,
    );
    expect(build.stderr).not.toMatch(/^error\b/m);
    expect(build.exitCode).toBe(0);
    for (const [name, text] of Object.entries({ ...validating, ...boundToSomethingElse }))
      writeFileSync(join(folder, "cwd", name), text);
    return await spawned([join(folder, "program"), ...names], join(folder, "cwd"), bunEnv);
  }

  // TODO: validate<T>() and JSON.parse<T>() validate in code that is compiled. In a file that is only transpiled, as these are, nothing makes the validators yet.
  const whereNothingIsCompiled = test.todoIf(true);

  whereNothingIsCompiled(
    "a whole executable validates them",
    async () => {
      expect(await runs([])).toMatchObject({
        stdout:
          compiledIn +
          Object.keys(validating)
            .map(name => `${name}: 1 TypeError\n`)
            .join("") +
          otherBindings,
        stderr: "",
        exitCode: 0,
      });
    },
    600_000,
  );

  whereNothingIsCompiled(
    "a trimmed executable has no type checker: loading them throws, and what was compiled in validates",
    async () => {
      expect(await runs(["--trim"])).toMatchObject({
        stdout:
          compiledIn +
          Object.keys(validating)
            .map(name => `${name}: caught ${refusal}\n`)
            .join("") +
          otherBindings,
        stderr: "",
        exitCode: 0,
      });
    },
    600_000,
  );
});
