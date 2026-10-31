import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkNamesReadByNativeCode } from "../../../src/codegen/builtins/check-host-uses.ts";
import { Problems, type Declaration } from "../../../src/codegen/builtins/declarations.ts";
import { registerLibraryModule } from "../../../src/codegen/builtins/load-declaration-files.ts";
import type { ModelBuiltin, ModelName } from "../../../src/codegen/builtins/model.ts";

const root = resolve(import.meta.dir, "../../..");

const nameOf = (text: string, number: number): ModelName => ({ number, text, kind: "Text", cppConstant: null });
const objectAbove = { text: "Object.prototype" } as ModelBuiltin;
const entry = (columns: Partial<ModelBuiltin> = {}) =>
  ({
    text: "host",
    scope: "Realm",
    flags: [],
    sameObjectAs: null,
    prototype: { link: "Builtin", builtin: objectAbove },
    ...columns,
  }) as ModelBuiltin;

function problemsOf(
  holder: ModelBuiltin,
  names: readonly ModelName[] = [nameOf("emit", 0)],
  namesOnlyInspected: readonly ModelName[] = [],
): readonly string[] {
  const problems = new Problems();
  checkNamesReadByNativeCode({ namesReadByNativeCode: [{ holder, names, namesOnlyInspected }] }, problems);
  return problems.lines;
}

test("an object of the realm with a known chain takes the list", () => {
  expect(problemsOf(entry())).toEqual([]);
  expect(problemsOf(entry({ prototype: { link: "Null" } }), [])).toEqual([]);
});

test("the list is refused where a program stores nothing, where native code reads everything, and where the chain is not known", () => {
  expect(problemsOf(entry({ scope: "Module" }))).toEqual([
    "host lists the names that native code reads, and every module has an object of its own",
  ]);
  expect(problemsOf(entry({ sameObjectAs: entry({ text: "other" }) }))).toEqual([
    "host lists the names that native code reads, and it is the same object as other, where the list belongs",
  ]);
  expect(problemsOf(entry({ flags: ["IsGlobalObject"] }))).toEqual([
    "host lists the names that native code reads, and native code finds every global variable on the global object",
  ]);
  expect(problemsOf(entry({ flags: ["IsLockedObject"] }))).toEqual([
    "host lists the names that native code reads, and it is locked, so a program puts nothing there",
  ]);
  expect(problemsOf(entry({ prototype: { link: "Unknown" } }))).toEqual([
    "host lists the names that native code reads, and nothing says what lies above it, where a lookup goes on",
  ]);
});

test("a name is listed once, and an index is no name", () => {
  const emit = nameOf("emit", 0);
  expect(problemsOf(entry(), [emit, emit])).toEqual([
    "host lists the names that native code reads, and emit is listed twice",
  ]);
  expect(problemsOf(entry(), [nameOf("7", 0)])).toEqual([
    "host lists the names that native code reads, and 7 is an index",
  ]);
});

test("a name that native code only inspects is one of the names that it reads", () => {
  const [emit, flag] = [nameOf("emit", 0), nameOf("flag", 1)];
  expect(problemsOf(entry(), [emit, flag], [flag])).toEqual([]);
  expect(problemsOf(entry(), [emit], [flag])).toEqual([
    "host lists the names that native code reads, and flag, which it only inspects, is not among them",
  ]);
});

function* cppFilesUnder(directory: string): Generator<string> {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) yield* cppFilesUnder(path);
    else if (/\.(cpp|h)$/.test(item.name)) yield path;
  }
}

// In a member function of Process the object is `this`, written or not. Everywhere else it is a variable named process or processObject, or the call that answers it.
const lookupOnProcess =
  /(?:\bprocess|\bprocessObject|processObject\(\))->(?:get|getIfPropertyExists|getDirect|put|putInline|hasProperty)\(\s*(?:\w+,\s*)?(?:JSC::)?(?:Identifier::fromString\(vm, "([^"]+)"_s\)|(\w+))/g;
const lookupOnThis =
  /(?:\bthis->|\breturn )(?:get|getIfPropertyExists|put|hasProperty)\(\s*\w+,\s*(?:JSC::)?Identifier::fromString\((?:vm|\w+->vm\(\)), "([^"]+)"_s\)/g;
// The texts that an Identifier in a variable is made of: a literal, or each literal of the list that a loop goes through.
function textsOfIdentifier(text: string, variable: string): string[] {
  const made = new RegExp(
    `\\b${variable}\\s*=\\s*(?:JSC::)?Identifier::fromString\\(vm, (?:"([^"]+)"_s|(\\w+))\\)`,
  ).exec(text);
  if (made === null) return [];
  if (made[1] !== undefined) return [made[1]];
  const listed = new RegExp(`for \\(ASCIILiteral ${made[2]} : \\{([^}]*)\\}\\)`).exec(text);
  return [...(listed?.[1] ?? "").matchAll(/"([^"]+)"_s/g)].map(([, literal]) => literal);
}

test("the list of process has every name that native code looks up on the object", async () => {
  registerLibraryModule();
  const file = join(root, "src/codegen/builtins/host/process.builtins.ts");
  const declarations: readonly Declaration[] = (await import(file)).default.declarations;
  const row = declarations.find(declaration => declaration.declares === "Namespace" && declaration.path === "process");
  const listed = row?.declares === "Namespace" ? row.namesReadByNativeCode : null;

  const found = new Set<string>();
  for (const path of cppFilesUnder(join(root, "src/jsc"))) {
    const text = readFileSync(path, "utf8");
    for (const [, literal, variable] of text.matchAll(lookupOnProcess)) {
      const names = literal === undefined ? textsOfIdentifier(text, variable) : [literal];
      expect(names, `${path}: the name in ${variable}`).not.toBeEmpty();
      for (const name of names) found.add(name);
    }
    if (!path.endsWith("BunProcess.cpp")) continue;
    for (const [, literal] of text.matchAll(lookupOnThis)) found.add(literal);
  }
  expect([...found].sort()).toEqual([...(listed ?? [])].sort());
});
