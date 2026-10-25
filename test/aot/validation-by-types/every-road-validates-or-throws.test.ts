// `JSON.parse<T>(text)` with the `JSON` of "bun", and `validate<T>(value)`, either validate or don't run: however the call reaches a running program, what is no `T` never comes back as one.
// The global `JSON.parse` is TypeScript's: a type argument on it is one that the program declared, and it is erased in every way of running.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { unsupported } from "../run-programs";

const prelude = `
const text = '{"id":"7"}';
type User = { id: number };
function show(call: () => any) {
  try {
    const value = call();
    console.log(typeof value?.id === "string" ? "unchecked" : "another value");
  } catch (error: any) {
    console.log(Array.isArray(error.issues) ? "validated" : String(error.message).startsWith('JSON.parse() from "bun" has no type') ? "threw" : String(error));
  }
}
`;

// "unchecked" only where the call itself says `any` or `unknown`, or where it isn't a call of Bun's.
type Outcome = "validated" | "threw" | "refused" | "unchecked";
// What each road does: [without --aot, with --aot].
const roads: Record<string, { files: Record<string, string>; outcomes: [Outcome[], Outcome[]] }> = {};
function road(name: string, plain: Outcome | Outcome[], compiled: Outcome | Outcome[], program: string, others = {}) {
  const [imports, ...calls] = program.split("\n---\n");
  roads[name] = {
    files: { "program.ts": imports + prelude + calls.join("\n"), ...others },
    outcomes: [[plain].flat(), [compiled].flat()],
  };
}

const imported = `import { JSON } from "bun";`;
road("the import", "validated", "validated", `${imported}\n---\nshow(() => JSON.parse<User>(text));`);
road("Bun.JSON", "validated", "validated", `\n---\nshow(() => Bun.JSON.parse<User>(text));`);
road("globalThis.Bun.JSON", "validated", "validated", `\n---\nshow(() => globalThis.Bun.JSON.parse<User>(text));`);
road("a string key", "validated", "validated", `${imported}\n---\nshow(() => JSON["parse"]<User>(text));`);
road("no type argument", "refused", "refused", `${imported}\n---\nshow(() => JSON.parse(text) as User);`);
road("Bun.JSON without a type argument", "threw", "refused", `\n---\nshow(() => Bun.JSON.parse(text) as User);`);
road(
  "require",
  ["threw", "threw"],
  "refused",
  `\n---\nconst { JSON: Codec } = require("bun");\nshow(() => Codec.parse<User>(text));\nshow(() => require("bun").JSON.parse<User>(text));`,
);
road(
  "parse taken out",
  "threw",
  "validated",
  `${imported}\n---\nconst { parse } = JSON;\nshow(() => parse<User>(text));`,
);
road(
  "another name for the object",
  ["threw", "threw"],
  ["validated", "validated"],
  `${imported}\n---\nconst codec = JSON, other = Bun.JSON;\nshow(() => codec.parse<User>(text));\nshow(() => other.parse<User>(text));`,
);
road(
  "an untyped name for the object",
  "threw",
  "threw",
  `${imported}\n---\nconst codec: any = [JSON][0];\nshow(() => codec.parse(text));`,
);
road("call", "threw", "threw", `${imported}\n---\nshow(() => JSON.parse.call(JSON, text) as User);`);
road("apply", "threw", "threw", `${imported}\n---\nshow(() => Reflect.apply(JSON.parse, JSON, [text]) as User);`);
road("bind", "threw", "threw", `${imported}\n---\nshow(() => JSON.parse.bind(JSON)(text) as User);`);
road(
  "a callback",
  "threw",
  "threw",
  `${imported}\n---\nshow(() => [text].map(JSON.parse as (text: string) => User)[0]);`,
);
road(
  "import()",
  "threw",
  "threw",
  `\n---\nconst { JSON: Codec } = await import("bun");\nshow(() => Codec.parse<User>(text));`,
);
road(
  "a parameter, a field and a property",
  ["threw", "threw", "threw"],
  ["threw", "threw", "threw"],
  `${imported}\n---
function read(JSON: typeof Bun.JSON) { return JSON.parse<User>(text); }
class Box { codec = JSON; read() { return this.codec.parse<User>(text); } }
const table = { JSON };
show(() => read(JSON));
show(() => new Box().read());
show(() => table.JSON.parse<User>(text));`,
);
road(
  "text that is evaluated",
  ["threw", "threw", "threw", "threw"],
  ["threw", "threw", "threw", "threw"],
  `\n---
const source = "Bun.JSON.parse('" + text + "')" + (process.env.NOTHING_IS_SET_UNDER_THIS_NAME ?? "");
show(() => (0, eval)(source));
show(() => new Function("return " + source)());
show(() => require("node:vm").runInThisContext(source));
show(() => require("node:vm").runInNewContext(source, { Bun }));`,
);
road("text that the build can read", "threw", "refused", `\n---\nshow(() => (0, eval)("Bun.JSON.parse('{}')"));`);
road("a JavaScript file", "threw", "refused", `import { read } from "./read.js";\n---\nshow(() => read(text));`, {
  "read.js": `const { JSON: Codec } = globalThis.Bun;\nexport const read = text => Codec.parse(text);`,
});

