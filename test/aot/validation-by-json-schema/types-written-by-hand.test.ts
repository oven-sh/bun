// Types that a program writes with the aliases of `Schema`, each in a module of its own: `validate<T>(value)` and `JSON.parse<T>(text)` answer as the table says.
// Where `may` stands the build may refuse the type instead, if the error names one of them. A rule is kept or it is a build error. It is never dropped.
import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { test } from "../supported";
import { type Expected, type Group, compileAndRun, judge, summaryOf } from "./compiled-groups";

interface Written {
  name: string;
  type: string;
  declarations?: string;
  may?: string[];
  cases: Record<string, Expected>;
  values?: Record<string, Expected>;
}

const twiceByAlias: Written[] = [
  { name: "Not", type: "number & Schema.Not<1> & Schema.Not<2>", cases: { "1": false, "2": false, "3": true } },
  {
    name: "Contains",
    type: "unknown[] & Schema.Contains<number> & Schema.Contains<string>",
    cases: { "[1]": false, '["a"]': false, '[1,"a"]': true },
  },
  {
    name: "If",
    type: "number & Schema.If<number & Schema.Min<10>, number & Schema.Int> & Schema.If<number & Schema.Max<0>, number & Schema.MultipleOf<2>>",
    cases: { "10.5": false, "11": true, "-1": false, "-2": true, "5.5": true },
  },
  {
    name: "OneOf",
    type: "number & Schema.OneOf<[number & Schema.Int, number & Schema.Min<2>]> & Schema.OneOf<[number & Schema.Max<0>, number & Schema.Max<5>]>",
    cases: { "1": true, "3": false, "-1": false, "2.5": true, "6": false },
  },
  {
    name: "AllOf",
    type: "number & Schema.AllOf<[number & Schema.Min<0>]> & Schema.AllOf<[number & Schema.Max<5>]>",
    cases: { "-1": false, "6": false, "3": true },
  },
  {
    name: "PatternProperties",
    type: '{ z?: unknown } & Schema.PatternProperties<{ "^a": number }> & Schema.PatternProperties<{ "b$": string }>',
    cases: {
      '{"a1":"s"}': false,
      '{"1b":1}': false,
      '{"a1":1,"1b":"s"}': true,
      '{"ab":1}': false,
      '{"ab":"s"}': false,
    },
  },
  {
    name: "PropertyNames",
    type: "Record<string, unknown> & Schema.PropertyNames<string & Schema.MinLength<2>> & Schema.PropertyNames<string & Schema.MaxLength<3>>",
    cases: { '{"a":1}': false, '{"abcd":1}': false, '{"ab":1}': true },
  },
  {
    name: "MinProperties",
    type: "Record<string, unknown> & Schema.MinProperties<1> & Schema.MinProperties<3>",
    cases: { '{"a":1}': false, '{"a":1,"b":1}': false, '{"a":1,"b":1,"c":1}': true },
  },
  {
    name: "MinProperties",
    type: "Record<string, unknown> & Schema.MinProperties<3> & Schema.MinProperties<1>",
    cases: { '{"a":1}': false, '{"a":1,"b":1,"c":1}': true },
  },
  {
    name: "MaxProperties",
    type: "Record<string, unknown> & Schema.MaxProperties<3> & Schema.MaxProperties<1>",
    cases: { '{"a":1,"b":1}': false, '{"a":1}': true },
  },
  {
    name: "MaxProperties",
    type: "Record<string, unknown> & Schema.MaxProperties<1> & Schema.MaxProperties<3>",
    cases: { '{"a":1,"b":1}': false, '{"a":1}': true },
  },
  {
    name: "DependentRequired",
    type: 'Record<string, unknown> & Schema.DependentRequired<{ a: ["b"] }> & Schema.DependentRequired<{ a: ["c"]; d: ["e"] }>',
    cases: { '{"a":1,"b":1}': false, '{"a":1,"c":1}': false, '{"a":1,"b":1,"c":1}': true, '{"d":1}': false },
  },
  {
    name: "DependentSchemas",
    type: "Record<string, unknown> & Schema.DependentSchemas<{ a: { b: number } }> & Schema.DependentSchemas<{ a: { c: number } }>",
    cases: { '{"a":1,"b":1}': false, '{"a":1,"c":1}': false, '{"a":1,"b":1,"c":1}': true },
  },
  {
    name: "Pattern",
    type: 'string & Schema.Pattern<"^a"> & Schema.Pattern<"b$">',
    cases: { '"a"': false, '"b"': false, '"ab"': true },
  },
  {
    name: "Pattern",
    type: 'string & Schema.Pattern<"^.$"> & Schema.Pattern<"^.$", "u">',
    cases: { '"💩"': false, '"a"': true, '"ab"': false },
  },
  {
    name: "Format",
    type: 'string & Schema.Format<"uri-reference"> & Schema.Format<"json-pointer">',
    cases: { '"a"': false, '"/a b"': false, '"/a"': true },
  },
  {
    name: "MultipleOf",
    type: "number & Schema.MultipleOf<2> & Schema.MultipleOf<3>",
    cases: { "2": false, "3": false, "6": true },
  },
  { name: "Min", type: "number & Schema.Min<1> & Schema.Min<3>", cases: { "2": false, "3": true } },
  { name: "Min", type: "number & Schema.Min<3> & Schema.Min<1>", cases: { "2": false, "3": true } },
  { name: "Max", type: "number & Schema.Max<3> & Schema.Max<1>", cases: { "2": false, "1": true } },
  {
    name: "MinLength",
    type: "string & Schema.MinLength<1> & Schema.MinLength<3>",
    cases: { '"ab"': false, '"abc"': true },
  },
  {
    name: "MaxItems",
    type: "unknown[] & Schema.MaxItems<3> & Schema.MaxItems<1>",
    cases: { "[1,2]": false, "[1]": true },
  },
];
const twice = twiceByAlias.map((row): Written => ({
  ...row,
  name: "two of " + row.name + ": " + row.type,
  may: [row.name],
}));

