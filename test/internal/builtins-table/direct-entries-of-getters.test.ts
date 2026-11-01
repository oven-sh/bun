import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join, resolve } from "node:path";
import { collectBindgen } from "../../../src/codegen/builtins/collect-bindgen.ts";
import { Problems, type MemberDeclaration } from "../../../src/codegen/builtins/declarations.ts";

const library = resolve(import.meta.dir, "../../../src/codegen/bindgen-lib.ts");

/** The accessors of a class `Thing` with these keys, as the table of built-ins reads them. */
async function collect(definition: string): Promise<{ problems: readonly string[]; accessors: MemberDeclaration[] }> {
  using dir = tempDir("direct-entries-of-getters", {
    "thing.bind.ts": `import * as b from ${JSON.stringify(library)};
export const Thing = b.class({ rustPath: "crate::thing::Thing", ${definition} });
`,
  });
  const problems = new Problems();
  const source = `bun_runtime=${join(String(dir), "thing.bind.ts")}`;
  const { declarations } = await collectBindgen(String(dir), [source], new Map(), new Set(), new Map(), problems);
  return {
    problems: problems.lines,
    accessors: declarations.flatMap(({ declaration }) =>
      declaration.declares === "Member" && declaration.kind === "Accessor" ? [declaration] : [],
    ),
  };
}

async function accessorOf(definition: string): Promise<MemberDeclaration> {
  const { problems, accessors } = await collect(definition);
  expect(problems).toEqual([]);
  expect(accessors).toHaveLength(1);
  return accessors[0];
}

async function entriesOf(definition: string): Promise<Record<string, string | null>> {
  const { problems, accessors } = await collect(definition);
  expect(problems).toEqual([]);
  return Object.fromEntries(accessors.map(({ path, columns }) => [path, columns.directEntryOfGetter?.symbol ?? null]));
}

test("a getter is entered at its thunk, which takes the realm and the cell of the receiver", async () => {
  expect((await accessorOf(`proto: { size: { getter: b.f64 } }`)).columns).toMatchObject({
    nativeSymbols: ["jsThingPrototypeGetter_size"],
    customGetter: "jsThingPrototypeGetter_size",
    directEntryOfGetter: {
      symbol: "Bun__Bindgen__ThingPrototypeGetter__size",
      declaration:
        'extern "C" SYSV_ABI JSC::EncodedJSValue Bun__Bindgen__ThingPrototypeGetter__size(JSC::JSGlobalObject*, JSC::JSCell*);',
      headers: ["GeneratedThing.h"],
      parameters: [
        { value: "Realm", cppType: "JSC::JSGlobalObject*" },
        { value: "Receiver", cppType: "JSC::JSCell*" },
      ],
    },
  });
});

test("it does not matter whether the schema says what the getter answers", async () => {
  expect(await entriesOf(`proto: { data: { getter: b.any, capability: "js" } }`)).toEqual({
    "%Thing%.prototype.data": "Bun__Bindgen__ThingPrototypeGetter__data",
  });
});

test("a getter that is also passed its wrapper is entered the same way", async () => {
  const { directEntryOfGetter } = (await accessorOf(`proto: { timeout: { getter: b.f64, passThis: true } }`)).columns;
  expect(directEntryOfGetter?.parameters.map(({ value }) => value)).toEqual(["Realm", "Receiver"]);
});

test("a getter that keeps its answer in a field is entered through the table", async () => {
  expect(
    await entriesOf(`
      internalFields: ["kept"],
      proto: {
        address: { getter: b.string, cache: true },
        kept: { internalField: "kept" },
      },
    `),
  ).toEqual({
    "%Thing%.prototype.address": null,
    "%Thing%.prototype.kept": null,
  });
});

test("a getter whose answer nothing proves is entered at its thunk too: compiled code tests the answer", async () => {
  expect(
    await entriesOf(`
      proto: {
        name: { getter: b.string.local, capability: "heap" },
        peer: { getter: b.self, capability: "heap" },
        size: { getter: b.any.returning("number"), capability: "heap" },
      },
    `),
  ).toEqual({
    "%Thing%.prototype.name": "Bun__Bindgen__ThingPrototypeGetter__name",
    "%Thing%.prototype.peer": "Bun__Bindgen__ThingPrototypeGetter__peer",
    "%Thing%.prototype.size": "Bun__Bindgen__ThingPrototypeGetter__size",
  });
  for (const field of [`b.string.local`, `b.self`, `b.any.returning("number")`]) {
    const [signature] = (await accessorOf(`proto: { size: { getter: ${field}, capability: "heap" } }`)).signatures;
    expect(signature.resultIsDeclaredOnly).toBe(true);
  }
});

test("a pure getter touches no heap, throws nothing and writes nothing", async () => {
  const signatureOf = async (field: string) => (await accessorOf(`proto: { size: ${field} }`)).signatures[0];
  expect(await signatureOf(`{ getter: b.f64, pure: true }`)).toMatchObject({
    mode: "Get",
    capability: "none",
    throws: false,
    reads: ["ExternalState"],
    writes: [],
  });
  expect(await signatureOf(`{ getter: b.f64 }`)).toMatchObject({
    capability: "none",
    throws: false,
    writes: ["ExternalState"],
  });
  // A body without `throws: true` returns no `Result`.
  expect(await signatureOf(`{ getter: b.any.returning("number"), capability: "heap" }`)).toMatchObject({
    capability: "heap",
    throws: false,
    writes: ["ExternalState"],
  });
  expect(await signatureOf(`{ getter: b.any.returning("number"), capability: "heap", throws: true }`)).toMatchObject({
    capability: "heap",
    throws: true,
  });
  expect(await signatureOf(`{ getter: b.any.returning("number"), capability: "js" }`)).toMatchObject({
    capability: "heap",
    throws: true,
  });
});

test("a pure getter answers no cell", async () => {
  const refusal = async (field: string) => (await collect(`proto: { size: ${field} }`)).problems.join("\n");
  const hasMore = "size: a pure getter has no capability, throws, cache or passThis";
  expect(await refusal(`{ getter: b.i32.nullable, pure: true }`)).toBe("");
  expect(await refusal(`{ getter: b.u16.optional, pure: true }`)).toBe("");
  expect(await refusal(`{ getter: b.any, passThis: true, pure: true }`)).toContain(hasMore);
  expect(await refusal(`{ getter: b.f64, cache: true, pure: true }`)).toContain(hasMore);
  expect(await refusal(`{ getter: b.string, pure: true }`)).toContain("size: a pure getter allocates nothing");
});

test("a store is entered only where the accessor cannot be replaced", async () => {
  const handler = `proto: { ondata: { getter: b.any, setter: { capability: "js" }, passThis: true } }`;
  expect((await accessorOf(handler)).columns.directEntryOfSetter).toBeUndefined();
  expect((await accessorOf(`lockedObjects: ["prototype"], ${handler}`)).columns.directEntryOfSetter).toMatchObject({
    symbol: "AOT__Bun__Bindgen__ThingPrototypeSetter__ondata",
    parameters: [{ value: "Realm" }, { value: "Receiver" }, { value: "Value", cppType: "JSC::EncodedJSValue" }],
  });
});

test("the getters of a constructor and of a function that is bound take other things", async () => {
  expect(await entriesOf(`construct: {}, static: { count: { getter: b.f64 } }`)).toEqual({ "%Thing%.count": null });
  expect(await entriesOf(`forBind: true, proto: { size: { getter: b.f64 } }`)).toEqual({
    "%Thing%.prototype.size": null,
  });
});
