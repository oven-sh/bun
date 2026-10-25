// `import { validate } from "bun:bundle"` and `import { JSON } from "bun"` are removed at build time, and `validate<T>(value)` and `JSON.parse<T>(text)` become the checks for `T`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand, run as spawned } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";

// An ahead-of-time build compiles the checks. `bun run`, `bun build --target=bun` and `bun build --compile` ask the type checker for `T` and write what it
// found into the call. A bundle for a browser has no Bun to validate with, so the calls are errors there. Through the global `JSON` the text is parsed without a look at `T`.
const notYet = test.todoIf(true);
const needsBun = `only work in a TypeScript file that Bun runs, tests or builds with --target=bun`;

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
    stdout: `{"id":1,"name":"a","more":true}\nTypeError: Expected id to be a number, received string\n`,
  },
  "validate with an alias, imported next to feature": {
    files: {
      "program.ts": `import { feature, validate as check } from "bun:bundle";\nimport type { User } from "./types";${shown}
if (feature("NOTHING")) console.log("never");
console.log(shown(() => check<User>({ id: 1, name: "a" })), shown(() => check<number>("1")));`,
    },
    stdout: `{"id":1,"name":"a"} TypeError: Expected value to be a number, received string\n`,
  },
  "a call above the import statement": {
    files: {
      "program.ts": `import type { User } from "./types";${shown}
const check = (value: unknown) => validate<User>(value);
import { validate } from "bun:bundle";
console.log(shown(() => check({ id: 1, name: "a" })), shown(() => check(null)));`,
    },
    stdout: `{"id":1,"name":"a"} TypeError: Expected value to be an object, received null\n`,
  },
  "two files that import validate": {
    files: {
      "program.ts": `import { validate } from "bun:bundle";\nimport { other } from "./other";${shown}
console.log(shown(() => validate<number>(1)), shown(() => other("1")));`,
      "other.ts": `import { validate } from "bun:bundle";\nexport const other = (value: unknown) => validate<number>(value);`,
    },
    stdout: `1 TypeError: Expected value to be a number, received string\n`,
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
    stdout: `its own given text given a parameter a local given text TypeError: Expected value to be a number, received string\n`,
  },
  "JSON from bun": {
    files: {
      "program.ts": `import { JSON } from "bun";\nimport type { User } from "./types";${shown}
console.log(shown(() => JSON.parse<User>('{"id":1,"name":"a","more":true}')));
console.log(shown(() => JSON.parse<User>('{"id":"1","name":"a"}')));
console.log(shown(() => JSON.parse<User>('{"id":')).split(":")[0]);
console.log(JSON === globalThis.JSON, JSON.stringify({ a: 1 }), ["1", "2"].map(text => JSON.parse<any>(text)).join(), typeof JSON.parse);
console.log(shown(() => ["[1]"].map(JSON.parse)).slice(0, 37), (codec => codec.stringify([2]))(JSON));`,
    },
    stdout: `{"id":1,"name":"a","more":true}\nTypeError: Expected id to be a number, received string\nSyntaxError\nfalse {"a":1} 1,2 function\nTypeError: JSON.parse() from "bun" ha [2]\n`,
  },
  "JSON from bun with an alias, and Bun.JSON": {
    files: {
      "program.ts": `import { JSON as Codec, inspect } from "bun";\nimport type { User } from "./types";${shown}
console.log(shown(() => Codec.parse<User>('{"id":"1","name":"a"}')), Codec === Bun.JSON, Codec.stringify([1]), typeof inspect);
console.log(shown(() => Bun.JSON.parse<User>('{"id":"1","name":"a"}')), Bun.JSON === JSON);`,
    },
    stdout: `TypeError: Expected id to be a number, received string true [1] function\nTypeError: Expected id to be a number, received string false\n`,
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
    stdout: `theirs given text TypeError: Expected value to be a number, received string\n`,
  },
};