const open = "{ a?: number; b?: number }";

const written: Written[] = [
  ...twice,

  // Strict and DeepStrict alone are the object without members that takes no other.
  ...["Schema.Strict", "Schema.DeepStrict", "{} & Schema.Strict", "{} & Schema.DeepStrict"].map((type): Written => ({
    name: type,
    type,
    cases: {
      "{}": true,
      '{"isAdmin":true}': false,
      '{"__proto__":1}': false,
      "42": false,
      "null": false,
      '"x"': false,
      "[1]": false,
      "[]": false,
    },
  })),
  {
    name: "a member that is closed and has no members",
    type: "{ meta: {} & Schema.Strict }",
    cases: {
      '{"meta":{}}': true,
      '{"meta":{"isAdmin":true}}': false,
      '{"meta":7}': false,
      '{"meta":null}': false,
      '{"meta":[1]}': false,
    },
  },
  {
    name: "closed, without members, with patterns",
    type: '{} & Schema.Strict & Schema.PatternProperties<{ "^x-": string }>',
    cases: { "{}": true, '{"x-a":"b"}': true, '{"role":"admin"}': false, '{"x-a":1}': false, "42": false },
  },

  // Another key that begins with "bun." is an ordinary member, and an ordinary brand says nothing.
  {
    name: "a member named bun.lock",
    type: '{ "bun.lock"?: number }',
    cases: { '{"bun.lock":1}': true, '{"bun.lock":"s"}': false, "{}": true },
  },
  {
    name: "a text with a brand named bun.other",
    type: 'string & { readonly "bun.other"?: 1 }',
    cases: { '"a"': true, "1": false },
  },
  { name: "a text with a brand", type: 'string & { __brand: "id" }', cases: { '"a"': true, "1": false } },
  {
    name: "members named bun.lock and bun.future",
    type: '{ "bun.lock": string; readonly "bun.future"?: true }',
    cases: {
      '{"bun.lock":"x"}': true,
      '{"bun.lock":"x","bun.future":true}': true,
      '{"bun.lock":1}': false,
      '{"bun.lock":"x","bun.future":false}': false,
    },
  },

  // null stands outside of the intersection with a rule, or inside a member.
  {
    name: "a rule on one arm, and null",
    type: "(string & Schema.MinLength<1>) | null",
    cases: { "null": true, '"a"': true, '""': false },
  },
  {
    name: "a closed object with a member that may be null",
    type: "{ a: string | null } & Schema.Strict",
    cases: { '{"a":null}': true, '{"a":null,"b":1}': false },
  },

  // DeepStrict on a list closes its elements. Strict on a dictionary has nothing to add.
  {
    name: "DeepStrict on a tuple",
    type: "[{ a: 1 }] & Schema.DeepStrict",
    cases: { '[{"a":1}]': true, '[{"a":1,"b":2}]': false, "[]": false, '[{"a":1},{"a":1}]': false },
  },
  {
    name: "DeepStrict on an array",
    type: "{ a: number }[] & Schema.DeepStrict",
    cases: { '[{"a":1}]': true, '[{"a":1,"b":2}]': false },
  },
  {
    name: "Strict on a dictionary",
    type: "Record<string, number> & Schema.Strict",
    cases: { '{"a":1}': true, '{"a":"x"}': false },
  },

  // A pattern carries its flag. Without one a search goes by UTF-16 units, with "u" by code points.
  {
    name: "a pattern without a flag: .",
    type: 'string & Schema.Pattern<"^.$">',
    cases: { '"a"': true, '"💩"': false, '"ab"': false },
  },
  { name: 'a pattern with "": .', type: 'string & Schema.Pattern<"^.$", "">', cases: { '"a"': true, '"💩"': false } },
  {
    name: 'a pattern with "u": .',
    type: 'string & Schema.Pattern<"^.$", "u">',
    cases: { '"a"': true, '"💩"': true, '"ab"': false, '"💩💩"': false },
  },
  {
    name: "a pattern without a flag: a negated class",
    type: 'string & Schema.Pattern<"^[^@]+$">',
    cases: { '"a💩"': true, '"a@"': false, '""': false },
  },
  {
    name: "a pattern without a flag: \\-",
    type: 'string & Schema.Pattern<"^\\\\-$">',
    cases: { '"-"': true, '"a"': false },
  },
  {
    name: "a pattern without a flag: \\p is the letter p",
    type: 'string & Schema.Pattern<"^\\\\p{2}$">',
    cases: { '"pp"': true, '"é"': false },
  },
  {
    name: 'a pattern with "u": \\p{L}',
    type: 'string & Schema.Pattern<"^\\\\p{L}+$", "u">',
    cases: { '"é"': true, '"p{L}"': false },
  },
  {
    name: "a pattern without a flag: a look-around stands between units",
    type: 'string & Schema.Pattern<"(?<!a)(?!a)">',
    cases: { '"a💩a"': true, '"a"': false },
  },
  {
    name: 'a pattern with "u": a look-around stands between code points',
    type: 'string & Schema.Pattern<"(?<!a)(?!a)", "u">',
    cases: { '"a💩a"': false, '"b"': true },
  },
  {
    name: 'a pattern with "u" in a member',
    type: '{ a: string & Schema.Pattern<"^.$", "u">; b: string & Schema.Pattern<"^.$"> }',
    cases: { '{"a":"💩","b":"b"}': true, '{"a":"💩","b":"💩"}': false, '{"a":"ab","b":"b"}': false },
  },
  {
    name: 'a pattern with "u" under Not',
    type: 'string & Schema.Not<string & Schema.Pattern<"^.$", "u">>',
    cases: { '"💩"': false, '"a"': false, '"ab"': true },
  },
  {
    name: "a pattern without a flag under Not",
    type: 'string & Schema.Not<string & Schema.Pattern<"^.$">>',
    cases: { '"💩"': true, '"a"': false },
  },
  {
    name: "the keys of PatternProperties go by code points",
    type: '{ a?: unknown } & Schema.PatternProperties<{ "^.$": never }>',
    cases: { '{"💩":1}': false, '{"b":1}': false, '{"ab":1}': true },
  },
  {
    name: "names by a pattern without a flag",
    type: 'Record<string, unknown> & Schema.PropertyNames<string & Schema.Pattern<"^.$">>',
    cases: { '{"a":1}': true, '{"💩":1}': false },
  },
  {
    name: 'names by a pattern with "u"',
    type: 'Record<string, unknown> & Schema.PropertyNames<string & Schema.Pattern<"^.$", "u">>',
    cases: { '{"a":1}': true, '{"💩":1}': true, '{"ab":1}': false },
  },

  // The second argument of PatternProperties is the type of the keys that neither a member nor a pattern names.
  {
    name: "the other keys: never",
    type: '{ a: number } & Schema.PatternProperties<{ "^x-": string }, never>',
    cases: {
      '{"a":1}': true,
      '{"a":1,"x-c":"d"}': true,
      '{"a":1,"b":2}': false,
      '{"a":1,"x-c":3}': false,
      "{}": false,
    },
  },
  {
    name: "the other keys: boolean",
    type: '{ a: number } & Schema.PatternProperties<{ "^x-": string }, boolean>',
    cases: {
      '{"a":1,"b":true}': true,
      '{"a":1,"x-c":"d"}': true,
      '{"a":1,"b":2}': false,
      '{"a":1,"x-c":true}': false,
      '{"a":true}': false,
    },
  },
  ...[
    '{ a: boolean } & Schema.PatternProperties<{ "^x-": string }, number> & Schema.Strict',
    '{ a: boolean } & Schema.Strict & Schema.PatternProperties<{ "^x-": string }, number>',
  ].map((type): Written => ({
    name: type,
    type,
    cases: { '{"a":true,"x-b":"c"}': true, '{"a":true,"b":1}': false, '{"a":true,"x-b":1}': false },
  })),
  {
    name: "the other keys: number, and no pattern",
    type: "{ a: boolean } & Schema.PatternProperties<{}, number>",
    cases: { '{"a":true,"b":1}': true, '{"a":true,"b":"x"}': false },
  },
  {
    name: "the other keys: unknown",
    type: '{ a: number } & Schema.PatternProperties<{ "^x-": string }>',
    cases: { '{"a":1,"b":2}': true, '{"a":1,"x-c":3}': false },
  },
  {
    name: "the other keys: an object type",
    type: '{ a?: number } & Schema.PatternProperties<{ "^x-": string }, { b: number }>',
    cases: {
      '{"c":{"b":1}}': true,
      '{"c":{"b":"s"}}': false,
      '{"c":1}': false,
      '{"__proto__":{"b":1}}': true,
      '{"__proto__":{}}': false,
    },
  },

  // DeepStrict closes what is a part of the value: members, elements, what a pattern names. A type that only tests the value stays as it is written.
  {
    name: "DeepStrict reaches what a pattern names",
    type: '{ id: number } & Schema.DeepStrict & Schema.PatternProperties<{ "^x-": { a: number } }>',
    cases: { '{"id":1,"x-a":{"a":1}}': true, '{"id":1,"x-a":{"a":1,"isAdmin":true}}': false, '{"id":1,"y":1}': false },
  },
  {
    name: "Strict does not reach what a pattern names",
    type: '{ id: number } & Schema.Strict & Schema.PatternProperties<{ "^x-": { a: number } }>',
    cases: { '{"id":1,"x-a":{"a":1,"isAdmin":true}}': true, '{"id":1,"y":1}': false },
  },
  {
    name: "DeepStrict beside Not of a member",
    type: "{ a: number; b?: number } & Schema.DeepStrict & Schema.Not<{ b: number }>",
    cases: { '{"a":1,"b":2}': false, '{"a":1}': true },
  },
  {
    name: "DeepStrict on an array beside Contains",
    type: "{ a: number }[] & Schema.DeepStrict & Schema.Contains<{ a: 1 }>",
    cases: { '[{"a":1}]': true, '[{"a":2}]': false },
  },
  {
    name: "DeepStrict does not reach Not",
    type: `${open} & Schema.Not<{ a: 1 }> & Schema.DeepStrict`,
    cases: { '{"a":1,"b":2}': false, '{"a":1}': false, '{"a":2,"b":2}': true, '{"a":2,"c":1}': false },
  },
  {
    name: "DeepStrict does not reach the condition of If",
    type: `${open} & Schema.If<{ a: 1 }, never> & Schema.DeepStrict`,
    cases: { '{"a":1,"b":2}': false, '{"a":2,"b":2}': true },
  },
  {
    name: "DeepStrict does not reach OneOf",
    type: `${open} & Schema.OneOf<[{ a: 1 }, unknown]> & Schema.DeepStrict`,
    cases: { '{"a":1,"b":2}': false, '{"a":2,"b":2}': true },
  },
  {
    name: "DeepStrict does not reach AllOf",
    type: `${open} & Schema.AllOf<[{ a: 1 }]> & Schema.DeepStrict`,
    cases: { '{"a":1,"b":2}': true, '{"a":2,"b":2}': false },
  },
  {
    name: "DeepStrict does not reach DependentSchemas",
    type: `${open} & Schema.DependentSchemas<{ a: { a: 1 } }> & Schema.DeepStrict`,
    cases: { '{"a":1,"b":2}': true, '{"a":2}': false },
  },
  {
    name: "DeepStrict does not reach Contains",
    type: `{ list: ${open}[] & Schema.Contains<{ a: 1 }, 0, 0> } & Schema.DeepStrict`,
    cases: { '{"list":[{"a":1,"b":2}]}': false, '{"list":[{"a":2,"b":2}]}': true, '{"list":[{"c":1}]}': false },
  },

  // A rule about the members is asked of the value as it was given, not of a result with defaults.
  {
    name: "a default does not count as a member",
    type: '{ a?: string & Schema.Default<"x"> } & Schema.MinProperties<1>',
    cases: { "{}": false },
  },
  {
    name: "a default is not a member that another one needs",
    type: '{ a?: string & Schema.Default<"x">; b?: number } & Schema.DependentRequired<{ b: ["a"] }>',
    cases: { '{"b":1}': false, '{"a":"y","b":1}': true },
  },
  {
    name: "a type that only a rule names",
    type: "{ s: string; l: number[] & Schema.Contains<1> }",
    cases: { '{"s":"","l":[2]}': false, '{"s":"","l":[2,1]}': true },
  },

  // Rules on a type that reaches itself, and on any object.
  {
    name: "UniqueItems in a type that reaches itself",
    type: "Tree",
    declarations: "interface Tree { kids: Tree[] & Schema.UniqueItems }",
    cases: {
      '{"kids":[]}': true,
      '{"kids":[{"kids":[]},{"kids":[]}]}': false,
      '{"kids":[{"kids":[]},{"kids":[{"kids":[]}]}]}': true,
      '{"kids":[{"kids":[{"kids":[]},{"kids":[]}]}]}': false,
    },
  },
  {
    name: "any object with a count",
    type: "object & Schema.MaxProperties<1>",
    cases: { "{}": true, '{"a":1}': true, '{"a":1,"b":1}': false, "1": false, "null": false },
  },
  {
    name: "any object or a text, with a count",
    type: "(object | string) & Schema.MaxProperties<1>",
    may: ["MaxProperties"],
    cases: { '{"a":1}': true, '{"a":1,"b":1}': false, "1": false },
  },
  {
    name: "any object with names",
    type: 'object & Schema.PropertyNames<"a">',
    cases: { '{"a":1}': true, '{"b":1}': false, "1": false },
  },
  {
    name: "any object that needs a member",
    type: 'object & Schema.DependentRequired<{ a: ["b"] }>',
    cases: { '{"a":1}': false, '{"a":1,"b":1}': true, "null": false },
  },

  // Contains: never in the place of the maximum, which is the default, says that there is none.
  {
    name: "Contains without a maximum",
    type: 'string[] & Schema.Contains<"a">',
    cases: { '["a","a","a"]': true, '["a"]': true, "[]": false, '["b"]': false },
  },
  {
    name: "Contains with never as the maximum",
    type: 'string[] & Schema.Contains<"a", 1, never>',
    cases: { '["a","a","a"]': true, "[]": false },
  },
  {
    name: "Contains with a maximum",
    type: 'string[] & Schema.Contains<"a", 1, 2>',
    cases: { '["a","a","a"]': false, '["a","a"]': true },
  },

  // A fraction as a divisor: both numbers are taken as the decimals that they are written as.
  {
    name: "MultipleOf<0.01>",
    type: "number & Schema.MultipleOf<0.01>",
    cases: { "0.07": true, "4.35": true, "19.99": true, "0": true, "-0.01": true, "0.075": false, "1e-9": false },
  },
  {
    name: "MultipleOf<0.01> under Not under Not",
    type: "number & Schema.Not<number & Schema.Not<number & Schema.MultipleOf<0.01>>>",
    cases: { "0.07": true, "19.99": true, "0.075": false },
  },
  {
    name: "MultipleOf<0.01> under Not",
    type: "number & Schema.Not<number & Schema.MultipleOf<0.01>>",
    cases: { "0.07": false, "19.99": false, "0.075": true },
  },
  {
    name: "MultipleOf<3>",
    type: "number & Schema.MultipleOf<3>",
    cases: { "1e17": false, "9": true, "-0": true, "3e15": true },
  },

  {
    name: "a divisor of seventeen digits",
    type: "number & Schema.MultipleOf<0.30000000000000004>",
    may: ["MultipleOf"],
    cases: { "0.3": "closed", "0.30000000000000004": "closed", "1": "closed" },
  },

  // An optional element is absent or it is of its type. undefined is neither.
  {
    name: "an optional element",
    type: "[number, string?]",
    cases: { "[1]": true, '[1,"a"]': true, "[1,null]": false, "[1,2]": false, "[]": false, '[1,"a",1]': false },
    values: { "[1, undefined]": false, "[1, ,]": false },
  },
  {
    name: "an only optional element",
    type: "[number?]",
    cases: { "[]": true, "[1]": true },
    values: { "[undefined]": false, "[,]": false },
  },
  {
    name: "an optional element and a rest",
    type: "[number, string?, ...boolean[]]",
    cases: { '[1,"a",true]': true },
    values: { '[1, "a", undefined]': false, "[1, , true]": false },
  },
  {
    name: "Not a tuple with an optional element",
    type: "unknown[] & Schema.Not<[number, string?]>",
    cases: { "[1]": false, '[1,"a"]': false, "[1,2]": true },
    values: { "[1, undefined]": false, "[1, ,]": false },
  },

  // Two elements are equal exactly if they are the same JSON value.
  {
    name: "UniqueItems",
    type: "unknown[] & Schema.UniqueItems",
    cases: {
      "[[1,2],[12]]": true,
      '[["1,2"],["1","2"]]': true,
      '[{"1:a":1},{"a":1}]': true,
      '["n",null]': true,
      '["d1",1]': true,
      "[[],{}]": true,
      '[{"":1},{}]': true,
      "[0,-0]": false,
      '[{"a":{"b":1},"c":2},{"c":2,"a":{"b":1}}]': false,
    },
    values: {
      "[1n, 1]": true,
      "[1n, 1n]": false,
      "[{ a: 1, b: undefined }, { a: 1 }]": false,
      "[() => 1, () => 2]": false,
      "[Symbol(), Symbol()]": false,
      "[{ a: () => 1 }, 1]": false,
    },
  },
  {
    name: "Not UniqueItems",
    type: "unknown[] & Schema.Not<unknown[] & Schema.UniqueItems>",
    cases: { "[1,1]": true, "[1,2]": false },
    values: { "[() => 1, () => 2]": false, "[Symbol(), Symbol()]": false, "[{ a: () => 1 }, 1]": false },
  },

  // A type that the checker cut short has no nodes of another type.
  {
    name: "a type beyond a limit of the checker",
    type: "Table",
    declarations:
      'type Wrap<N extends unknown[]> = N["length"] extends 150 ? string : [Wrap<[...N, 0]>][0];\ntype Table = { [K in "a"]: Wrap<[]> extends string ? 1 : 2 };',
    may: ["Table", "Wrap", "Accepted", "excessively deep"],
    cases: { '{"a":2}': false },
  },

  // What JSON cannot hold, where a type that only tests the value would turn its refusal round.
  {
    name: "unknown keeps what JSON cannot hold",
    type: "{ a: unknown }",
    cases: { '{"a":1e999}': true },
    values: { "({ a: Infinity })": true },
  },
  {
    name: "an arm that refuses what JSON cannot hold, beside an arm that is unknown",
    type: "{ a: number } | { a: unknown }",
    cases: { '{"a":1e999}': true, '{"a":"s"}': true },
    values: { "({ a: Infinity })": true },
  },
  {
    name: "what JSON cannot hold, in a member that is unknown, under Not",
    type: "{ a: unknown } & Schema.Not<{ a: string }>",
    cases: { '{"a":1}': true, '{"a":"x"}': false, '{"a":1e999}': false },
    values: { "({ a: Infinity })": false, "({ a: NaN })": false },
  },
  {
    name: "what JSON cannot hold, under Not",
    type: "{ a?: unknown } & Schema.Not<{ a: number }>",
    cases: { '{"a":1e999}': false, '{"a":1}': false, '{"a":"s"}': true },
    values: { "({ a: NaN })": false, "({ a: Infinity })": false },
  },
  {
    name: "what JSON cannot hold, at the root",
    type: "number & Schema.Not<1>",
    cases: { "1e999": false },
    values: {
      "NaN": false,
      "undefined": false,
      "10n": false,
      'Symbol("s")': false,
      "() => 1": false,
      "new Number(2)": false,
    },
  },
  {
    name: "what JSON cannot hold, where an object is described",
    type: "{ a?: number } & Schema.MaxProperties<1>",
    cases: {},
    values: {
      "undefined": false,
      "() => 1": false,
      "class {}": false,
      'Symbol("s")': false,
      "10n": false,
      "NaN": false,
    },
  },
];

test(
  "each answers as the table says, or the build refuses it",
  async () => {
    const groups = written.map(({ name, type, declarations, may, cases, values = {} }): Group => ({
      name,
      written: { type, declarations, may },
      draft: "2020-12",
      cases: Object.entries(cases).map(([text, expected]) => ({ description: text, text, expected })),
      values: Object.entries(values).map(([source, expected]) => ({ description: source, source, expected })),
    }));
    const outcomes = await compileAndRun("types-written-by-hand", groups);
    console.log(summaryOf("types written by hand", outcomes));
    expect(judge(outcomes)).toEqual([]);
  },
  isASAN || isDebug ? 1_800_000 : 600_000,
);
