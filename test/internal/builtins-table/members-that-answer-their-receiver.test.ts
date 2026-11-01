import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join, resolve } from "node:path";
import { collectBindgen } from "../../../src/codegen/builtins/collect-bindgen.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";

const library = resolve(import.meta.dir, "../../../src/codegen/bindgen-lib.ts");

/** What each function of the prototype of a class `Thing` does with its receiver, as the table of built-ins reads the schema. */
async function usesOfReceivers(proto: string): Promise<Record<string, string[]>> {
  using dir = tempDir("members-that-answer-their-receiver", {
    "thing.bind.ts": `import * as b from ${JSON.stringify(library)};
export const Other = b.class({ rustPath: "crate::thing::Other" });
export const Thing = b.class({ rustPath: "crate::thing::Thing", proto: { ${proto} } });
`,
  });
  const problems = new Problems();
  const source = `bun_runtime=${join(String(dir), "thing.bind.ts")}`;
  const { declarations } = await collectBindgen(String(dir), [source], new Map(), new Set(), new Map(), problems);
  expect(problems.lines).toEqual([]);
  return Object.fromEntries(
    declarations.flatMap(({ declaration }) =>
      declaration.declares === "Member" && declaration.signatures.length > 0
        ? [[declaration.path, (declaration.signatures[0].uses?.this ?? []).map(({ use }) => use)]]
        : [],
    ),
  );
}

/** What each function of the prototype of `Thing` does with each of its arguments. */
async function usesOfArguments(proto: string): Promise<Record<string, Record<string, string[]>>> {
  using dir = tempDir("members-that-answer-their-receiver", {
    "thing.bind.ts": `import * as b from ${JSON.stringify(library)};
export const Other = b.class({ rustPath: "crate::thing::Other" });
export const Thing = b.class({ rustPath: "crate::thing::Thing", proto: { ${proto} } });
`,
  });
  const problems = new Problems();
  const source = `bun_runtime=${join(String(dir), "thing.bind.ts")}`;
  const { declarations } = await collectBindgen(String(dir), [source], new Map(), new Set(), new Map(), problems);
  expect(problems.lines).toEqual([]);
  return Object.fromEntries(
    declarations.flatMap(({ declaration }) =>
      declaration.declares === "Member" &&
      declaration.signatures.length > 0 &&
      declaration.signatures[0].parameters.length > 0
        ? [
            [
              declaration.path,
              Object.fromEntries(
                declaration.signatures[0].parameters.map(({ name }) => [
                  name,
                  (declaration.signatures[0].uses?.[name] ?? []).map(({ use }) => use),
                ]),
              ),
            ],
          ]
        : [],
    ),
  );
}

test("a member that is passed its wrapper and answers an object of its class may answer its receiver", async () => {
  expect(
    await usesOfReceivers(`
      ref: { returns: b.self, passThis: true },
      remove: { returns: b.self.optional, passThis: true },
      append: { returns: b.self.nullable, passThis: true },
      on: { args: { handlers: b.any }, returns: b.self, passThis: true, capability: "js", throws: true },
      unref: { returns: b.self, passThis: true, invalidThis: "undefined" },
      anyObject: { returns: b.any.returning("object"), passThis: true, capability: "heap" },
    `),
  ).toEqual({
    "%Other%.prototype.@@toStringTag": [],
    "%Thing%.prototype.@@toStringTag": [],
    "%Thing%.prototype.ref": ["Retains", "Returns"],
    "%Thing%.prototype.remove": ["Retains", "Returns"],
    "%Thing%.prototype.append": ["Retains", "Returns"],
    "%Thing%.prototype.on": ["Retains", "Returns"],
    "%Thing%.prototype.unref": ["Retains", "Returns"],
    "%Thing%.prototype.anyObject": ["Retains", "Returns"],
  });
});

test("one that is passed its wrapper and answers nothing that its receiver can be keeps it and does not answer it", async () => {
  expect(
    await usesOfReceivers(`
      size: { returns: b.f64, passThis: true },
      other: { returns: Other, passThis: true, capability: "heap" },
      later: { returns: b.any.returning("Promise"), passThis: true, capability: "heap" },
    `),
  ).toEqual({
    "%Other%.prototype.@@toStringTag": [],
    "%Thing%.prototype.@@toStringTag": [],
    "%Thing%.prototype.size": ["Retains"],
    "%Thing%.prototype.other": ["Retains"],
    "%Thing%.prototype.later": ["Retains"],
  });
});

// The body is handed `&self` alone, like a getter's: it can neither keep the wrapper nor answer it.
test("one that runs no JavaScript and is not passed its wrapper neither keeps nor answers its receiver", async () => {
  expect(
    await usesOfReceivers(`
      copy: { returns: b.self, capability: "heap" },
      size: { returns: b.f64 },
      name: { returns: b.string.local, capability: "heap" },
      digest: { returns: b.any.returning("string", "Buffer"), capability: "heap", mutates: true },
      update: { args: { input: b.bytes({ from: ["buffer"] }) }, returns: b.self, capability: "heap", mutates: true },
    `),
  ).toEqual({
    "%Other%.prototype.@@toStringTag": [],
    "%Thing%.prototype.@@toStringTag": [],
    "%Thing%.prototype.copy": ["ReadsContents", "WritesContents", "RetainsContents"],
    "%Thing%.prototype.size": ["ReadsContents", "WritesContents"],
    "%Thing%.prototype.name": ["ReadsContents", "WritesContents"],
    "%Thing%.prototype.digest": ["ReadsContents", "WritesContents", "RetainsContents"],
    "%Thing%.prototype.update": ["ReadsContents", "WritesContents", "RetainsContents"],
  });
});

