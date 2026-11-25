// A small view keeps its bytes in memory of the collector. An argument that is `held: "pinned"` gets a buffer, and the bytes move there, so a compiled
// loop that has read their place in front of the call may not go on storing through it. The row that is made off the binding has to say so.
import { expect, test } from "bun:test";
import type { FunctionDefinition } from "../../../src/codegen/bindgen-lib-internal.ts";
import * as b from "../../../src/codegen/bindgen-lib.ts";
import { declareFunction } from "../../../src/codegen/builtins/collect-bindgen.ts";

function writesOf(fn: FunctionDefinition): (readonly string[] | undefined)[] {
  fn.name = "f";
  fn.origin = { stem: "x", namespace: "X", rustModule: "x", crate: "bun_runtime" };
  const [member] = declareFunction(fn, "Bun.f").filter(declaration => declaration.declares === "Member");
  return member.signatures.map(({ writes }) => writes);
}

const bytes = (held: "borrowed" | "copied" | "pinned") => b.bytes({ from: ["string", "buffer"], held });

test.each(["heap", "js"] as const)(
  "a function of capability %s that pins an argument writes the storage of views",
  capability => {
    for (const writes of writesOf(
      b.fn({ args: { data: bytes("pinned") }, returns: b.any, capability, throws: true }),
    )) {
      expect(writes).toContain("TypedArrayStorage");
    }
  },
);

test("one that says what it writes is told so too", () => {
  const fn = b.fn({
    args: { data: bytes("pinned") },
    returns: b.any,
    capability: "heap",
    throws: true,
    writes: ["ExternalState"],
  });
  expect(writesOf(fn)).toEqual([["ExternalState", "TypedArrayStorage"]]);
});

test.each(["borrowed", "copied"] as const)("one whose argument is %s does not", held => {
  for (const writes of writesOf(
    b.fn({ args: { data: bytes(held) }, returns: b.any, capability: "heap", throws: true }),
  )) {
    expect(writes).not.toContain("TypedArrayStorage");
  }
});