road(
  "other names for the import",
  ["validated", "validated", "validated"],
  ["validated", "validated", "validated"],
  `import { JSON as Codec } from "bun";\nimport * as all from "bun";\nimport whole from "bun";\n---
show(() => Codec.parse<User>(text));
show(() => all.JSON.parse<User>(text));
show(() => whole.JSON.parse<User>(text));`,
);
road(
  "a type of another file",
  ["validated", "validated"],
  ["validated", "validated"],
  `${imported}\nimport type { Person } from "./person";\n---
show(() => JSON.parse<Person>(text));
show(() => JSON.parse<Person[]>("[" + text + "]"));`,
  { "person.ts": `export interface Person { id: number }` },
);
road(
  "blanks and comments around the type",
  ["validated", "validated"],
  ["validated", "validated"],
  `${imported}\n---
show(() => JSON.parse< /* the row */ User >(text));
show(() => JSON.parse<
  // the row
  User
>(text));`,
);
road(
  "a reviver",
  "validated",
  "validated",
  `${imported}\n---\nshow(() => JSON.parse<User>(text, (key, value) => value));`,
);
road("an optional chain", "validated", "validated", `${imported}\n---\nshow(() => JSON?.parse<User>(text));`);
road("an optional call", "refused", "refused", `${imported}\n---\nshow(() => JSON.parse<User>?.(text));`);
road(
  "arguments that are spread",
  "validated",
  "validated",
  `${imported}\n---\nshow(() => JSON.parse<User>(...[text]));`,
);
road(
  "where a call can stand",
  ["validated", "validated", "validated", "validated"],
  ["validated", "validated", "validated", "validated"],
  `${imported}\n---
function withDefault(user = JSON.parse<User>(text)) { return user; }
class Holder { static read = () => JSON.parse<User>(text); field = JSON.parse<User>(text); }
namespace Inner { export const read = () => JSON.parse<User>(text); }
show(() => withDefault());
show(() => Holder.read());
show(() => new Holder().field);
show(() => Inner.read());`,
);
road(
  "a signature of the program's own over the function",
  ["threw", "threw", "validated"],
  ["validated", "validated", "validated"],
  `${imported}\n---
interface Codec { parse<T>(text: string): T }
const codec: Codec = JSON;
const read: <T>(text: string) => T = JSON.parse;
show(() => codec.parse<User>(text));
show(() => read<User>(text));
show(() => (JSON.parse as <T>(text: string) => T)<User>(text));`,
);
road(
  "no signature over the function",
  "refused",
  "refused",
  `${imported}\n---\nshow(() => (JSON.parse as any)<User>(text));`,
);
road(
  "the function with its type as a value",
  "refused",
  "refused",
  `${imported}\n---\nconst read = JSON.parse<User>;\nshow(() => read(text));`,
);
road("new", "refused", "refused", `${imported}\n---\nshow(() => new (JSON.parse<User> as any)(text));`);
road(
  "a type parameter",
  "refused",
  "refused",
  `${imported}\n---\nfunction read<T>(text: string) { return JSON.parse<T>(text); }\nshow(() => read<User>(text));`,
);
road(
  "a type that JSON can't hold",
  "refused",
  "refused",
  `${imported}\n---\nshow(() => JSON.parse<{ id: number; at: Date }>(text));`,
);

const declared = `declare global {\n  interface JSON {\n    parse<T>(text: string): T;\n  }\n}\nexport {};`;
road(
  "the global, with a type argument that the program declared",
  ["unchecked", "unchecked", "unchecked"],
  ["unchecked", "unchecked", "unchecked"],
  `${declared}\n---\nshow(() => JSON.parse<User>(text));\nshow(() => globalThis.JSON.parse<User>(text));\nshow(() => JSON.parse<Map<string, Date>>(text));`,
);
road(
  "the global behind a function with a type parameter",
  "unchecked",
  "unchecked",
  `${declared}\n---\nfunction load<T>(from: string): T {\n  return JSON.parse<T>(from);\n}\nshow(() => load<User>(text));`,
);
road(
  "the global with its type argument, kept",
  "unchecked",
  "unchecked",
  `${declared}\n---\nconst parse = JSON.parse<User>;\nshow(() => parse(text));`,
);
road(
  "the global under a signature of the program's own",
  "unchecked",
  "unchecked",
  `\n---\nconst parse: <T>(text: string) => T = JSON.parse;\nshow(() => parse<User>(text));`,
);
// Nothing but a type checker says that the global takes no type argument.
road(
  "the global, with a type argument that nobody declared",
  "unchecked",
  "refused",
  `\n---\nshow(() => JSON.parse<User>(text));`,
);

