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
    "%Thing%.prototype.ref": ["Retains", "Returns"],
    "%Thing%.prototype.remove": ["Retains", "Returns"],
    "%Thing%.prototype.append": ["Retains", "Returns"],
    "%Thing%.prototype.on": ["Retains", "Returns"],
    "%Thing%.prototype.unref": ["Retains", "Returns"],
    "%Thing%.prototype.anyObject": ["Retains", "Returns"],
  });
});

test("one that is not passed its wrapper, or answers nothing that its receiver can be, does not", async () => {
  expect(
    await usesOfReceivers(`
      copy: { returns: b.self, capability: "heap" },
      size: { returns: b.f64, passThis: true },
      other: { returns: Other, passThis: true, capability: "heap" },
      later: { returns: b.any.returning("Promise"), passThis: true, capability: "heap" },
    `),
  ).toEqual({
    "%Thing%.prototype.copy": ["Retains"],
    "%Thing%.prototype.size": ["Retains"],
    "%Thing%.prototype.other": ["Retains"],
    "%Thing%.prototype.later": ["Retains"],
  });
});
