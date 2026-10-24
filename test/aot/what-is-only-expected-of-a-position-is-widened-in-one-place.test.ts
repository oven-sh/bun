// `anything` is every value of the language. It is not everything that a location can hold: a binding in its dead zone holds
// `absent`, and a type that is widened to `anything` has lost that. TypeTable::provenTypeOf() says what is proven of a
// position whose type is only expected, and keeps `absent`. Goes by the text of the engine's sources: the same question
// answered on the spot, on one line or over several.
import { expect, test } from "bun:test";
import { filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/what-is-only-expected-of-a-position-is-widened-in-one-place.test.ts");

test.skipIf(!sources)("no place but the table of types widens an expected type to `anything`", () => {
  const found: string[] = [];
  for (const { name, text } of filesOfCompiler())
    for (const _ of text.matchAll(/\bIsExpected\s*\)+\s*(?:\?|return)\s*(?:TypeTable::anything|Type::anything\(\))/g))
      found.push(name);
  expect(found).toEqual([]);
});
