// A schema or a type that says what the compiler cannot translate is a build error that names the keyword or the alias. Nothing is passed over,
// because a check that is left out accepts what the author meant to refuse.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { run } from "../harness/run";
import { test } from "../supported";
import { type Group, compileAndRun, judge, mentions, names } from "./compiled-groups";
import { brandKeys, testedAgainstItself, whatTheBuildRefuses } from "./what-the-build-refuses";

const draft07 = "http://json-schema.org/draft-07/schema#";

/** The error names the keyword, or one of them. */
const refused: [name: string, keyword: string | string[], schema: unknown][] = [
  ["a misspelled keyword", "requried", { type: "object", requried: ["a"] }],
  [
    "a misspelled keyword far inside",
    "minimun",
    { properties: { a: { items: { not: { anyOf: [{ minimun: 1 }] } } } } },
  ],
  ["a misspelled keyword behind $ref", "maxLenght", { $ref: "#/$defs/a", $defs: { a: { maxLenght: 1 } } }],
  ["a misspelled keyword under if", "typ", { if: { typ: "number" }, then: false }],
  ["a misspelled keyword under contains", "cosnt", { contains: { cosnt: 1 } }],
  ["a misspelled keyword under propertyNames", "patern", { propertyNames: { patern: "^a" } }],
  ["a misspelled keyword under patternProperties", "enmu", { patternProperties: { "^a": { enmu: [1] } } }],
  ["a misspelled keyword under dependentSchemas", "requires", { dependentSchemas: { a: { requires: ["b"] } } }],
  ["a misspelled keyword under prefixItems", "tpye", { prefixItems: [{ tpye: "number" }] }],

  ["dependencies in 2020-12", "dependencies", { dependencies: { a: ["b"] } }],
  ["a list as items in 2020-12", "items", { items: [{ type: "number" }] }],
  ["additionalItems in 2020-12", "additionalItems", { additionalItems: false }],
  ["prefixItems in draft-07", "prefixItems", { $schema: draft07, prefixItems: [{ type: "number" }] }],
  ["dependentRequired in draft-07", "dependentRequired", { $schema: draft07, dependentRequired: { a: ["b"] } }],
  ["dependentSchemas in draft-07", "dependentSchemas", { $schema: draft07, dependentSchemas: { a: false } }],
  ["minContains in draft-07", "minContains", { $schema: draft07, contains: {}, minContains: 2 }],
  ["maxContains in draft-07", "maxContains", { $schema: draft07, contains: {}, maxContains: 2 }],

  ["then without if", "then", { then: false }],
  ["else without if", "else", { else: false }],
  ["minContains without contains", "minContains", { minContains: 1 }],
  ["maxContains without contains", "maxContains", { maxContains: 1 }],
  [
    "additionalItems without a list of items",
    "additionalItems",
    { $schema: draft07, items: {}, additionalItems: false },
  ],
  ["nullable without type", "nullable", { nullable: true }],
  ["nullable beside type", "nullable", { type: "string", nullable: true }],
  ["nullable: false", "nullable", { type: "string", nullable: false }],
  [
    "a keyword beside $ref in draft-07",
    ["maxLength", "$ref"],
    {
      $schema: draft07,
      properties: { a: { $ref: "#/definitions/s", maxLength: 1 } },
      definitions: { s: { type: "string" } },
    },
  ],

  [
    "a misspelled keyword in a definition that nothing refers to",
    "tpye",
    { type: "number", $defs: { unused: { tpye: "number" } } },
  ],
  [
    "unevaluatedItems in a definition that nothing refers to",
    "unevaluatedItems",
    { type: "number", $defs: { unused: { unevaluatedItems: false } } },
  ],
  [
    "a misspelled keyword in a definition of draft-07 that nothing refers to",
    "tpye",
    { $schema: draft07, type: "number", definitions: { unused: { tpye: "number" } } },
  ],
  ["a misspelled keyword beside an arm that takes everything", "requried", { anyOf: [{}, { requried: ["a"] }] }],
  ["a misspelled keyword beside a part that takes nothing", "typ", { allOf: [false, { typ: "x" }] }],
  ["a misspelled keyword in a part, where only null is left", "bad", { type: "null", allOf: [{ bad: 1 }] }],
  ["three misspelled keywords", ["bad", "worse", "worst"], { bad: 1, worse: 2, properties: { a: { worst: 3 } } }],
  [
    "a misspelled keyword under not, where only null is left",
    "unknownKeyword",
    { type: "null", not: { unknownKeyword: 1 } },
  ],
  [
    "unevaluatedProperties under not, where only null is left",
    "unevaluatedProperties",
    { type: "null", not: { type: "null", unevaluatedProperties: false } },
  ],
  ["$anchor under not, beside const null", "$anchor", { const: null, not: { $anchor: "x" } }],
  [
    "unevaluatedItems under if, where only null is left",
    "unevaluatedItems",
    { type: "null", if: { unevaluatedItems: false }, then: false },
  ],
  [
    "$anchor in an arm of oneOf, where only null is left",
    "$anchor",
    { type: "null", oneOf: [{ type: "null" }, { type: "null", $anchor: "x" }] },
  ],
  ["$ref to nothing under not, beside enum of null", "$ref", { enum: [null], not: { $ref: "#/$defs/missing" } }],
  [
    "$dynamicRef under not in a member that is null",
    "$dynamicRef",
    { type: "object", properties: { deleted: { type: "null", not: { $dynamicRef: "#x" } } } },
  ],
  [
    "a misspelled keyword under a member that is false beside it",
    "minimun",
    { properties: { a: { allOf: [false, { minimun: 1 }] } } },
  ],
  [
    "unevaluatedProperties behind a $ref with ~1",
    "unevaluatedProperties",
    { $ref: "#/$defs/a~1b", $defs: { "a/b": { type: "object", unevaluatedProperties: false } } },
  ],
  [
    "unevaluatedProperties behind a $ref with %25",
    "unevaluatedProperties",
    { $ref: "#/$defs/a%25b", $defs: { "a%b": { type: "object", unevaluatedProperties: false } } },
  ],

  ["draft 2019-09", "$schema", { $schema: "https://json-schema.org/draft/2019-09/schema", type: "number" }],
  ["draft-04", "$schema", { $schema: "http://json-schema.org/draft-04/schema#", type: "number" }],
  ["draft-03", "$schema", { $schema: "http://json-schema.org/draft-03/schema#", type: "number" }],
  ["a dialect nobody knows", "$schema", { $schema: "http://x.test/dialect", type: "number" }],
  ["a dialect that is no string", "$schema", { $schema: 7, type: "number" }],
  [
    "a required vocabulary nobody knows",
    "$vocabulary",
    { $vocabulary: { "http://x.test/vocabulary": true }, type: "number" },
  ],

  ["format idn-email", "format", { format: "idn-email" }],
  ["format idn-hostname", "format", { format: "idn-hostname" }],
  ["format iri", "format", { format: "iri" }],
  ["format iri-reference", "format", { format: "iri-reference" }],
  ["format uri-template", "format", { format: "uri-template" }],
  ["a format nobody knows", "format", { type: "string", format: "e-mail" }],
  ["a format that is no string", "format", { format: 1 }],
  ["an $id that is no string", "$id", { $id: 1, type: "number" }],
  ["an $anchor that is no string", "$anchor", { $anchor: 1, type: "number" }],

  ["unevaluatedItems", "unevaluatedItems", { prefixItems: [{}], unevaluatedItems: false }],
  ["unevaluatedProperties", "unevaluatedProperties", { properties: { a: {} }, unevaluatedProperties: false }],
  ["$dynamicRef", "$dynamicRef", { $dynamicRef: "#a", $defs: { a: { $dynamicAnchor: "a" } } }],
  ["$dynamicAnchor", "$dynamicAnchor", { $dynamicAnchor: "a", type: "number" }],
  ["$anchor", "$anchor", { properties: { a: { $anchor: "a", type: "number" } } }],
  ["$id below the root", "$id", { properties: { a: { $id: "http://x.test/a", type: "number" } } }],
  ["$ref to nothing", "$ref", { $ref: "#/$defs/missing", $defs: {} }],
  ["$ref to a document that nobody handed over", "$ref", { $ref: "http://x.test/other.json" }],
  ["$ref to the meta-schema", "$ref", { $ref: "https://json-schema.org/draft/2020-12/schema" }],
  ["$ref that is no string", "$ref", { $ref: 1 }],
  ["$ref to an anchor", ["$ref", "$anchor"], { $ref: "#a", $defs: { a: { type: "number" } } }],
  [
    "$ref that ends on a method of a list",
    "$ref",
    { type: "object", properties: { a: { $ref: "#/allOf/concat" } }, allOf: [{}] },
  ],
  ["$ref that ends on the length of a list", "$ref", { properties: { a: { $ref: "#/allOf/length" } }, allOf: [{}] }],
  ["$ref that ends on a method of a string", "$ref", { title: "t", $ref: "#/title/trim" }],
  [
    "$ref that ends on a method of a boolean",
    "$ref",
    { uniqueItems: true, properties: { a: { $ref: "#/uniqueItems/valueOf" } } },
  ],
  ["$ref that ends on a name that every object inherits", "$ref", { $ref: "#/$defs/toString", $defs: {} }],
  ["$ref with an escape that is none", "$ref", { $ref: "#/$defs/a%zz", $defs: { "a%zz": {} } }],
  ["$ref to what is no schema", ["$defs", "schema"], { $ref: "#/$defs/a", $defs: { a: 1 } }],
  ["$ref to a place where no schema stands: an extension", "$ref", { $ref: "#/x-a", "x-a": { type: "string" } }],
  ["$ref to a place where no schema stands: default", "$ref", { $ref: "#/default", default: { type: "string" } }],
  ["$ref to a place where no schema stands: a table", "$ref", { $ref: "#/properties", properties: {} }],
  [
    "$ref to a place where no schema stands: a list of names",
    "$ref",
    { $schema: draft07, $ref: "#/dependencies/a", dependencies: { a: ["b"] } },
  ],
  ["definitions that are no table", "$defs", { $defs: 5 }],
  ["a misspelled keyword under contentSchema", "bad", { contentSchema: { bad: 1 } }],
  ["a definition with / and ~ in its name", "unevaluatedItems", { $defs: { "a/b~c": { unevaluatedItems: false } } }],
  ["no type at all", "type", { type: [] }],
  ["no type at all, under not", "type", { not: { type: [] } }],

  ["a pattern that the u flag does not take", ["pattern", "^\\-$"], { pattern: "^\\-$" }],
  ["a pattern that is no regular expression", ["pattern", "("], { pattern: "(" }],
  ["a pattern that is no regular expression, under not", ["pattern", "a{2,1}"], { not: { pattern: "a{2,1}" } }],
  ["a pattern that is no string", "pattern", { pattern: 1 }],
  [
    "patternProperties that the u flag does not take",
    ["patternProperties", "^\\-$"],
    { patternProperties: { "^\\-$": false } },
  ],
  [
    "patternProperties that is no regular expression",
    ["patternProperties", "["],
    { patternProperties: { "[": false } },
  ],
  [
    "patternProperties with an escape that the u flag does not take",
    ["patternProperties", "\\_"],
    { type: "object", patternProperties: { "\\_": { type: "string" } } },
  ],
  ["a pattern with an escape that the u flag does not take", ["pattern", "\\-"], { type: "string", pattern: "\\-" }],
  [
    "a pattern under propertyNames that is no regular expression",
    ["pattern", "("],
    { propertyNames: { pattern: "(" } },
  ],

  [
    "a member named as a rule is spelled in a type",
    "bun.strict",
    { properties: { "bun.strict": { type: "boolean" } } },
  ],
  ["a required member named as a rule is spelled in a type", "bun.not", { type: "object", required: ["bun.not"] }],
  [
    "a constant with a member named as a rule is spelled in a type",
    "bun.maxProperties",
    { const: { a: [{ "bun.maxProperties": 1 }] } },
  ],

  ["a type nobody knows", "type", { type: "strin" }],
  ["a type that is no string", "type", { type: 1 }],
  ["a minimum that is no number", "minimum", { minimum: "1" }],
  ["multipleOf 0", "multipleOf", { multipleOf: 0 }],
  ["multipleOf below 0", "multipleOf", { multipleOf: -1 }],
  ["a negative minLength", "minLength", { minLength: -1 }],
  ["a maxItems that is not whole", "maxItems", { maxItems: 1.5 }],
  ["a maxProperties that is no number", "maxProperties", { maxProperties: "1" }],
  ["a negative maxProperties", "maxProperties", { maxProperties: -1 }],
  ["a negative maxItems", "maxItems", { maxItems: -1 }],
  ["a negative maxLength", "maxLength", { maxLength: -1 }],
  ["a negative maxContains", "maxContains", { contains: {}, maxContains: -1 }],
  ["a negative minContains", "minContains", { contains: {}, minContains: -1 }],
  ["a minProperties that is not whole", "minProperties", { minProperties: 0.5 }],
  ["a maxLength that no double holds", "maxLength", { type: "string", maxLength: 1e400 }],
  ["a minItems that no double holds", "minItems", { minItems: 1e400 }],
  ["a maximum that no double holds", "maximum", { maximum: 1e400 }],
  ["a multipleOf that no double holds", "multipleOf", { multipleOf: 1e400 }],
  [
    "additionalProperties: null",
    ["additionalProperties", "schema"],
    { type: "object", properties: { a: { type: "string" } }, additionalProperties: null },
  ],
  ["null as a part of allOf", ["allOf", "schema"], { type: "null", allOf: [null] }],
  ["items: null", ["items", "schema"], { items: null }],
  ["a member whose schema is a number", ["properties", "schema"], { properties: { a: 1 } }],
  ["required that is no list", "required", { required: "a" }],
  ["an enum that is no list", "enum", { enum: 1 }],
  ["uniqueItems that is no boolean", "uniqueItems", { uniqueItems: "true" }],
  ["properties that is a list", "properties", { properties: [{ type: "number" }] }],
  ["allOf that is no list", "allOf", { allOf: { type: "number" } }],
  ["not that is no schema", ["not", "schema"], { not: 1 }],
  ["dependentRequired whose names are no list", "dependentRequired", { dependentRequired: { a: "b" } }],
  ["dependentRequired whose names are no strings", "dependentRequired", { dependentRequired: { a: [1] } }],
  ["required whose names are no strings", "required", { required: [1] }],
];

