// A type that holds what no data can be, such as a function, a Date or a type parameter, cannot be given to `JSON.parse<T>()` or
// `validate<T>()`: the build stops and names the member. It stops too where a type argument stands on a function that takes none,
// where the type does not resolve, and where a rule of `Schema` is not as it was written or has arguments that say no rule.
// Another spelling of `parse` of the `JSON` of "bun" is the same function, so it validates as well.
// A type argument of the global `JSON.parse` is one that the program declared: it is erased, whatever it is.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

test.each([
  [
    'interface Meeting { title: string; when: Date }\nconsole.log(Bun.JSON.parse<Meeting>("{}"));',
    "JSON.parse<Meeting>() cannot validate 'when: Date'. Only types that JSON can represent can be validated.",
  ],
  [
    'interface Handler { name: string; steps: { run: () => void }[] }\nconsole.log(Bun.JSON.parse<Handler>("{}"));',
    "JSON.parse<Handler>() cannot validate 'steps[number].run: () => void'.",
  ],
  [
    'function generic<T>(text: string): T { return Bun.JSON.parse<T>(text); }\nconsole.log(generic<number>("1"));',
    "'T' is a type parameter here, so there is no type to validate against.",
  ],
  ['console.log(Bun.JSON.parse<{ id: symbol }>("{}"));', "JSON.parse<{ id: symbol; }>() cannot validate 'id: symbol'."],
  [
    'console.log(Bun.JSON.parse<[string, number?]>("[]"));',
    "JSON.parse<[string, (number | undefined)?]>() cannot validate '[string, (number | undefined)?]'.",
  ],
  [
    'console.log(Bun.JSON.parse<Uppercase<string>>("1"));',
    "JSON.parse<Uppercase<string>>() cannot validate 'Uppercase<string>'.",
  ],
  ['console.log(Bun.JSON.parse<{ code: Lowercase<string> }>("{}"));', "cannot validate 'code: Lowercase<string>'."],
  ['console.log(Bun.JSON.parse<Capitalize<string>[]>("[]"));', "cannot validate '[number]: Capitalize<string>'."],
  ['console.log(Bun.JSON.parse<`id-${Uppercase<string>}`>("1"));', "cannot validate '`id-${Uppercase<string>}`'."],
  ['console.log(Bun.JSON.parse<typeof globalThis>("{}"));', "cannot validate 'typeof globalThis'."],
  ['console.log(Bun.JSON.parse<{ g: typeof globalThis }>("{}"));', "cannot validate 'g: typeof globalThis'."],
  ['enum Color { Red, Green }\nconsole.log(Bun.JSON.parse<typeof Color>("{}"));', "cannot validate 'typeof Color'."],
  [
    'namespace Shapes { export const sides = 4; }\nconsole.log(Bun.JSON.parse<typeof Shapes>("{}"));',
    "cannot validate 'typeof Shapes'.",
  ],
  [
    'import { validate } from "bun:bundle";\nconsole.log(validate<{ run: () => void }>({}));',
    "validate<{ run: () => void; }>() cannot validate 'run: () => void'.",
  ],
  ['// @ts-ignore\nimport type { User } from "./no-such-file";\nconsole.log(Bun.JSON.parse<User>("{}"));', "TS100518"],
  [
    '// @ts-ignore\nimport type { User } from "./no-such-file";\nconsole.log(Bun.JSON.parse<{ id: number; user: User }>("{}"));',
    "TS100518",
  ],
  [
    '// @ts-ignore\nimport type { User } from "./no-such-file";\nconsole.log(Bun.JSON.parse<User[]>("[]"));',
    "TS100518",
  ],
  ['// @ts-expect-error\nconsole.log(Bun.JSON.parse<Missing>("5"));', "TS100518"],
  ['import { validate } from "bun:bundle";\n// @ts-expect-error\nconsole.log(validate<Missing>(5));', "TS100518"],
  ['import { JSON } from "bun";\nconsole.log((JSON as any).parse<{ id: number }>("{}"));', "TS100518"],
  ['import { JSON } from "bun";\nconsole.log((JSON.parse as any)<{ id: number }>("{}"));', "TS100518"],
  ['console.log((Bun.JSON as any).parse<{ id: number }>("{}"));', "TS100518"],
  ['const parse = Bun.JSON.parse<{ id: number }>;\nconsole.log(parse("{}"));', "TS100521"],
  ['console.log((Bun.JSON.parse<{ id: number }>)("{}"));', "TS100521"],
  ['console.log(["{}"].map(Bun.JSON.parse<{ id: number }>));', "TS100521"],
  ['import { JSON } from "bun";\nconsole.log((JSON.parse<{ id: number }>)("{}"));', "TS100521"],
  ['import { JSON } from "bun";\n// @ts-ignore\nconsole.log(JSON.parse<any, { id: number }>("{}"));', "TS100518"],
  [
    'import type { Schema } from "bun";\ntype Options = { port: number & Schema.Default<80> };\nconsole.log(Bun.JSON.parse<Options>("{}", (key, value) => value));',
    "JSON.parse<Options>() can't take a second argument, because Options uses Schema.Default.",
  ],
  [
    'import type { Schema } from "bun";\nconsole.log(Bun.JSON.parse<{ rows: { size: number & Schema.Default<1> }[] } | null>("null", undefined));',
    "TS100520",
  ],
  [
    'import { JSON, type Schema } from "bun";\nconsole.log(JSON.parse<{ on: boolean & Schema.Default<false> }>("{}", (key, value) => value));',
    "TS100520",
  ],
  [
    'import type { Schema } from "bun";\ntype Writable<T> = { -readonly [K in keyof T]: T[K] };\nconsole.log(Bun.JSON.parse<Writable<{ readonly id: number } & Schema.Strict>>("{}"));',
    "cannot validate",
  ],
  [
    'import type { Schema } from "bun";\nconsole.log(Bun.JSON.parse<Partial<{ id: number } & Schema.Strict>>("{}"));',
    "cannot validate",
  ],
  [
    'import type { Schema } from "bun";\nconsole.log(Bun.JSON.parse<string & Readonly<Schema.MinLength<8>>>("1"));',
    "cannot validate",
  ],
  [
    'import type { Schema } from "bun";\nconsole.log(Bun.JSON.parse<{ name: Schema.MinLength<3> }>("{}"));',
    "cannot validate",
  ],
  [
    'import type { Schema } from "bun";\nconst limits = { least: 5 };\nconsole.log(Bun.JSON.parse<number & Schema.Min<typeof limits.least>>("1"));',
    "cannot validate",
  ],
  [
    'import type { Schema } from "bun";\nconsole.log(Bun.JSON.parse<string & Schema.MinLength<-1>>("1"));',
    "cannot validate",
  ],
  [
    'import type { Schema } from "bun";\nconsole.log(Bun.JSON.parse<string & Schema.Format<"email" | "uuid">>("1"));',
    "cannot validate",
  ],
])(
  "%s",
  async (program, message) => {
    using dir = tempDir("types-that-cannot-be-validated", { "program.ts": program });
    const { stderr: said, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")],
      String(dir),
    );
    expect(said).toContain(message);
    expect(exitCode).toBe(1);
  },
  120_000,
);

