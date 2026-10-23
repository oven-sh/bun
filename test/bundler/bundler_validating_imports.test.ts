// `import { validate } from "bun:bundle"` and `import { JSON } from "bun"` are removed at build time, and `validate<T>(value)` and `JSON.parse<T>(text)` become the checks for `T`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand, run as spawned } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";

// Today only an ahead-of-time build makes the checks. `bun run`, `bun build` and `bun build --compile` have no validators yet: there "bun:bundle" has no export named
// `validate`, and `JSON.parse<T>` parses without a look at `T`. What they are to do stands here as todo.
const whereNothingIsCompiled = test.todoIf(true);

const ways: Record<
  string,
  (folder: string, file: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
> = {
  "bun run": (folder, file) => spawned([bunExe(), "run", file], folder),
  "bun build": async (folder, file) => {
    const built = await spawned([bunExe(), "build", file, "--target=bun", "--outfile", "out.js"], folder);
    return built.exitCode ? built : spawned([bunExe(), "run", "./out.js"], folder);
  },
  "bun build --target=browser": async (folder, file) => {
    const built = await spawned([bunExe(), "build", file, "--target=browser", "--outfile", "out.js"], folder);
    return built.exitCode ? built : spawned([bunExe(), "run", "./out.js"], folder);
  },
  "bun build --compile": async (folder, file) => {
    const built = await spawned([bunExe(), "build", "--compile", file, "--outfile", "out"], folder);
    return built.exitCode ? built : spawned([join(folder, "out")], folder);
  },
};

const types = `export interface User { id: number; name: string }\n`;
const shown = `
function shown(call: () => unknown): string {
  try {
    return globalThis.JSON.stringify(call());
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}
`;

const supported: Record<string, { files: Record<string, string>; stdout: string; needsBun?: boolean }> = {
  "validate": {
    files: {
      "program.ts": `import { validate } from "bun:bundle";\nimport type { User } from "./types";${shown}
console.log(shown(() => validate<User>({ id: 1, name: "a", more: true })));
console.log(shown(() => validate<User>({ id: "1", name: "a" })));`,
    },
    stdout: `{"id":1,"name":"a","more":true}\nTypeError: id: expected number, received string\n`,
  },
  "validate with an alias, imported next to feature": {
    files: {
      "program.ts": `import { feature, validate as check } from "bun:bundle";\nimport type { User } from "./types";${shown}
if (feature("NOTHING")) console.log("never");
console.log(shown(() => check<User>({ id: 1, name: "a" })), shown(() => check<number>("1")));`,
    },
    stdout: `{"id":1,"name":"a"} TypeError: expected number, received string\n`,
  },
  "a call above the import statement": {
    files: {
      "program.ts": `import type { User } from "./types";${shown}
const check = (value: unknown) => validate<User>(value);
import { validate } from "bun:bundle";
console.log(shown(() => check({ id: 1, name: "a" })), shown(() => check(null)));`,
    },
    stdout: `{"id":1,"name":"a"} TypeError: expected object, received null\n`,
  },
  "two files that import validate": {
    files: {
      "program.ts": `import { validate } from "bun:bundle";\nimport { other } from "./other";${shown}
console.log(shown(() => validate<number>(1)), shown(() => other("1")));`,
      "other.ts": `import { validate } from "bun:bundle";\nexport const other = (value: unknown) => validate<number>(value);`,
    },
    stdout: `1 TypeError: expected number, received string\n`,
  },
  "other bindings named validate are left alone": {
    files: {
      "program.ts": `import { validate } from "./own";\nimport { validate as checked } from "bun:bundle";${shown}
function withParameter(checked: <T>(value: unknown) => T) {
  return checked<number>("a parameter");
}
function withLocal() {
  const checked = <T,>(value: unknown) => ("a local given " + value) as T;
  return checked<number>("text");
}
console.log(validate<number>("text"), withParameter(<T,>(value: unknown) => ("given " + value) as T), withLocal(), shown(() => checked<number>("text")));`,
      "own.ts": `export const validate = <T,>(value: unknown) => ("its own given " + value) as T;`,
    },
    stdout: `its own given text given a parameter a local given text TypeError: expected number, received string\n`,
  },
  "JSON from bun": {
    files: {
      "program.ts": `import { JSON } from "bun";\nimport type { User } from "./types";${shown}
console.log(shown(() => JSON.parse<User>('{"id":1,"name":"a","more":true}')));
console.log(shown(() => JSON.parse<User>('{"id":"1","name":"a"}')));
console.log(shown(() => JSON.parse<User>('{"id":')).split(":")[0]);
console.log(JSON === globalThis.JSON, JSON.stringify({ a: 1 }), ["1", "2"].map(text => JSON.parse<any>(text)).join(), typeof JSON.parse);
console.log(await Promise.resolve("[1]").then(JSON.parse), (codec => codec.stringify([2]))(JSON));`,
    },
    stdout: `{"id":1,"name":"a","more":true}\nTypeError: id: expected number, received string\nSyntaxError\ntrue {"a":1} 1,2 function\n[ 1 ] [2]\n`,
  },
  "JSON from bun with an alias, and Bun.JSON": {
    files: {
      "program.ts": `import { JSON as Codec, inspect } from "bun";\nimport type { User } from "./types";${shown}
console.log(shown(() => Codec.parse<User>('{"id":"1","name":"a"}')), Codec === JSON, Codec.stringify([1]), typeof inspect);
console.log(shown(() => Bun.JSON.parse<User>('{"id":"1","name":"a"}')), Bun.JSON === JSON);`,
    },
    stdout: `TypeError: id: expected number, received string true [1] function\nTypeError: id: expected number, received string true\n`,
    needsBun: true,
  },
  "a parameter with the alias of JSON is left alone": {
    files: {
      "program.ts": `import { JSON as Codec } from "bun";${shown}
function withParameter(Codec: { parse<T>(text: string): T }) {
  return Codec.parse<number>("text");
}
console.log(withParameter({ parse: <T,>(text: string) => ("theirs given " + text) as T }), shown(() => Codec.parse<number>('"text"')));`,
    },
    stdout: `theirs given text TypeError: expected number, received string\n`,
  },
};

describe.each(Object.keys(ways))("%s", way => {
  const names = Object.keys(supported).filter(name => !(supported[name].needsBun && way.includes("browser")));
  whereNothingIsCompiled.each(names)(
    "%s",
    async name => {
      using dir = tempDir("validating-imports", { "types.ts": types, ...supported[name].files });
      expect(await ways[way](String(dir), "./program.ts")).toEqual({
        stdout: supported[name].stdout,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});

whereNothingIsCompiled("a bundle contains neither import", async () => {
  using dir = tempDir("validating-imports-erased", {
    "program.ts": `import { validate } from "bun:bundle";\nimport { JSON } from "bun";\nconsole.log(validate<number>(1), JSON.parse<number>("2"), JSON.stringify(3));`,
  });
  for (const target of ["bun", "node", "browser"]) {
    const built = await spawned([bunExe(), "build", "./program.ts", "--target=" + target], String(dir));
    expect({ target, stderr: built.stderr, exitCode: built.exitCode }).toEqual({ target, stderr: "", exitCode: 0 });
    expect(built.stdout).not.toContain("bun:bundle");
    expect(built.stdout).not.toMatch(/from\s*"bun"|require\("bun"\)/);
    expect(built.stdout).toContain("JSON.stringify(3)");
  }
});

const notAValue = `validate() from "bun:bundle" can only be called. It can't be assigned, passed as an argument or exported`;
const oneArgument = `validate() requires exactly one argument`;
const jsonNotExported = `JSON from "bun" can't be exported. Import it in each file that uses it`;
const errors: Record<string, [string, string]> = {
  "a name that bun:bundle does not export": [
    `import { validated } from "bun:bundle";\nconsole.log(validated);`,
    `"bun:bundle" has no export named "validated"`,
  ],
  "export { validate }": [`import { validate } from "bun:bundle";\nexport { validate };`, notAValue],
  "export default validate": [`import { validate } from "bun:bundle";\nexport default validate;`, notAValue],
  "validate assigned to a variable": [
    `import { validate } from "bun:bundle";\nconst check = validate;\nconsole.log(check<number>(1));`,
    notAValue,
  ],
  "validate passed as an argument": [
    `import { validate } from "bun:bundle";\nconsole.log([1].map(validate));`,
    notAValue,
  ],
  "typeof validate": [`import { validate } from "bun:bundle";\nconsole.log(typeof validate);`, notAValue],
  "validate in an object literal": [`import { validate } from "bun:bundle";\nconsole.log({ validate });`, notAValue],
  "validate.name": [`import { validate } from "bun:bundle";\nconsole.log(validate.name);`, notAValue],
  "validate.call": [
    `import { validate } from "bun:bundle";\nconsole.log(validate.call<undefined, [number], number>(undefined, 1));`,
    notAValue,
  ],
  "an assignment to validate": [`import { validate } from "bun:bundle";\n(validate as any) = 1;`, notAValue],
  "new validate": [`import { validate } from "bun:bundle";\nconsole.log(new (validate as any)<number>(1));`, notAValue],
  "validate as a template tag": [
    `import { validate } from "bun:bundle";\nconsole.log((validate as any)<number>\`1\`);`,
    notAValue,
  ],
  "an optional call": [
    `import { validate } from "bun:bundle";\nconsole.log(validate?.<number>(1));`,
    `validate?.() isn't supported. Call it directly: validate<User>(value)`,
  ],
  "no type argument": [
    `import { validate } from "bun:bundle";\nconsole.log(validate(1));`,
    `validate() needs a type argument: validate<User>(value)`,
  ],
  "no argument": [
    `import { validate } from "bun:bundle";\n// @ts-expect-error\nconsole.log(validate<number>());`,
    oneArgument,
  ],
  "two arguments": [
    `import { validate } from "bun:bundle";\n// @ts-expect-error\nconsole.log(validate<number>(1, 2));`,
    oneArgument,
  ],
  "a spread argument": [
    `import { validate } from "bun:bundle";\n// @ts-expect-error\nconsole.log(validate<number>(...[1]));`,
    oneArgument,
  ],
  "a type that cannot be validated": [
    `import { validate } from "bun:bundle";\nconsole.log(validate<{ run: () => void }>({}));`,
    `validate<{ run: () => void; }>() cannot validate 'run: () => void'. Only types that JSON can represent can be validated.`,
  ],
  "export { JSON }": [`import { JSON } from "bun";\nexport { JSON };`, jsonNotExported],
  "export { Codec }, an alias of JSON": [`import { JSON as Codec } from "bun";\nexport { Codec };`, jsonNotExported],
  "an alias of JSON where a parameter named JSON shadows the global": [
    `import { JSON as Codec } from "bun";\nexport function f(JSON: unknown) {\n  return [JSON, Codec.stringify(1)];\n}`,
    `JSON from "bun" is the global JSON, which a local variable named JSON shadows here`,
  ],
  "JSON.parse from bun without a type argument": [
    `import { JSON } from "bun";\nconsole.log(JSON.parse("1"));`,
    `JSON.parse() from "bun" needs a type argument: JSON.parse<User>(text). Use JSON.parse<any>(text) to skip validation`,
  ],
};

describe.each(["bun run", "bun build", ...(unsupported ? [] : ["bun build --compile --aot"])])(
  "%s reports an error for",
  way => {
    const compiles = way.endsWith("--aot");
    // An ahead-of-time build decides by binding and puts no text in the place of the alias, so a parameter named JSON hides nothing from it.
    const names = Object.keys(errors).filter(name => !(compiles && name.includes("shadows the global")));
    const refusedEverywhere = "a name that bun:bundle does not export";
    if (!compiles)
      whereNothingIsCompiled.each(names.filter(name => name !== refusedEverywhere))(
        "%s",
        async name => reportsAnError(way, name),
        120_000,
      );
    test.concurrent.each(compiles ? names : [refusedEverywhere])(
      "%s",
      async name => reportsAnError(way, name),
      120_000,
    );
  },
);

async function reportsAnError(way: string, name: string) {
  const [program, message] = errors[name];
  using dir = tempDir("validating-imports-errors", { "program.ts": program });
  const cmd =
    way === "bun run"
      ? ["run", "./program.ts"]
      : way === "bun build"
        ? ["build", "./program.ts", "--target=bun", "--outfile", "out.js"]
        : ["build", "--compile", "--aot", "./program.ts", "--outfile", "out"];
  const { stderr, exitCode } = await spawned([bunExe(), ...cmd], String(dir));
  expect(stderr).toContain(message);
  expect(exitCode).toBe(1);
}

test.skipIf(!!unsupported)(
  "bun build --compile --aot takes an alias of JSON beside a parameter named JSON",
  async () => {
    using dir = tempDir("validating-imports-alias", {
      "program.ts": `import { JSON as Codec } from "bun";\nfunction f(JSON: unknown) {\n  return [JSON, Codec.stringify(1), Codec.parse<number>("2")].join();\n}\nconsole.log(f("theirs"));`,
    });
    const built = await spawned(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", "out"],
      String(dir),
    );
    expect(built.exitCode).toBe(0);
    expect(await spawned([join(String(dir), "out")], String(dir))).toEqual({
      stdout: "theirs,1,2\n",
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);

whereNothingIsCompiled("validate in a JavaScript file, as tsc or esbuild would emit it, is an error", async () => {
  using dir = tempDir("validating-imports-javascript", {
    "validate.js": `import { validate } from "bun:bundle";\nconsole.log(validate({ id: "1" }));`,
  });
  expect(await spawned([bunExe(), "run", "./validate.js"], String(dir))).toMatchObject({
    stdout: "",
    stderr: expect.stringContaining(
      `validate() from "bun:bundle" needs a type argument, so it only works in TypeScript files`,
    ),
    exitCode: 1,
  });
});

whereNothingIsCompiled(
  "JSON.parse from bun in a JavaScript file, as tsc or esbuild would emit it, is an error",
  async () => {
    using dir = tempDir("validating-imports-javascript", {
      "json.js": `import { JSON } from "bun";\nconsole.log(JSON.parse('{"id":"1"}'));`,
    });
    expect(await spawned([bunExe(), "run", "./json.js"], String(dir))).toMatchObject({
      stdout: "",
      stderr: expect.stringContaining(`JSON.parse() from "bun" needs a type argument`),
      exitCode: 1,
    });
  },
);

whereNothingIsCompiled.each(["validate<number>(1)", "JSON.parse<number>('1')"])(
  "bun build --no-bundle reports an error for %s",
  async call => {
    using dir = tempDir("validating-imports-no-bundle", {
      "program.ts": `import { validate } from "bun:bundle";\nimport { JSON } from "bun";\nconsole.log(${call});`,
    });
    expect(await spawned([bunExe(), "build", "--no-bundle", "./program.ts"], String(dir))).toMatchObject({
      stderr: expect.stringContaining(
        `${call.split("<")[0]}<T>() isn't supported by "bun build --no-bundle" or Bun.Transpiler`,
      ),
      exitCode: 1,
    });
  },
);

whereNothingIsCompiled.each(["bun run", "bun build"])(
  "%s reports an error at the call when the type checker cannot start",
  async way => {
    using dir = tempDir("validating-imports-no-type-checker", {
      "validate.ts": `import { validate } from "bun:bundle";\nconsole.log(validate<number>("1"));`,
      "imported.ts": `import { JSON } from "bun";\nconsole.log(JSON.parse<number>('"1"'));`,
      "global.ts": `console.log(JSON.parse<number>('"1"'));`,
      "unrelated.ts": `const own = { parse: <T,>(text: string) => text as T };\nconsole.log(own.parse<number>("1"));`,
    });
    const run = async (file: string) => {
      const cmd = way === "bun run" ? ["run", file] : ["build", file, "--target=bun", "--outfile", "out.js"];
      const { stderr, exitCode } = await runCommand([bunExe(), ...cmd], String(dir), {
        ...bunEnv,
        BUN_INTERNAL_FAIL_TYPE_CHECKER_START: "1",
      });
      return { stderr, exitCode };
    };
    for (const file of ["./validate.ts", "./imported.ts", "./global.ts"]) {
      expect({ file, ...(await run(file)) }).toEqual({
        file,
        stderr: expect.stringContaining("could not type-check this file, so this call can't be validated"),
        exitCode: 1,
      });
    }
    expect((await run("./unrelated.ts")).exitCode).toBe(0);
  },
);