test("the table of ./what-the-build-refuses says the same", () => {
  for (const [name, keyword, schema] of refused) {
    const { must } = whatTheBuildRefuses(schema, "2020-12");
    expect([name, [keyword].flat().filter(one => must.has(one))]).toEqual([name, [keyword].flat()]);
  }
});

test(
  "each is a build error that names the keyword",
  async () => {
    const groups = refused.map(([name, , schema]): Group => ({ name, schema, draft: "2020-12", cases: [] }));
    const outcomes = await compileAndRun("refused-at-build-time", groups);
    const wrong = judge(outcomes);
    outcomes.forEach(({ refusedWith }, index) => {
      const [name, keyword] = refused[index];
      if (refusedWith === undefined || [keyword].flat().some(one => names(refusedWith, one))) return;
      wrong.push(`THE ERROR DOES NOT NAME ${keyword} | ${name} | ${refusedWith.slice(0, 300)}`);
    });
    expect(wrong).toEqual([]);
  },
  isASAN || isDebug ? 1_800_000 : 600_000,
);

const writable = "type Writable<T> = { -readonly [K in keyof T]: T[K] };";
const notANumber = "enum Bound { None = 0 / 0 }";
// The checker's own error about the next line is hidden, as it is in a dependency. The type then holds an error type.
const hidden = "// @ts-expect-error";
const widened = "const isOpen = Math.random() < 2;";

