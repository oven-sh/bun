// b.leftOut(): what the table leaves out of a host.
import { expect, test } from "bun:test";
import { parseHashTable } from "../../../src/codegen/builtins/collect-static-tables.ts";
import type { LeftOutDeclaration, Source } from "../../../src/codegen/builtins/declarations.ts";
import { leftOut } from "../../../src/codegen/builtins/lib.ts";
import { ModelBuilder } from "../../../src/codegen/builtins/model-builder.ts";

const source: Source = { file: "made-up.builtins.ts", line: null, origin: "Host", proof: "Structure" };

function builderOf(parts: Parameters<typeof leftOut>[0]): ModelBuilder {
  const builder = new ModelBuilder({ schema: null as never, engineFiles: [] });
  for (const declaration of leftOut(parts)) builder.leaveOut(declaration as LeftOutDeclaration);
  return builder;
}

test("nothing is declared at a path that is left out or under it", () => {
  const builder = builderOf({ paths: ["%Gone%", "%Kept%.gone"] });
  expect(builder.create("%Gone%", "Namespace", source)).toBeNull();
  expect(builder.create("%Gone%.member", "Function", source)).toBeNull();
  expect(builder.create("%Kept%", "Namespace", source)).not.toBeNull();
  expect(builder.create("%Kept%.gone", "Namespace", source)).toBeNull();
  expect(builder.create("%Kept%.gone.member", "Function", source)).toBeNull();
  expect(builder.create("%Kept%.goneToo", "Function", source)).not.toBeNull();
  expect(builder.problems.lines).toEqual([]);
});

test("a declaration that names what nothing declares stops the build", () => {
  for (const parts of [{}, { paths: ["%Gone%"] }, { schemas: ["made_up_test.bind.ts"] }]) {
    const builder = builderOf(parts);
    expect(builder.resolve("%Gone%.member", source)).toBeNull();
    expect(builder.problems.lines).toEqual([expect.stringContaining("%Gone%.member: no class, namespace or entry")]);
  }
});

test("it says nothing where what is left out may be named", () => {
  const builder = builderOf({ paths: ["%Gone%"], mayBeNamed: true });
  expect(builder.resolve("%Gone%.member", source)).toBeNull();
  expect(builder.resolveClass("Gone", source)).toBeNull();
  expect(builder.resolveModule("made:up", source)).toBeNull();
  expect(builder.problems.lines).toEqual([]);
});

const table = `
@begin madeUpTable
  always    madeUpAlways    Function 0
#if !defined(WITHOUT_FIRST)
  first     madeUpFirst     Function 1
#endif
#if defined(WITHOUT_FIRST)
  instead   madeUpInstead   Function 1
#else
  second    madeUpSecond    Function 2
#endif
@end
`;

const keysWith = (...definedNames: string[]): string[] =>
  parseHashTable(table, "madeUpTable", "made-up.cpp", new Set(definedNames)).map(({ key }) => key);

test("a static table has the rows of the names that are defined", () => {
  expect(keysWith()).toEqual(["always", "first", "second"]);
  expect(keysWith("WITHOUT_OTHER")).toEqual(["always", "first", "second"]);
  expect(keysWith("WITHOUT_FIRST")).toEqual(["always", "instead"]);
});