test("no other function of JSON takes a type argument", async () => {
  using dir = tempDir("type-argument-on-another-function", { "program.ts": "console.log(JSON.stringify<number>(1));" });
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")],
    String(dir),
  );
  expect(said).toContain("TS2558");
  expect(exitCode).toBe(1);
}, 120_000);

test("the global JSON.parse takes no type argument", async () => {
  using dir = tempDir("type-argument-on-the-global", { "program.ts": 'console.log(JSON.parse<number>("1"));' });
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")],
    String(dir),
  );
  expect(said).toContain("TS2558");
  expect(exitCode).toBe(1);
}, 120_000);

test.each([
  "console.log(JSON.parse<number>(text), JSON.parse<Map<string, Date>>(text), JSON.parse<() => void>(text));",
  "function load<T>(from: string): T {\n  return JSON.parse<T>(from);\n}\nconsole.log(load<number>(text));",
  "const parse = JSON.parse<number>;\nconsole.log(parse(text), [text].map(JSON.parse<number>));",
  "const parse: <T>(text: string) => T = JSON.parse;\nconsole.log(parse<number>(text));",
  "const { parse } = JSON;\nconsole.log(parse<number>(text), globalThis.JSON.parse<number>(text));",
])(
  "a type argument that the program gave the global JSON.parse is erased: %s",
  async calls => {
    const program = `declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}
const text: string = '"text"';
${calls}
export {};
`;
    using dir = tempDir("type-argument-of-the-programs-own", { "program.ts": program });
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", executable],
      String(dir),
    );
    expect({ said: built.stderr, exitCode: built.exitCode }).toEqual({ said: "", exitCode: 0 });
    const compiled = await run([executable], String(dir));
    const plain = await run([bunExe(), "run", "./program.ts"], String(dir));
    expect(plain.stdout).toStartWith("text");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  120_000,
);

test.each([
  ["", "globalThis.Bun.JSON.parse"],
  ["const { parse } = Bun.JSON;", "parse"],
  ["const parse = Bun.JSON.parse;", "parse"],
])(
  "another spelling of parse of the JSON of bun validates too: %s %s",
  async (declaration, parse) => {
    const program = `declare const console: { log(...values: unknown[]): void };
${declaration}
console.log(${parse}<number>("1"));
try {
  console.log(${parse}<number>('"text"'));
} catch (error) {
  console.log(String(error));
}
`;
    using dir = tempDir("type-argument-on-another-spelling", { "program.ts": program });
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    const { stderr: said, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", executable],
      String(dir),
    );
    expect({ said: buildExitCode ? said : "", buildExitCode }).toEqual({ said: "", buildExitCode: 0 });
    const { stdout, exitCode } = await run([executable], String(dir));
    expect({ stdout, exitCode }).toEqual({
      stdout: "1\nTypeError: value must be number, received string\n",
      exitCode: 0,
    });
  },
  120_000,
);