const validates = `import { validate } from "bun:bundle";`;
const value = `globalThis.JSON.parse(text)`;
road("validate", "validated", "validated", `${validates}\n---\nshow(() => validate<User>(${value}));`);
road(
  "validate under another name",
  "validated",
  "validated",
  `import { validate as check } from "bun:bundle";\n---\nshow(() => check<User>(${value}));`,
);
road(
  "validate that asks for no check",
  ["unchecked", "unchecked"],
  ["unchecked", "unchecked"],
  `${validates}\n---\nshow(() => validate<any>(${value}));\nshow(() => validate< /* whatever it is */ unknown >(${value}) as User);`,
);
road(
  "validate without a type argument",
  "refused",
  "refused",
  `${validates}\n---\nshow(() => validate(${value}) as User);`,
);
road("validate as a value", "refused", "refused", `${validates}\n---\nshow(() => [${value}].map(validate<User>)[0]);`);
road(
  "validate under a name of its own",
  "refused",
  "refused",
  `${validates}\n---\nconst check = validate;\nshow(() => check<User>(${value}));`,
);
road(
  "validate with two arguments",
  "refused",
  "refused",
  `${validates}\n---\nshow(() => (validate as any)<User>(${value}, 1));`,
);

const notDeclared = `${imported}\n---\nshow(() => JSON.parse<Usr>(text));`;
road("a type that isn't declared", "refused", "refused", notDeclared);
road(
  "a type that isn't declared, the error silenced",
  "refused",
  "refused",
  notDeclared.replace("show(", "// @ts-ignore\nshow("),
);
road("a type that isn't declared, the file not checked", "refused", "refused", "// @ts-nocheck\n" + notDeclared);
road(
  "a type of a package that isn't installed",
  "refused",
  "refused",
  `${imported}\nimport type { Person } from "a-package-that-is-not-installed";\n---\nshow(() => JSON.parse<Person>(text));`,
);
road(
  "a name for any",
  "refused",
  "refused",
  `${imported}\ntype Anything = any;\n---\nshow(() => JSON.parse<Anything>(text));`,
);