/** The error names the alias, the key of the rule, or what else stands here. */
const refusedTypes: [type: string, named: string | string[], declarations?: string][] = [
  // A rule with nothing beside it describes no value. `{} & Rule` and `unknown & Rule` are that rule alone.
  ["Schema.Int", "Int"],
  ["Schema.Min<1>", "Min"],
  ["Schema.Min<1> & Schema.Max<5>", ["Min", "Max"]],
  ["Schema.MultipleOf<2>", "MultipleOf"],
  ["Schema.MinLength<1>", "MinLength"],
  ['Schema.Pattern<"a">', "Pattern"],
  ['Schema.Format<"ipv4">', "Format"],
  ["Schema.MinItems<1>", "MinItems"],
  ["Schema.UniqueItems", "UniqueItems"],
  ["Schema.Contains<number>", "Contains"],
  ["Schema.Not<string>", "Not"],
  ["Schema.If<number, number & Schema.Min<10>, string>", "If"],
  ["Schema.OneOf<[number, number | string]>", "OneOf"],
  ["Schema.AllOf<[number]>", "AllOf"],
  ['Schema.PatternProperties<{ "^x": number }>', "PatternProperties"],
  ['Schema.PropertyNames<"a">', "PropertyNames"],
  ["Schema.MinProperties<1>", "MinProperties"],
  ["Schema.MaxProperties<0>", "MaxProperties"],
  ['Schema.DependentRequired<{ a: ["b"] }>', "DependentRequired"],
  ["Schema.DependentSchemas<{ a: never }>", "DependentSchemas"],
  ['Schema.Message<"m">', "Message"],
  ["Schema.Default<1>", "Default"],
  ["{} & Schema.MinProperties<1>", "MinProperties"],
  ['{} & Schema.PatternProperties<{ "^x": number }>', "PatternProperties"],
  ['unknown & Schema.Format<"date">', "Format"],
  ["unknown & Schema.Not<{ admin: true }>", "Not"],
  ["{ tags: {} & Schema.MinProperties<1> }", "MinProperties"],
  ["{ a: unknown & Schema.Not<{ admin: true }> }", "Not"],
  ["(unknown & Schema.UniqueItems)[]", "UniqueItems"],
  ["number & Schema.Not<Schema.Not<number>>", "Not"],
  ["number & Schema.AllOf<[Schema.Not<string>, Schema.Not<number>]>", "Not"],
  ["unknown[] & Schema.Contains<Schema.MinLength<1>>", "MinLength"],
  ["{ meta: Schema.MaxProperties<10> }", "MaxProperties"],
  ['string | Schema.PropertyNames<"a">', "PropertyNames"],
  ['Schema.Refused<"not at #/properties/a">', "not at #/properties/a"],
  ['Schema.Min<1> & Schema.Refused<"not at #/properties/a">', "not at #/properties/a"],

  // A type argument that the checker could not resolve.
  ["{ id: number; owner: Missing }", ["Missing", "owner", "Accepted"], hidden],
  ["Missing", ["Missing", "Accepted"], hidden],
  ["Missing[]", ["Missing", "Accepted"], hidden],
  ["string & Schema.Not<Missing>", ["Not", "Missing", "Accepted"], hidden],
  ["unknown[] & Schema.UniqueItem", ["UniqueItem", "Accepted"], hidden],
  ["unknown[] & Schema.Contains<Missing>", ["Contains", "Missing", "Accepted"], hidden],
  ["string & Schema.OneOf<[Missing, string]>", ["OneOf", "Missing", "Accepted"], hidden],
  ["string & Schema.If<Missing, never>", ["If", "Missing", "Accepted"], hidden],
  ["Record<string, unknown> & Schema.PropertyNames<Missing>", ["PropertyNames", "Missing", "Accepted"], hidden],
  [
    "Record<string, unknown> & Schema.DependentSchemas<{ a: Missing }>",
    ["DependentSchemas", "Missing", "Accepted"],
    hidden,
  ],
  ['{ a?: 1 } & Schema.PatternProperties<{ "^x": Missing }>', ["PatternProperties", "Missing", "Accepted"], hidden],

  // The key of a rule is a member only in the alias's own type.
  ...brandKeys.map((key): [string, string] => [`{ a?: number; ${JSON.stringify(key)}?: true }`, key]),
  ['{ "bun.not": [string] }', "bun.not"],
  ['{ readonly "bun.maxProperties"?: 1; a?: string }', "bun.maxProperties"],
  ["Writable<{ readonly id: number } & Schema.Strict>", "bun.strict", writable],
  ['Writable<{ readonly name: string } & Schema.Not<{ name: "root" }>>', "bun.not", writable],
  ["Required<{ a?: string } & Schema.MaxProperties<1>>", "bun.maxProperties"],
  ["string & Readonly<Schema.MinLength<8>>", "bun.minLength"],
  ['string & { readonly "bun.minLength"?: 8 }', "bun.minLength"],
  ["number & Partial<Schema.Min<0>>", "bun.min"],
  ["string & Required<Schema.MinLength<8>>", "bun.minLength"],
  ['string & Record<"bun.minLength", 8>', "bun.minLength"],
  ["string & Schema.MaxLength<9> & Readonly<Schema.MinLength<8>>", "bun.minLength"],
  ['number & { readonly "bun.int32"?: true }', "bun.int32"],
  ["WithRule", "bun.maxProperties", "interface WithRule extends Schema.MaxProperties<1> { a?: number }"],
  ["Closed", "bun.strict", "interface Closed extends Schema.Strict { id: number }"],
  ["Partial<{ a: string } & Schema.Strict>", "bun.strict"],
  ["Readonly<{ a: string } & Schema.Strict>", "bun.strict"],

  // An argument that says no rule.
  ["unknown[] & Schema.Contains<number, 1, number>", "Contains"],
  ["unknown[] & Schema.Contains<number, number>", "Contains"],
  ['string[] & Schema.Contains<"a", 1, typeof limits.most>', "Contains", "const limits = { most: 2 };"],
  ["unknown[] & Schema.Contains<number, 4294967296>", "Contains"],
  ["unknown[] & Schema.Contains<number, 0, -1>", "Contains"],
  ["unknown[] & Schema.Contains<number, 0, 1.5>", "Contains"],
  ["number & Schema.Min<Bound.None>", "Min", notANumber],
  ["number & Schema.Max<Bound.None>", "Max", notANumber],
  ["number & Schema.Above<Bound.None>", "Above", notANumber],
  ["number & Schema.Below<Bound.None>", "Below", notANumber],
  ["number & Schema.Not<number & Schema.Min<Bound.None>>", "Min", notANumber],
  ["number & Schema.Min<number>", "Min"],
  ["number & Schema.MultipleOf<0>", "MultipleOf"],
  ["number & Schema.MultipleOf<-1>", "MultipleOf"],
  ["number & Schema.MultipleOf<1e400>", "MultipleOf"],
  ["Record<string, unknown> & Schema.MinProperties<4294967297>", "MinProperties"],
  ["Record<string, unknown> & Schema.MaxProperties<4294967296>", "MaxProperties"],
  ["Record<string, unknown> & Schema.MaxProperties<-1>", "MaxProperties"],
  ["Record<string, unknown> & Schema.MinProperties<0.5>", "MinProperties"],
  ["unknown[] & Schema.MaxItems<-1>", "MaxItems"],
  ["unknown[] & Schema.MinItems<1.5>", "MinItems"],
  ["string & Schema.MaxLength<1e400>", "MaxLength"],
  ["string & Schema.MaxLength<number>", "MaxLength"],
  ["string & Schema.Pattern<string>", "Pattern"],
  ['string & Schema.Pattern<"a", "" | "u">', "Pattern"],
  ['string & Schema.Pattern<"a", Flags>', "Pattern", 'type Flags = "" | "u";'],
  ['string & Schema.Pattern<"a" | "b">', "Pattern"],
  ["number & Schema.AllOf<[]>", "AllOf"],
  ["number & Schema.OneOf<[]>", "OneOf"],
  ["number & Schema.OneOf<number[]>", "OneOf"],
  ["number & Schema.AllOf<[number, number?]>", "AllOf"],
  ["{ a?: 1 } & Schema.PatternProperties<Record<string, number>>", "PatternProperties"],
  ['{ a?: 1 } & Schema.PatternProperties<{ "^x"?: number }>', "PatternProperties"],
  ["Record<string, unknown> & Schema.DependentRequired<{ a: string[] }>", "DependentRequired"],
  ['Record<string, unknown> & Schema.DependentRequired<{ a?: ["b"] }>', "DependentRequired"],
  ["Record<string, unknown> & Schema.DependentSchemas<Record<string, never>>", "DependentSchemas"],

  // A rule beside null or undefined is gone before anybody sees it: `null & Rule` is never.
  ['(null | "") & Schema.Message<"must not be empty">', "Message"],
  ["(string | null) & Schema.MinLength<1>", "MinLength"],
  ["(string | undefined) & Schema.MinLength<1>", "MinLength"],
  ["{ a: (number | null) & Schema.Min<0> }", "Min"],
  ['string & Schema.Not<(null | "") & Schema.Message<"must not be empty">>', "Message"],
  ['string & Schema.If<null & Schema.Message<"m">, never, unknown>', "Message"],
  ['null & Schema.Message<"m">', "Message"],
  ["Maybe & Schema.MinLength<1>", "MinLength", "type Maybe = string | null;"],
  ["({ a: number } | null) & Schema.Strict", "Strict"],

  // Only an object has members that can be undeclared.
  ["string & Schema.Strict", "Strict"],
  ["number & Schema.DeepStrict", "DeepStrict"],
  ['"a" & Schema.Strict', "Strict"],
  ["boolean & Schema.Strict", "Strict"],
  ["object & Schema.Strict", "Strict"],
  ["object & Schema.DeepStrict", "DeepStrict"],
  ["{ meta: object & Schema.Strict }", "Strict"],
  ["unknown[] & Schema.Strict", "Strict"],
  ["[number] & Schema.Strict", "Strict"],
  ["1 & Schema.Strict", "Strict"],
  ['"x" & Schema.DeepStrict', "DeepStrict"],
  ["({ b: number } | string) & Schema.DeepStrict", "DeepStrict"],

  // The source of a regular expression, under the flag that it is compiled with. The keys of PatternProperties have the `u` flag.
  ['string & Schema.Pattern<"(">', ["Pattern", "("]],
  ['string & Schema.Pattern<"(", "u">', ["Pattern", "("]],
  ['string & Schema.Pattern<"\\\\-", "u">', ["Pattern", "\\-"]],
  ['string & Schema.Not<string & Schema.Pattern<"a{2,1}">>', ["Pattern", "a{2,1}"]],
  ['{ a?: 1 } & Schema.PatternProperties<{ "[": never }>', ["PatternProperties", "["]],
  ['{ a?: 1 } & Schema.PatternProperties<{ "\\\\-": never }>', ["PatternProperties", "\\-"]],
  ['{ a?: number } & Schema.PatternProperties<{ "\\\\_": string }>', ["PatternProperties", "\\_"]],

  // The index signature would promise its type for a key that a pattern gives another one.
  ['Record<string, string> & Schema.PatternProperties<{ "^n": number }>', "PatternProperties"],
  ['Record<string, number> & Schema.PatternProperties<{ "^x-": string }>', "PatternProperties"],
  ['Record<string, unknown> & Schema.PatternProperties<{ "^x": number }>', "PatternProperties"],
  ['{ a?: number; [key: string]: unknown } & Schema.PatternProperties<{ "^x": number }>', "PatternProperties"],
  ["Record<string, number> & Schema.PatternProperties<{}>", "PatternProperties"],

  // Only an object type with its own list of members can say which keys are left for the patterns, and it has one table of them.
  ['object & Schema.PatternProperties<{ "^x-": string }>', "PatternProperties"],
  ['string[] & Schema.PatternProperties<{ "^x-": string }>', "PatternProperties"],
  ['string & Schema.PatternProperties<{ "^x-": string }>', "PatternProperties"],
  ["{ a: 1 } & Schema.PatternProperties<{ x: 1 }> & Schema.PatternProperties<{ y: 2 }>", "PatternProperties"],
  ["{ a: 1 } & Schema.PatternProperties<{}, never> & Schema.PatternProperties<{ y: 2 }>", "PatternProperties"],

  // A type that asks itself about the same value has no answer.
  ["Loop", testedAgainstItself, "type Loop = { a?: 1 } & Schema.AllOf<[Loop]>;"],
  ["Loop", testedAgainstItself, "type Loop = { a?: 1 } & Schema.OneOf<[Loop, unknown]>;"],
  [
    "Loop",
    testedAgainstItself,
    "type Loop = { a?: 1 } & Schema.AllOf<[{ a?: 1 } & Schema.Not<Other>]>;\ntype Other = { a?: 1 } & Schema.AllOf<[Loop]>;",
  ],

  // A type that says more than its node could test.
  ["Uppercase<string>", "Uppercase"],
  ["Record<string, number> & Schema.PropertyNames<Uppercase<string>>", "Uppercase"],
  ["`id-${Lowercase<string>}`", "Lowercase"],
  ["{ a: 1 } & Schema.PatternProperties<{ x: Capitalize<string> }>", "Capitalize"],
  ["unknown[] & Schema.Contains<Uncapitalize<string>>", "Uncapitalize"],
  ["typeof globalThis", "globalThis"],
  ["typeof Color", "Color", "enum Color { Red }"],
  ["typeof Space", "Space", "namespace Space { export const a = 1; }"],

  // What was refused is named in front of everything else that is wrong.
  ['{ a: symbol & Schema.Refused<"$id"> }', "$id"],
  ['{ a: string & Schema.Min<1> & Schema.Refused<"$id"> }', "$id"],
  ['{ a: { b: 1 } & Schema.PatternProperties<{ x: 1 }, Schema.Refused<"$id">> }', "$id"],

  // A schema whose type is not that of its text.
  ["Schema.FromJSONSchema<typeof schema>", ["schema", "FromJSONSchema"], 'const schema: object = { type: "string" };'],
  ["Schema.FromJSONSchema<typeof schema>", ["type", "FromJSONSchema"], 'const schema = { type: "string" };'],
  [
    "Schema.FromJSONSchema<typeof schema>",
    ["additionalProperties", "schema", "FromJSONSchema"],
    `${widened} const note = { type: "string" } as const;\nconst schema = { type: "object", properties: { name: { type: "string" } }, additionalProperties: isOpen ? note : false } as const;`,
  ],
  [
    "Schema.FromJSONSchema<typeof schema>",
    ["patternProperties", "schema", "FromJSONSchema"],
    `${widened} const x = { "^x-": { type: "string" } } as const; const y = { "^y-": { type: "string" } } as const;\nconst schema = { type: "object", patternProperties: isOpen ? x : y } as const;`,
  ],
  [
    "Schema.FromJSONSchema<typeof schema>",
    ["items", "schema", "FromJSONSchema"],
    `${widened} const text = { type: "string" } as const;\nconst schema = { type: "array", prefixItems: [{ type: "string" }], items: isOpen ? text : false } as const;`,
  ],
];

