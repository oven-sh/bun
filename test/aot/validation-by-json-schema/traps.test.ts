// The traps of ./traps.ts, compiled: `validate<Schema.FromJSONSchema<typeof schema>>(value)` and `JSON.parse<..>(text)` answer as the table says,
// or the build refuses the schema and names the keyword.
import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { test } from "../supported";
import { type Group, compileAndRun, judge, refusalsOf, summaryOf } from "./compiled-groups";
import { traps, trapsWithDocuments, valuesThatNoTextSpells } from "./traps";

const groups = [
  ...traps.map(([name, schema, cases, may]): Group => ({
    name,
    schema,
    draft: "2020-12",
    may,
    cases: Object.entries(cases).map(([text, expected]) => ({ description: text, text, expected })),
  })),
  ...trapsWithDocuments.map(([name, schema, documents, cases]): Group => ({
    name,
    schema,
    draft: "2020-12",
    documents,
    cases: Object.entries(cases).map(([text, expected]) => ({ description: text, text, expected })),
  })),
];
const groupsOfValues = valuesThatNoTextSpells.map(([name, schema, values]): Group => ({
  name,
  schema,
  draft: "2020-12",
  cases: [],
  values: Object.entries(values).map(([source, expected]) => ({ description: source, source, expected })),
}));
const mustBeRefused = (group: Group) => refusalsOf(group).must.size > 0;

test(
  "the traps that have a translation",
  async () => {
    const outcomes = await compileAndRun(
      "traps",
      groups.filter(group => !mustBeRefused(group)),
    );
    console.log(summaryOf("traps", outcomes));
    expect(judge(outcomes)).toEqual([]);
  },
  isASAN || isDebug ? 900_000 : 300_000,
);

test(
  "the traps that have none are build errors",
  async () => {
    const refused = groups.filter(mustBeRefused);
    expect(refused.map(group => group.name)).toEqual([
      "nullable beside type",
      "nullable beside type and enum",
      "nullable without type",
      "$ref beside siblings, draft-07",
      "$ref beside siblings, 2019-09",
      "unevaluatedItems sees prefixItems, contains",
      "unevaluatedProperties: a failed branch marks nothing",
      "then without if",
      "$id does not count inside enum | const",
      "$anchor in another resource is not seen",
      "a misspelled keyword in another document",
      "another document of a draft that is refused",
      "a keyword that is refused, elsewhere in another document",
    ]);
    expect(judge(await compileAndRun("traps-refused", refused))).toEqual([]);
  },
  isASAN || isDebug ? 900_000 : 300_000,
);

test(
  "values that no text spells",
  async () => {
    expect(groupsOfValues.filter(mustBeRefused).map(group => group.name)).toEqual([]);
    const outcomes = await compileAndRun("traps-by-value", groupsOfValues);
    console.log(summaryOf("traps by value", outcomes));
    expect(judge(outcomes)).toEqual([]);
  },
  isASAN || isDebug ? 900_000 : 300_000,
);