test("one that runs no JavaScript and answers its receiver with b.this is handed its wrapper only to answer it", async () => {
  expect(
    await usesOfReceivers(`
      ref: { returns: b.this, passThis: true },
      remove: { returns: b.this.optional, passThis: true, capability: "heap" },
      append: { args: { content: b.string }, returns: b.this.nullable, passThis: true, capability: "heap", throws: true },
      update: { args: { input: b.bytes({ from: ["buffer"] }) }, returns: b.this, passThis: true, capability: "heap", mutates: true },
    `),
  ).toEqual({
    "%Other%.prototype.@@toStringTag": [],
    "%Thing%.prototype.@@toStringTag": [],
    "%Thing%.prototype.ref": ["Returns", "ReadsContents", "WritesContents"],
    "%Thing%.prototype.remove": ["Returns", "ReadsContents", "WritesContents"],
    "%Thing%.prototype.append": ["Returns", "ReadsContents", "WritesContents"],
    "%Thing%.prototype.update": ["Returns", "ReadsContents", "WritesContents"],
  });
});

test("b.this is the receiver to the table, and b.self any instance of the class", async () => {
  const resultsOf = (declarations: Awaited<ReturnType<typeof collectBindgen>>["declarations"]) =>
    Object.fromEntries(
      declarations.flatMap(({ declaration }) =>
        declaration.declares === "Member" && declaration.signatures.length > 0 && declaration.path.includes("Thing")
          ? [[declaration.path, declaration.signatures[0].result]]
          : [],
      ),
    );
  using dir = tempDir("members-that-answer-their-receiver", {
    "thing.bind.ts": `import * as b from ${JSON.stringify(library)};
export const Thing = b.class({ rustPath: "crate::thing::Thing", proto: {
  ref: { returns: b.this, passThis: true },
  remove: { returns: b.this.optional, passThis: true, capability: "heap" },
  copy: { returns: b.self, capability: "heap" },
} });
`,
  });
  const problems = new Problems();
  const source = `bun_runtime=${join(String(dir), "thing.bind.ts")}`;
  const { declarations } = await collectBindgen(String(dir), [source], new Map(), new Set(), new Map(), problems);
  expect(problems.lines).toEqual([]);
  expect(resultsOf(declarations)).toEqual({
    "%Thing%.prototype.@@toStringTag": { type: "Primitive", primitive: "String" },
    "%Thing%.prototype.ref": { type: "Operand", operand: "this" },
    "%Thing%.prototype.remove": {
      type: "Union",
      members: [
        { type: "Operand", operand: "this" },
        { type: "Primitive", primitive: "Undefined" },
      ],
    },
    "%Thing%.prototype.copy": { type: "Instance", class: "Thing" },
  });
});

test("b.this is only the result of a function, and takes passThis", async () => {
  const problemsOf = async (proto: string): Promise<string[]> => {
    using dir = tempDir("members-that-answer-their-receiver", {
      "thing.bind.ts": `import * as b from ${JSON.stringify(library)};
export const Thing = b.class({ rustPath: "crate::thing::Thing", proto: { ${proto} } });
`,
    });
    const problems = new Problems();
    const source = `bun_runtime=${join(String(dir), "thing.bind.ts")}`;
    try {
      await collectBindgen(String(dir), [source], new Map(), new Set(), new Map(), problems);
    } catch (error) {
      return [String(error)];
    }
    return problems.lines;
  };
  expect(await problemsOf(`ref: { returns: b.this }`)).toEqual([
    expect.stringContaining("returns: b.this takes passThis"),
  ]);
  expect(await problemsOf(`plus: { args: { other: b.this }, passThis: true }`)).toEqual([
    expect.stringContaining("other: b.this is a result"),
  ]);
  expect(await problemsOf(`twin: { getter: b.this, passThis: true }`)).toEqual([
    expect.stringContaining("twin: b.this is the result of a function"),
  ]);
});

test("an argument that is an instance of a class is handed to the body as the struct: neither kept nor answered", async () => {
  expect(
    await usesOfArguments(`
      plus: { args: { other: b.self }, returns: b.i32 },
      merge: { args: { other: b.self.nullable }, returns: b.self, capability: "heap" },
      watch: { args: { other: Other }, returns: b.any, capability: "js", throws: true },
    `),
  ).toEqual({
    "%Thing%.prototype.plus": { other: ["ReadsContents", "WritesContents"] },
    "%Thing%.prototype.merge": { other: ["ReadsContents", "WritesContents", "RetainsContents"] },
    "%Thing%.prototype.watch": { other: ["Everything"] },
  });
});

test("one that runs JavaScript keeps its receiver whether or not it is passed its wrapper", async () => {
  expect(
    await usesOfReceivers(`
      run: { args: { callback: b.any }, returns: b.any.returning("undefined"), capability: "js", throws: true },
      runAll: { args: { callback: b.any }, returns: b.any, capability: "js", throws: true },
      on: { args: { handlers: b.any }, returns: b.this, passThis: true, capability: "js", throws: true },
    `),
  ).toEqual({
    "%Other%.prototype.@@toStringTag": [],
    "%Thing%.prototype.@@toStringTag": [],
    "%Thing%.prototype.run": ["Retains"],
    "%Thing%.prototype.runAll": ["Everything"],
    "%Thing%.prototype.on": ["Retains", "Returns"],
  });
});