test(
  "each type is a build error that names the alias",
  async () => {
    const groups = refusedTypes.map(([type, named, declarations]): Group => ({
      name: type,
      written: { type, declarations, must: [named].flat() },
      draft: "2020-12",
      cases: [],
    }));
    expect(judge(await compileAndRun("types-refused-at-build-time", groups))).toEqual([]);
  },
  isASAN || isDebug ? 1_800_000 : 600_000,
);

// In the TypeScript source of a dependency the checker's error about a type that is not found does not stop the build.
test(
  "a type that is not found, in a dependency",
  async () => {
    const types: [alias: string, type: string][] = [
      ["Not", "string & Schema.Not<Banned>"],
      ["If", "string & Schema.If<Banned>"],
      ["If", "string & Schema.If<string, Banned>"],
      ["Contains", "unknown[] & Schema.Contains<Banned>"],
      ["PropertyNames", "Record<string, unknown> & Schema.PropertyNames<Banned>"],
      ["OneOf", "string & Schema.OneOf<[Banned, string]>"],
      ["AllOf", "string & Schema.AllOf<[string, Banned]>"],
      ["PatternProperties", '{ b?: 1 } & Schema.PatternProperties<{ "^a": Banned }>'],
      ["PatternProperties", "{ b?: 1 } & Schema.PatternProperties<{}, Banned>"],
      ["DependentSchemas", "Record<string, unknown> & Schema.DependentSchemas<{ a: Banned }>"],
      ["owner", "{ id: number; owner: Banned }"],
    ];
    const files: Record<string, string> = {
      "node_modules/dependency/package.json": JSON.stringify({ name: "dependency", version: "1.0.0" }),
    };
    types.forEach(([, type], index) => {
      files[`main-${index}.ts`] =
        `import { check } from "dependency/check-${index}"; console.log(check(42), check(null), check({ a: 1 }));`;
      files[`node_modules/dependency/check-${index}.ts`] = [
        `import type { Schema } from "bun";`,
        `import { validate } from "bun:bundle";`,
        `import type { Banned } from "a-package-that-is-not-installed";`,
        `export const check = (value: unknown) => validate<${type}>(value);`,
      ].join("\n");
    });
    using dir = tempDir("a-type-that-is-not-found", files);
    for (const [index, [alias, type]] of types.entries()) {
      const { stdout, stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", "--aot", `./main-${index}.ts`, "--outfile", `./main-${index}`],
        String(dir),
      );
      expect([type, exitCode === 0, mentions(stdout + "\n" + stderr, alias)]).toEqual([type, false, true]);
    }
  },
  isASAN || isDebug ? 1_800_000 : 600_000,
);

test(
  "Schema.Refused<K> is a build error at the call",
  async () => {
    using dir = tempDir("schema-refused", {
      "by-value.ts": `import type { Schema } from "bun"; import { validate } from "bun:bundle"; console.log(validate<{ a: Schema.Refused<"someKeyword">[] }>({ a: [] }));`,
      "by-text.ts": `import { JSON, type Schema } from "bun"; console.log(JSON.parse<number | Schema.Refused<"someKeyword">>("1"));`,
      "under-not.ts": `import type { Schema } from "bun"; import { validate } from "bun:bundle"; console.log(validate<number & Schema.Not<Schema.Refused<"someKeyword">>>(1));`,
    });
    for (const name of ["by-value", "by-text", "under-not"]) {
      const { stdout, stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", "--aot", `./${name}.ts`, "--outfile", `./${name}`],
        String(dir),
      );
      expect([name, exitCode === 0, names(stdout + "\n" + stderr, "someKeyword")]).toEqual([name, false, true]);
    }
  },
  isASAN || isDebug ? 450_000 : 120_000,
);