const ways: Record<string, (folder: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>> = {
  "bun run": folder => run([bunExe(), "run", "./program.ts"], folder),
  "bun build": async folder => {
    const built = await run([bunExe(), "build", "./program.ts", "--target=bun", "--outfile", "out.js"], folder);
    return built.exitCode ? built : run([bunExe(), "run", "./out.js"], folder);
  },
  "bun build --compile": async folder => {
    const built = await run([bunExe(), "build", "--compile", "./program.ts", "--outfile", "program"], folder);
    return built.exitCode ? built : run([join(folder, "program")], folder);
  },
  "bun test": async folder => {
    await Bun.write(join(folder, "program.test.ts"), `import "./program.ts";\ntest("the program ran", () => {});`);
    const { stdout, ...rest } = await run([bunExe(), "test", "./program.test.ts"], folder);
    return { stdout: stdout.replace(/^bun test v.*\n/, ""), ...rest };
  },
  "bun run --aot": folder => run([bunExe(), "run", "--aot", "./program.ts"], folder),
};

describe.each(Object.keys(ways))("%s", way => {
  const isCompiled = way.endsWith("--aot");
  test.skipIf(isCompiled && unsupported).each(Object.keys(roads))(
    "%s",
    async name => {
      using dir = tempDir("every-road", roads[name].files);
      const { stdout, stderr, exitCode } = await ways[way](String(dir));
      const outcomes = roads[name].outcomes[isCompiled ? 1 : 0];
      if (outcomes[0] === "refused") {
        expect(stderr).toContain("error: ");
        expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
        return;
      }
      expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        stdout: outcomes.join("\n") + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});

const call = `import { JSON } from "bun";\nconsole.log(JSON.parse<{ id: number }>('{"id":"7"}'));`;
const needsBun = `only work in a TypeScript file that Bun runs, tests or builds with --target=bun`;

test.each(["node", "browser"])("a bundle for --target=%s is refused", async target => {
  using dir = tempDir("no-bun-to-validate-with", { "program.ts": call });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "build", "./program.ts", "--target=" + target],
    String(dir),
  );
  expect(stderr).toContain(needsBun);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test("a bundle with bytecode validates", async () => {
  using dir = tempDir("bundle-with-bytecode", { "program.ts": call });
  const flags = ["--target=bun", "--bytecode", "--format=cjs", "--outdir", "out"];
  const built = await run([bunExe(), "build", "./program.ts", ...flags], String(dir));
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", "./out/program.js"], String(dir));
  expect(stderr).toContain("TypeError: id must be number, received string");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test("text that is no file is refused", () => {
  expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(call)).toThrow(needsBun);
});

test("bun -e validates", async () => {
  using dir = tempDir("text-on-the-command-line", { "row.ts": `export interface Row { id: number }` });
  const text = `import { JSON } from "bun";\nimport type { Row } from "./row";\nJSON.parse<Row>('{"id":"7"}');`;
  const { stdout, stderr, exitCode } = await run([bunExe(), "-e", text], String(dir));
  expect(stderr).toContain("TypeError: id must be number, received string");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test("a type that another file declares is read again when that file changes", async () => {
  // The cache of transpiled files goes by the text of the file alone, and takes large files only.
  const program = `import { JSON } from "bun";
import type { Row } from "./row";
try {
  JSON.parse<Row>('{"id":7}');
  console.log("accepted");
} catch (error: any) {
  console.log("refused", error.issues.length);
}
// ${Buffer.alloc(64 * 1024, "-").toString()}
`;
  using dir = tempDir("type-of-another-file", {
    "program.ts": program,
    "row.ts": `export interface Row { id: number }`,
  });
  const env = { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache") };
  const runs = async () => (await run([bunExe(), "run", "./program.ts"], String(dir), env)).stdout;
  expect([await runs(), await runs()]).toEqual(["accepted\n", "accepted\n"]);
  await Bun.write(join(String(dir), "row.ts"), `export interface Row { id: string }`);
  expect(await runs()).toBe("refused 1\n");
});

test("names on Object.prototype change no answer", async () => {
  using dir = tempDir("names-on-object-prototype", {
    "program.ts": `import { JSON } from "bun";
import { validate } from "bun:bundle";
// As a deep merge of '{"__proto__":{..}}' leaves it.
Object.assign(Object.prototype, globalThis.JSON.parse(process.argv[2]));
function show(call: () => unknown) {
  try {
    console.log("accepted", globalThis.JSON.stringify(call()));
  } catch (error: any) {
    console.log("refused", error.issues.length);
  }
}
show(() => validate<{ role: "user" } | { role: "admin"; key: string }>({ role: "admin" }));
show(() => validate<{ a: number } | { a: string; u: { v: unknown } }>({ a: true }));
show(() => JSON.parse<{ id: number; name: string }>('{"id":1}'));
show(() => JSON.parse<{ id: number & import("bun").Schema.Min<5> }>('{"id":1}'));
show(() => JSON.parse<{ id: number } & import("bun").Schema.Strict>('{"id":1,"more":2}'));
show(() => JSON.parse<{ id: number }>('{"id":1}'));`,
  });
  const names = {
    default: "x",
    discriminant: { key: "k", tags: [], tagged: [], untagged: [6], expected: "x" },
    shape: "Unknown",
    isOptional: true,
    mustBeOwn: false,
    undeclared: "Allowed",
    undeclaredValue: 0,
    rules: [],
    members: [],
    arms: [],
    element: 0,
    elements: [],
    remembers: true,
    message: "m",
    name: "x",
    key: "x",
    id: 9,
  };
  const refusedAll = "refused 1\n".repeat(5) + `accepted {"id":1}\n`;
  for (const [name, value] of [["nothing", 0], ...Object.entries(names)]) {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "run", "./program.ts", JSON.stringify({ [name]: value })],
      String(dir),
    );
    expect({ name, stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
      name,
      stdout: refusedAll,
      stderr: "",
      exitCode: 0,
    });
  }
}, 240_000);

test("what is validated is what the compiled program validates", async () => {
  using dir = tempDir("the-same-answers", {
    "program.ts": `import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
interface User { id: number & Schema.Int; name: string & Schema.MinLength<1>; tags?: string[]; role: "admin" | "guest"; at: { x: number } | null }
function show(call: () => unknown) {
  try {
    console.log(globalThis.JSON.stringify(call()));
  } catch (error: any) {
    console.log(error.name, error.message, globalThis.JSON.stringify(error.issues));
  }
}
const right = '{"id":7,"name":"Ada","role":"admin","at":{"x":1},"more":true}';
show(() => JSON.parse<User>(right));
show(() => JSON.parse<User & Schema.Strict>(right));
show(() => JSON.parse<User>('{"id":7.5,"name":"","tags":["a",1],"role":"owner","at":{}}'));
show(() => JSON.parse<User>('{"id":'));
show(() => JSON.parse<User[]>("[" + right + ",1]"));
show(() => JSON.parse<Record<string, number>>('{"a":1,"b":"2"}'));
show(() => JSON.parse<[number, string]>('[1,2]'));
show(() => JSON.parse<{ n: number & Schema.Default<3> }>('{}'));
show(() => validate<{ n: number & Schema.Default<3> }>(globalThis.JSON.parse('{}', (key, value) => value)));
const given = { id: 7, name: "Ada", role: "guest", at: null };
show(() => validate<User>(given));
show(() => validate<User>(given) === (given as unknown));
show(() => validate<User>({ ...given, role: 1 }));
show(() => validate<number>(1e999));
show(() => validate<string | undefined>(undefined));`,
  });
  const plain = await ways["bun run"](String(dir));
  expect({ stderr: plain.exitCode ? plain.stderr : "", exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(plain.stdout.split("\n").length).toBe(15);
  for (const way of Object.keys(ways).filter(way => !(way.endsWith("--aot") && unsupported) && way !== "bun test")) {
    expect({ way, stdout: (await ways[way](String(dir))).stdout }).toEqual({ way, stdout: plain.stdout });
  }
}, 240_000);

test("the rest of the object is the global's", async () => {
  using dir = tempDir("json-of-bun", {
    "program.ts": `import { JSON } from "bun";
const global: any = globalThis.JSON, own: any = JSON;
console.log(own === global, JSON === Bun.JSON, own.stringify === global.stringify, own.rawJSON === global.rawJSON, own.isRawJSON === global.isRawJSON);
console.log(JSON.stringify({ a: [1] }), String(JSON), Object.keys(JSON), JSON.parse<any>("[1]"), JSON.parse<unknown>('"a"'), Bun.JSON.parse<any>("2"));
"use strict";
for (const change of [() => ((JSON as any).parse = global.parse), () => delete (JSON as any).parse, () => ((Bun as any).JSON = global)]) {
  try { change(); } catch {}
}
console.log(own.parse === global.parse, Bun.JSON === JSON);`,
  });
  for (const way of Object.keys(ways).filter(way => !(way.endsWith("--aot") && unsupported) && way !== "bun test")) {
    const { stdout, stderr, exitCode } = await ways[way](String(dir));
    expect({ way, stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
      way,
      stdout: `false true true true true\n{"a":[1]} [object JSON] [] [ 1 ] a 2\nfalse true\n`,
      stderr: "",
      exitCode: 0,
    });
  }
}, 120_000);

const example = `import { JSON } from "bun";

interface User {
  id: number;
  name: string;
  tags?: string[];
}

try {
  const user = JSON.parse<User>('{"id":"7","tags":["a",1]}');
  console.log("unchecked", user.id);
} catch (error) {
  console.log(String(error).slice(0, 56));
}
`;

const otherTools: Record<string, (source: string) => Promise<string>> = {
  tsc: async source => {
    const { default: ts } = await import("typescript");
    const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext };
    return ts.transpileModule(source, { compilerOptions }).outputText;
  },
  esbuild: async source => (await import("esbuild")).transformSync(source, { loader: "ts", format: "esm" }).code,
  swc: async source =>
    (await import("@swc/core")).transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2022" } })
      .code,
};

test.each(Object.keys(otherTools))("what %s emits throws", async tool => {
  const emitted = await otherTools[tool](example);
  expect(emitted).toContain("JSON.parse(");
  using dir = tempDir("emitted-by-another-tool", { "user.mjs": emitted });
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", join(String(dir), "user.mjs")], String(dir));
  // Bun sees the call in the file and refuses the file. Behind another name the call itself throws.
  expect(stderr).toContain(`JSON.parse() from "bun" needs a type argument`);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });

  using hidden = tempDir("emitted-by-another-tool", {
    "user.mjs": emitted.replace(/import \{ JSON \} from "bun";/, `const JSON = globalThis.Bun.JSON;`),
  });
  expect(await run([bunExe(), "run", join(String(hidden), "user.mjs")], String(hidden))).toEqual({
    stdout: `TypeError: JSON.parse() from "bun" has no type to valida\n`,
    stderr: "",
    exitCode: 0,
  });
});
