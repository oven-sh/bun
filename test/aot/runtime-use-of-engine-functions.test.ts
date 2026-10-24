import { describe, expect } from "bun:test";
import { closed, completeness, notYet, retainsFeature } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";
import { eachRow, gap } from "./supported";

const numberFormatting = ["IntlNumberFormat", "IntlUnits"];
const namedByNoProgramHere = [
  "IntlCollation",
  "IntlSegmenter",
  "IntlDisplayNames",
  "IntlOther",
  "Temporal",
  "StringLocaleCase",
  "StringNormalize",
  "StringHTML",
  "ShadowRealm",
];

async function retained(text: string, features: string[]) {
  const use = await of(text + "\nexport {};");
  expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...closed, exitCode: 0 });
  return features.filter(feature => retainsFeature(use.lines, feature));
}

describe.concurrent("the engine's own JavaScript reads its arrays by index", () => {
  eachRow([
    ["using", `{ using held = { [Symbol.dispose]() { console.log("disposed"); } }; console.log("inside"); }`],
    [
      "await using",
      `{ await using held = { async [Symbol.asyncDispose]() { console.log("disposed"); } }; console.log("inside"); }`,
    ],
    gap(notYet.everyBuiltin, [
      "await using of what has only a synchronous method",
      `{ await using held = { [Symbol.dispose]() { console.log("disposed"); } }; console.log("inside"); }`,
    ]),
    gap(notYet.everyBuiltin, [
      "DisposableStack",
      `const stack = new DisposableStack(); stack.use({ [Symbol.dispose]() { console.log("used"); } }); stack.adopt(1, n => console.log("adopted", n)); stack.defer(() => console.log("deferred")); stack.move().dispose();`,
    ]),
    gap(notYet.everyBuiltin, [
      "AsyncDisposableStack",
      `const stack = new AsyncDisposableStack(); stack.use({ async [Symbol.asyncDispose]() { console.log("used"); } }); stack.adopt(1, async n => console.log("adopted", n)); stack.defer(async () => console.log("deferred")); await stack.move().disposeAsync();`,
    ]),
    [
      "a dispose method found by its symbol on an unknown value",
      `const value: any = JSON.parse(process.argv[2]); value[Symbol.dispose]();`,
    ],
    ["at on a typed array", `console.log(new Uint8Array([1, 2, 3]).at(-1));`],
    ["at on an unknown value", `const value: any = JSON.parse(process.argv[2]); console.log(value.at(-1));`],
  ])("%s uses no member of a built-in prototype that the program does not name", async (_, text) => {
    expect(
      await retained(text, [
        ...numberFormatting,
        ...namedByNoProgramHere,
        "IntlDateTimeFormat",
        "ElementsToLocaleString",
      ]),
    ).toEqual([]);
  });

  eachRow([
    ["numbers", `console.log(new Float64Array([1234.5, 0.25]).toLocaleString("de"));`],
    ["BigInts", `console.log(new BigInt64Array([1234n]).toLocaleString("de"));`],
  ])("toLocaleString on a typed array of %s formats numbers and nothing else", async (_, text) => {
    expect(await retained(text, [...numberFormatting, ...namedByNoProgramHere])).toEqual(numberFormatting);
  });
});
