// Without --aot, Bun replaces `JSON.parse<T>(text)` from "bun" and `validate<T>(value)` with a method call on
// `new Bun.Validator(schema)`, where `schema` is the JSON Schema of T.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../harness/run";
import { test } from "../supported";

const imports = `import { JSON } from "bun";\nimport { validate } from "bun:bundle";\n`;

async function build(source: string, flags: string[] = [], otherFiles: Record<string, string> = {}) {
  using dir = tempDir("transpiled-calls", { "main.ts": imports + source, ...otherFiles });
  return await run([bunExe(), "build", "--target=bun", ...flags, "./main.ts"], String(dir));
}

async function transpile(source: string) {
  const { stdout, stderr, exitCode } = await build(source, ["--no-bundle"]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout;
}

const fromTypeScript = `"x-bun": { source: "typescript" }`;

test("JSON.parse<T>() becomes validator.parse()", async () => {
  const output = await transpile(`export const user = JSON.parse<{ name: string }>(process.argv[2], undefined);`);
  expect(output).toContain(
    `(__bun_validator_0$ ??= new Bun.Validator({ type: "object", properties: { name: { type: "string" } }, required: ["name"], ${fromTypeScript} })).parse(process.argv[2], undefined)`,
  );
  expect(output).toContain("var __bun_validator_0$;");
});

test("validate<T>() becomes validator.validate()", async () => {
  const output = await transpile(`export const count = validate<number>(globalThis.count);`);
  expect(output).toContain(
    `(__bun_validator_0$ ??= new Bun.Validator({ type: "number", ${fromTypeScript} })).validate(globalThis.count)`,
  );
});

test("each call has a validator of its own", async () => {
  const output = await transpile(`export const both = [validate<string>(1), validate<string>(2)];`);
  expect(output).toContain("var __bun_validator_0$, __bun_validator_1$;");
  expect(output).toContain("(__bun_validator_0$ ??= new Bun.Validator(");
  expect(output).toContain("(__bun_validator_1$ ??= new Bun.Validator(");
});

test("never becomes the schema false", async () => {
  expect(await transpile(`export const nothing = validate<never>(1);`)).toContain("new Bun.Validator(false)");
});

test("a recursive type refers to itself", async () => {
  const output = await transpile(
    `interface List { next: List | null }\nexport const lists = validate<{ a: List }>(globalThis.lists);`,
  );
  expect(output).toContain(`a: { $ref: "#/$defs/1" }`);
  expect(output).toContain(`$defs: { "1": { type: "object", properties: { next: { anyOf: [`);
});

test("a member named __proto__ is written as an own property", async () => {
  const output = await transpile(`export const value = validate<{ "__proto__": string }>(globalThis.value);`);
  expect(output).toContain(`properties: { ["__proto__"]: { type: "string" } }, required: ["__proto__"]`);
});

test("strings keep lone surrogates and other characters", async () => {
  const output = await transpile(String.raw`export const value = validate<"\uD800" | "é\"\n">(globalThis.value);`);
  const literal = output.slice(output.indexOf("enum: ") + "enum: ".length, output.indexOf("]") + 1);
  expect((0, eval)(literal).toSorted()).toEqual(["\uD800", 'é"\n'].toSorted());
});

test("numbers are written as JavaScript writes them", async () => {
  const output = await transpile(`export const value = validate<-1.5 | 1e21 | 5e-324>(globalThis.value);`);
  const literal = output.slice(output.indexOf("enum: ") + "enum: ".length, output.indexOf("]") + 1);
  expect((0, eval)(literal).toSorted()).toEqual([-1.5, 1e21, 5e-324].toSorted());
});

test.each([
  ["a variable of the module", `const Bun = {};\nexport const value = [Bun, validate<string>(1)];`],
  ["a parameter", `export function check(Bun: unknown) { return [Bun, validate<string>(1)]; }`],
  ["an import", `import Bun from "bun";\nexport const value = [Bun, validate<string>(1)];`],
])("a call where Bun is %s reaches the global through globalThis", async (_, source) => {
  expect(await transpile(source)).toContain("??= new globalThis.Bun.Validator(");
});

test("a Bun that is declared in another scope changes nothing", async () => {
  const output = await transpile(
    `export function other(Bun: unknown) { return Bun; }\nexport const value = validate<string>(1);`,
  );
  expect(output).toContain("??= new Bun.Validator(");
});

test("a call where Bun and globalThis are both shadowed is an error", async () => {
  const { stderr, exitCode } = await build(
    `export function check(Bun: unknown, globalThis: unknown) { return [Bun, globalThis, validate<string>(1)]; }`,
    ["--no-bundle"],
  );
  expect(stderr).toContain(`"Bun" and "globalThis" are both shadowed here`);
  expect(exitCode).toBe(1);
});

test("a bundle reaches the global Bun from a module that declares a Bun", async () => {
  const { stdout, stderr, exitCode } = await build(
    `const Bun = { Validator: null };\nconsole.log(Bun, validate<string>("a"));`,
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(stdout).toContain("(validator ??= new globalThis.Bun.Validator(");
});

test("a bundle renames the Bun that another module declares", async () => {
  const { stdout, stderr, exitCode } = await build(
    `import { Bun as other } from "./other";\nconsole.log(other, validate<string>("a"));`,
    [],
    { "other.ts": `export const Bun = { Validator: null };` },
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(stdout).toContain("var Bun2 = { Validator: null };");
  expect(stdout).toContain("(validator ??= new Bun.Validator(");
});