describe.each(Object.keys(ways).filter(way => !way.includes("browser")))("%s", way => {
  test.concurrent.each(Object.keys(supported))(
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

test("a bundle contains neither import", async () => {
  using dir = tempDir("validating-imports-erased", {
    "program.ts": `import { validate } from "bun:bundle";\nimport { JSON } from "bun";\nconsole.log(validate<number>(1), JSON.parse<number>("2"), JSON.stringify(3));`,
  });
  for (const target of ["bun"]) {
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
  "JSON.parse from bun without a type argument": [
    `import { JSON } from "bun";\nconsole.log(JSON.parse("1"));`,
    `JSON.parse() from "bun" needs a type argument: JSON.parse<User>(text). Use JSON.parse<any>(text) to skip validation`,
  ],
};

describe.each(["bun run", "bun build", ...(unsupported ? [] : ["bun build --compile --aot"])])(
  "%s reports an error for",
  way => {
    const compiles = way.endsWith("--aot");
    // Only a build that sees the whole program follows what a file exports.
    const isSeenByWholeProgramAlone = (name: string) =>
      name.startsWith("export { JSON }") || name.startsWith("export { Codec }");
    const names = Object.keys(errors);
    if (!compiles)
      notYet.each(names.filter(isSeenByWholeProgramAlone))("%s", async name => reportsAnError(way, name), 120_000);
    test.concurrent.each(names.filter(name => compiles || !isSeenByWholeProgramAlone(name)))(
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

test("validate in a JavaScript file, as tsc or esbuild would emit it, is an error", async () => {
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

test("JSON.parse from bun in a JavaScript file, as tsc or esbuild would emit it, is an error", async () => {
  using dir = tempDir("validating-imports-javascript", {
    "json.js": `import { JSON } from "bun";\nconsole.log(JSON.parse('{"id":"1"}'));`,
  });
  expect(await spawned([bunExe(), "run", "./json.js"], String(dir))).toMatchObject({
    stdout: "",
    stderr: expect.stringContaining(`JSON.parse() from "bun" needs a type argument`),
    exitCode: 1,
  });
});

test.each(["validate<number>(1)", "JSON.parse<number>('1')"])(
  "bun build --no-bundle for a browser reports an error for %s",
  async call => {
    using dir = tempDir("validating-imports-no-bundle", {
      "program.ts": `import { validate } from "bun:bundle";\nimport { JSON } from "bun";\nconsole.log(${call});`,
    });
    expect(await spawned([bunExe(), "build", "--no-bundle", "./program.ts"], String(dir))).toMatchObject({
      stderr: expect.stringContaining(needsBun),
      exitCode: 1,
    });
  },
);

notYet.each(["bun run", "bun build"])(
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
    for (const file of ["./validate.ts", "./imported.ts"]) {
      expect({ file, ...(await run(file)) }).toEqual({
        file,
        stderr: expect.stringContaining("could not type-check this file, so this call can't be validated"),
        exitCode: 1,
      });
    }
    for (const file of ["./global.ts", "./unrelated.ts"]) expect((await run(file)).exitCode).toBe(0);
  },
);

// However the file names the `JSON` of "bun", the text is held against `T`. The global `JSON` is left as it was: a program may have declared
// `interface JSON { parse<T>(text: string): T }` itself.
const isNoUser = `TypeError: Expected id to be a number, received string`;
const text = `'{"id":"1"}'`;
const namesOfTheJSONOfBun: Record<string, string> = {
  "JSON imported from bun": `import { JSON } from "bun";\nconsole.log(JSON.parse<User>(${text}));`,
  "JSON imported under another name": `import { JSON as Codec } from "bun";\nconsole.log(Codec.parse<User>(${text}));`,
  "JSON imported twice": `import { JSON as First } from "bun";\nimport { JSON as Second } from "bun";\nconsole.log(First.stringify(1), Second.parse<User>(${text}));`,
  "a call above the import": `console.log(load());\nfunction load() {\n  return JSON.parse<User>(${text});\n}\nimport { JSON } from "bun";`,
  "Bun.JSON": `console.log(Bun.JSON.parse<User>(${text}));`,
  "JSON of the whole module": `import * as runtime from "bun";\nconsole.log(runtime.JSON.parse<User>(${text}));`,
  "JSON of the default export": `import runtime from "bun";\nconsole.log(runtime.JSON.parse<User>(${text}));`,
  "JSON of the default export by its name": `import { default as runtime } from "bun";\nconsole.log(runtime.JSON.parse<User>(${text}));`,
  "the name in brackets": `import { JSON } from "bun";\nconsole.log(JSON["parse"]<User>(${text}));`,
  "an optional call": `import { JSON } from "bun";\nconsole.log(JSON.parse?.<User>(${text}));`,
};
const refused: Record<string, [program: string, message: string]> = {
  "a type argument that starts with <": [
    `import { JSON } from "bun";\nconsole.log(JSON.parse<<T>(value: T) => T>(${text}));`,
    `Only types that JSON can represent can be validated.`,
  ],
  "no call": [
    `import { JSON } from "bun";\nconst parseUser = JSON.parse<User>;\nconsole.log(parseUser(${text}));`,
    `JSON.parse<T> from "bun" can only be called`,
  ],
  "a name for any": [
    `import { JSON } from "bun";\ntype Anything = any;\nconsole.log(JSON.parse<Anything>(${text}));`,
    `'Anything' is any here, so there is no type to validate against`,
  ],
};
const user = `interface User { id: number }\n`;
const leftAsItWas: Record<string, [program: string, stdout: string]> = {
  "the global JSON": [`console.log(JSON.parse<User>(${text}).id);`, "1\n"],
  "the global JSON with a type parameter that the program declares": [
    `declare global {\n  interface JSON {\n    parse<T>(text: string): T;\n  }\n}\nconsole.log(JSON.parse<User>(${text}).id);\nexport {};`,
    "1\n",
  ],
  "the global JSON by other roads": [
    `const { parse } = JSON;\nconsole.log(JSON["parse"]<User>(${text}).id, globalThis.JSON.parse<User>(${text}).id, parse<User>(${text}).id);`,
    "1 1 1\n",
  ],
  "any and unknown": [
    `import { JSON } from "bun";\nconsole.log(JSON.parse<any>(${text}).id, JSON.parse< unknown >("2"), Bun.JSON.parse<any>("3"));`,
    "1 2 3\n",
  ],
  "other members": [
    `import { JSON } from "bun";\nconsole.log(JSON.stringify([2]), JSON === globalThis.JSON, JSON.stringify === globalThis.JSON.stringify);`,
    "[2] false true\n",
  ],
  "other things named JSON, Bun and parse": [
    `import { JSON as Codec, inspect } from "bun";
const own = { parse: <T,>(text: string) => ("its own parse of " + text) as T };
function withParameter(Codec: typeof own) {
  return Codec.parse<string>("a");
}
function withItsOwnBun() {
  const Bun = { JSON: own };
  return Bun.JSON.parse<string>("b");
}
function withItsOwnJSON() {
  const JSON = own;
  return JSON.parse<string>("c");
}
console.log(withParameter(own), withItsOwnBun(), withItsOwnJSON(), own.parse<string>("d"), inspect<number>(1), Codec.stringify(2));`,
    "its own parse of a its own parse of b its own parse of c its own parse of d 1 2\n",
  ],
  "a call that never runs": [
    `import { JSON } from "bun";\nif (false) JSON.parse<User>(${text});\nconsole.log(JSON.stringify(1));`,
    "1\n",
  ],
};

describe.each(Object.keys(ways))("%s:", way => {
  const reachesBun = (program: string) => !way.includes("browser") || !program.includes(`from "bun"`);
  test.concurrent.each(Object.keys(namesOfTheJSONOfBun).filter(name => reachesBun(namesOfTheJSONOfBun[name])))(
    "JSON.parse<T> validates: %s",
    async name => {
      using dir = tempDir("validating-imports-names", { "program.ts": user + namesOfTheJSONOfBun[name] });
      const { stdout, stderr, exitCode } = await ways[way](String(dir), "./program.ts");
      expect(stderr).toContain(way.includes("browser") ? needsBun : isNoUser);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    },
    120_000,
  );
  test.concurrent.each(Object.keys(refused).filter(name => reachesBun(refused[name][0])))(
    "JSON.parse<T> is an error: %s",
    async name => {
      using dir = tempDir("validating-imports-refused", { "program.ts": user + refused[name][0] });
      const { stdout, stderr, exitCode } = await ways[way](String(dir), "./program.ts");
      expect(stderr).toContain(refused[name][1]);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    },
    120_000,
  );
  test.concurrent.each(Object.keys(leftAsItWas).filter(name => reachesBun(leftAsItWas[name][0])))(
    "JSON.parse<T> is JSON.parse: %s",
    async name => {
      using dir = tempDir("validating-imports-erased", { "program.ts": user + leftAsItWas[name][0] });
      expect(await ways[way](String(dir), "./program.ts")).toEqual({
        stdout: leftAsItWas[name][1],
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});

test("Bun.Transpiler has no file to read types beside, and bun build --no-bundle goes by its target", async () => {
  const program = user + namesOfTheJSONOfBun["JSON imported from bun"];
  expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(program)).toThrow(needsBun);
  expect(new Bun.Transpiler({ loader: "ts" }).transformSync(user + leftAsItWas["the global JSON"][0])).toContain(
    "JSON.parse(",
  );
  using dir = tempDir("validating-imports-no-bundle", { "program.ts": program });
  const { stderr, exitCode } = await spawned([bunExe(), "build", "--no-bundle", "./program.ts"], String(dir));
  expect(stderr).toContain(needsBun);
  expect(exitCode).toBe(1);
  const forBun = await spawned([bunExe(), "build", "--no-bundle", "--target=bun", "./program.ts"], String(dir));
  expect({ stderr: forBun.stderr, exitCode: forBun.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  await Bun.write(join(String(dir), "out.js"), forBun.stdout);
  expect((await spawned([bunExe(), "run", "./out.js"], String(dir))).stderr).toContain(isNoUser);
});

test("a package that ships TypeScript is held to the same", async () => {
  using dir = tempDir("validating-imports-package", {
    "program.ts": `import { load } from "ships-typescript";\nconsole.log(load(${text}));`,
    "node_modules/ships-typescript/package.json": `{ "name": "ships-typescript", "version": "1.0.0", "exports": "./index.ts" }`,
    "node_modules/ships-typescript/index.ts": `import { JSON } from "bun";\nexport const load = (text: string) => JSON.parse<{ id: number }>(text);`,
  });
  const { stdout, stderr, exitCode } = await spawned([bunExe(), "run", "./program.ts"], String(dir));
  expect(stderr).toContain(isNoUser);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test.skipIf(!!unsupported)(
  "a file that an ahead-of-time executable loads at run time is held to the same",
  async () => {
    using dir = tempDir("validating-imports-loaded-later", {
      "program.ts": `import { JSON } from "bun";
console.log("compiled in:", JSON.parse<number>("1"));
for (const name of process.argv.slice(2)) {
  try {
    console.log(name, (await import(process.cwd() + "/" + name)).said);
  } catch (error) {
    console.log(name, "caught", (error as Error).message);
  }
}`,
      "later/imported.ts": `import { JSON } from "bun";\nexport const said = JSON.parse<number>('"2"');`,
      "later/of-the-bun-object.ts": `export const said = Bun.JSON.parse<number>('"3"');`,
      "later/global.ts": `export const said = JSON.parse<number>('"4"');`,
    });
    const built = await spawned(
      [bunExe(), "build", "--compile", "--aot", "--compile-inspector", "./program.ts", "--outfile", "out"],
      String(dir),
    );
    expect(built.exitCode).toBe(0);
    expect(
      await spawned(
        [join(String(dir), "out"), "imported.ts", "of-the-bun-object.ts", "global.ts"],
        join(String(dir), "later"),
      ),
    ).toEqual({
      stdout: `compiled in: 1\nimported.ts caught Expected value to be a number, received string\nof-the-bun-object.ts caught Expected value to be a number, received string\nglobal.ts 4\n`,
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);
