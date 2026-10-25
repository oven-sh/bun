// The classic traps of JSON Schema. Each case is a JSON text, as a network hands it over, and the answer.
// `"closed"` marks a case that has no answer, or whose answer may be out of reach: it is refused or the check throws, and it is never accepted.
import type { Expected } from "./compiled-groups";

const draft07 = "http://json-schema.org/draft-07/schema#";
const draft2019 = "https://json-schema.org/draft/2019-09/schema";
const draft2020 = "https://json-schema.org/draft/2020-12/schema";
const parsed = (text: string) => JSON.parse(text);
const textOf = (value: unknown) => JSON.stringify(value);
const awkwardTexts = ['"', "\\", " ", "*/", "${x}", "`", "\n", "'", "</script>", '");process.exit(0);("'];
const members = (count: number, without = -1) =>
  JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => ["p" + i, 1]).filter((_, i) => i !== without)));
const seventy = Array.from({ length: 70 }, (_, i) => i);
const byKey = <T>(valueOf: (i: number) => T, keyOf = (i: number) => "k" + i) => Object.fromEntries(seventy.map(i => [keyOf(i), valueOf(i)]));
const under = (levels: number, keyword: string, schema: unknown): unknown => (levels === 0 ? schema : { [keyword]: under(levels - 1, keyword, schema) });
/** What the type checker says of a type that it gives up on. */
const beyondTheChecker = ["excessively deep", "Excessive stack depth"];
const neverAccepted = { "{}": "closed", "1": "closed", "null": "closed", '"a"': "closed", "[]": "closed" } as const;

/** `may`: the build may refuse the schema for its size, if the error holds one of these names. */
/**
 * Keywords that turn the refusal of a schema round. `operand` refuses a value for what stands inside it. What stands there is no JSON value,
 * so the whole value is refused, whatever is made of the operand's answer. `holding` puts the value where the keyword asks about it.
 */
const turningRound: [name: string, schemaOf: (host: string, operand: object) => unknown, holding: (value: string) => string][] = [
  ["not", (host, operand) => ({ type: host, not: operand }), value => value],
  ["if", (host, operand) => ({ type: host, if: operand, then: false }), value => value],
  ["oneOf", (host, operand) => ({ type: host, oneOf: [operand, {}] }), value => value],
  ["contains", (host, operand) => ({ type: "array", contains: { type: host, ...operand }, minContains: 0, maxContains: 0 }), value => `[${value}]`],
  [
    "dependentSchemas",
    (host, operand) => ({ type: "object", dependentSchemas: { b: { not: { properties: { c: { type: host, ...operand } }, required: ["c"] } } } }),
    value => `{"b":1,"c":${value}}`,
  ],
];
const inside: [name: string, host: string, operand: object, around: (value: string) => string][] = [
  ["a member", "object", { properties: { a: { type: "string" } }, required: ["a"] }, value => `{"a":${value}}`],
  ["an element", "array", { items: { type: "string" } }, value => `[${value}]`],
];
const belowWhatTurnsRound = <T>(rowOf: (name: string, schema: unknown, textOf: (value: string) => string, isElement: boolean) => T): T[] =>
  turningRound.flatMap(([keyword, schemaOf, holding]) =>
    inside.map(([place, host, operand, around]) => rowOf(place + " below " + keyword, schemaOf(host, operand), value => holding(around(value)), host === "array")),
  );

export type Trap = [name: string, schema: unknown, cases: Record<string, Expected>, may?: string[]];

export const traps: Trap[] = [
  ["integer", { type: "integer" }, { "1": true, "1.0": true, "1e3": true, "1.5": false, "-0": true, "-0.0": true, "1e308": true, "9007199254740993": true, "1e-1": false, "10e-1": true, "0.1e1": true, "1e999": false, "-1e999": false, '"1"': false, "true": false, "null": false, "123456789012345678901234567890": true, "0.99999999999999999999": true }],
  ["number", { type: "number" }, { "1e999": false, "-1e999": false, "1": true, "1e-999": true }],
  ["multipleOf 0.01", { multipleOf: 0.01 }, { "0.07": true, "0.01": true, "0.075": false, "1.1": true, "4.35": true, "19.99": true, "0.29": true, "-0.07": true, "7": true, "1e999": false }],
  ["multipleOf 0.1", { multipleOf: 0.1 }, { "0.3": true, "0.7": true, "1.1": true, "0.35": false }],
  ["multipleOf 3 beyond 2^53", { multipleOf: 3 }, { "100000000000000000": false, "99999999999999999": false, "9007199254740993": false, "1e308": false, "9": true, "9.0": true, "1e999": false }],
  ["multipleOf 2 tiny", { multipleOf: 2 }, { "5e-324": false, "0": true, "1e-320": false }],
  ["const 1", { const: 1 }, { "1": true, "1.0": true, "1e0": true, "true": false, '"1"': false, "[1]": false }],
  ["const true", { const: true }, { "1": false, "true": true }],
  ["const false", { const: false }, { "0": false, "false": true, "null": false, '""': false }],
  ["const 0", { const: 0 }, { "-0": true, "0": true, "-0.0": true, "false": false, "null": false, '""': false, "[]": false }],
  ["const -0", { const: -0 }, { "0": true, "-0": true }],
  ["const null", { const: null }, { "null": true, "0": false, "false": false, '""': false, "1e999": false }],
  ["const object, key order", { const: { a: 1, b: [1, { c: null }] } }, { '{"b":[1,{"c":null}],"a":1}': true, '{"a":1,"b":[1,{"c":null}],"d":1}': false, '{"a":1}': false, '{"a":1.0,"b":[1e0,{"c":null}]}': true, '{"a":true,"b":[1,{"c":null}]}': false, '{"a":1,"b":[1,{}]}': false, '{"a":1,"b":[1,{"c":null,"d":1}]}': false, '{"a":1,"b":[1,{"c":null},1]}': false, '{"a":1,"b":[1]}': false }],
  ["const []", { const: [] }, { "[]": true, "{}": false, "[[]]": false }],
  ["const {}", { const: {} }, { "{}": true, "[]": false, '{"a":1}': false, '{"__proto__":1}': false }],
  ["enum [[1],{a:1}]", { enum: [[1], { a: 1 }, "1", 1] }, { "[1]": true, "[1.0]": true, "[true]": false, "[1,1]": false, "[]": false, '{"a":1}': true, '{"a":true}': false, '{"a":1,"b":1}': false, "{}": false, "1": true, '"1"': true, "true": false }],
  ["enum with __proto__", { enum: [parsed('{"__proto__":1}')] }, { '{"__proto__":1}': true, "{}": false, '{"__proto__":2}': false }],
  ["empty enum", { enum: [] }, { "1": false, "null": false }],
  ["maxLength counts code points", { maxLength: 2 }, { '"💩💩"': true, '"💩💩💩"': false, '"\\ud83d\\ud83d"': true, '"\\ud83d\\ud83d\\ud83d"': false, '"e\\u0301e\\u0301"': false, '"ab"': true, '"a💩"': true, '"\\ud83d\\udca9\\ud83d"': true }],
  ["minLength counts code points", { minLength: 2 }, { '"💩"': false, '"💩💩"': true, '"\\ud83d\\udca9"': false, '"\\udca9\\ud83d"': true, '"é"': false, '"e\\u0301"': true }],
  ["pattern is unanchored", { pattern: "b" }, { '"abc"': true, '"ac"': false, "1": true }],
  ["pattern . is a code point", { pattern: "^.$" }, { '"💩"': true, '"ab"': false, '"\\ud83d"': true, '"\\n"': false }],
  ["pattern \\p", { pattern: "^\\p{L}+$" }, { '"é"': true, '"1"': false, '"ß"': true }],
  ["pattern astral class", { pattern: "^[💩]$" }, { '"💩"': true, '"\\ud83d"': false, '"\\udca9"': false }],
  ["pattern \\d is ASCII", { pattern: "^\\d$" }, { '"1"': true, '"\\u0661"': false }],
  ["pattern \\w is ASCII", { pattern: "^\\w$" }, { '"é"': false, '"a"': true }],
  ["pattern $ takes no newline", { pattern: "^a$" }, { '"a\\n"': false, '"a"': true, '"b\\na"': false }],
  ["required: own only", { required: ["__proto__", "constructor", "hasOwnProperty", "toString"] }, { "{}": false, '{"__proto__":1,"constructor":1,"hasOwnProperty":1,"toString":1}': true, '{"constructor":1,"hasOwnProperty":1,"toString":1}': false }],
  ["properties: own only", parsed('{"properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"toString":{"type":"string"}}}'), { "{}": true, '{"__proto__":1}': false, '{"__proto__":"x"}': true, '{"constructor":1}': false, '{"toString":1}': false }],
  ["additionalProperties false v. __proto__", { properties: { a: {} }, additionalProperties: false }, { '{"__proto__":1}': false, '{"__proto__":{}}': false, '{"__proto__":null}': false, '{"constructor":1}': false, '{"a":1}': true, '{"0":1}': false, '{"a":1,"0":1}': false, '{"":1}': false }],
  ["additionalProperties false with __proto__ declared", parsed('{"properties":{"__proto__":{}},"additionalProperties":false}'), { '{"__proto__":1}': true, '{"a":1}': false }],
  ["index-like keys", { properties: { "0": { type: "string" }, "1": { type: "number" } }, required: ["0"], additionalProperties: false }, { '{"0":"a"}': true, '{"0":1}': false, '{"1":1}': false, '{"0":"a","1":"x"}': false, '{"0":"a","2":1}': false, '{"0":"a","01":1}': false, '["a"]': true }],
  ["additionalProperties + patternProperties", { properties: { a: {} }, patternProperties: { "^x": { type: "number" } }, additionalProperties: false }, { '{"a":1,"x1":1}': true, '{"x1":"s"}': false, '{"y":1}': false, '{"ax":1}': false }],
  ["a key under both properties and patternProperties", { properties: { xa: { type: "number" } }, patternProperties: { "^x": { maximum: 1 } } }, { '{"xa":1}': true, '{"xa":2}': false, '{"xa":"s"}': false }],
  ["type list", { type: ["null", "string"] }, { "null": true, '"a"': true, "0": false, "false": false }],
  ["nullable beside type", { type: "string", nullable: true }, { "null": false, '"a"': true }],
  ["nullable beside type and enum", { type: "string", nullable: true, enum: ["a"] }, { "null": false, '"a"': true }],
  ["nullable without type", { nullable: true }, { "null": true }],
  ["default never counts", { properties: { a: { type: "number", default: 1 } }, required: ["a"] }, { "{}": false, '{"a":1}': true }],
  ["$ref beside siblings, draft-07", { $schema: draft07, properties: { a: { $ref: "#/definitions/s", maxLength: 1 } }, definitions: { s: { type: "string" } } }, { '{"a":"xx"}': true, '{"a":1}': false }],
  ["$ref beside siblings, 2019-09", { $schema: draft2019, properties: { a: { $ref: "#/$defs/s", maxLength: 1 } }, $defs: { s: { type: "string" } } }, { '{"a":"xx"}': false, '{"a":"x"}': true }],
  ["$ref beside siblings, 2020-12", { $schema: draft2020, properties: { a: { $ref: "#/$defs/s", maxLength: 1 } }, $defs: { s: { type: "string" } } }, { '{"a":"xx"}': false, '{"a":"x"}': true, '{"a":1}': false }],
  ["items list, draft-07", { $schema: draft07, items: [{ type: "number" }], additionalItems: false }, { "[1]": true, "[1,2]": false, '["a"]': false, "[]": true }],
  ["prefixItems + items", { prefixItems: [{ type: "number" }], items: { type: "string" } }, { '[1,"a"]': true, "[1,2]": false, "[]": true }],
  ["dependencies, draft-07", { $schema: draft07, dependencies: { a: ["b"], c: { required: ["d"] } } }, { '{"a":1}': false, '{"a":1,"b":1}': true, '{"c":1}': false, '{"c":1,"d":1}': true, "{}": true }],
  ["dependentRequired v. __proto__", parsed('{"dependentRequired":{"a":["__proto__"],"toString":["b"]}}'), { '{"a":1}': false, '{"a":1,"__proto__":1}': true, "{}": true, '{"toString":1}': false }],
  ["unevaluatedItems sees prefixItems, contains", { prefixItems: [{}], contains: { const: "c" }, unevaluatedItems: false }, { '[1,"c"]': true, '[1,"c","d"]': false, '["c"]': true, '[1,"c","c"]': true }],
  ["unevaluatedProperties: a failed branch marks nothing", { oneOf: [{ properties: { a: {} }, required: ["x"] }, { properties: { b: {} } }], unevaluatedProperties: false }, { '{"a":1}': false, '{"b":1}': true, '{"a":1,"x":1}': false }],
  ["uniqueItems", { uniqueItems: true }, { "[1,1.0]": false, "[1,true]": true, "[0,false]": true, '[{"a":1,"b":2},{"b":2,"a":1}]': false, "[[1],[1]]": false, "[0,-0]": false, '["1",1]': true, "[null,null]": false, "[{},[]]": true, '[{"a":1},{"a":1,"b":1}]': true, '["a","a"]': false, "[1e0,1]": false, '["💩","💩"]': false, '[{"__proto__":1},{}]': true }],
  ["contains", { contains: { type: "number" } }, { "[]": false, '["a"]': false, '["a",1]': true }],
  ["minContains 0", { contains: { type: "number" }, minContains: 0 }, { "[]": true, '["a"]': true }],
  ["oneOf both", { oneOf: [{ type: "integer" }, { minimum: 2 }] }, { "3": false, "1": true, "2.5": true, "1.5": false }],
  ["a union by a tag that is not required", { oneOf: [{ properties: { k: { const: "x" } } }, { properties: { k: { const: "y" } } }] }, { "{}": false, '{"k":"x"}': true, '{"k":"z"}': false, '{"k":1}': false, "1": false, '{"k":null}': false }],
  ["anyOf by a tag that is not required", { anyOf: [{ properties: { k: { const: "x" }, a: { type: "number" } } }, { properties: { k: { const: "y" }, a: { type: "string" } } }] }, { "{}": true, '{"a":true}': false, '{"a":1}': true, '{"k":"x","a":"s"}': false, '{"k":"y","a":"s"}': true, "1": true }],
  ["a tag named __proto__", parsed('{"oneOf":[{"properties":{"__proto__":{"const":"x"}},"required":["__proto__"]},{"properties":{"__proto__":{"const":"y"}},"required":["__proto__"]}]}'), { "{}": false, '{"__proto__":"x"}': true, '{"__proto__":"z"}': false }],
  ["if without then", { if: { type: "number" } }, { "1": true, '"a"': true }],
  ["then without if", { then: false }, { "1": true }],
  ["not {}", { not: {} }, { "1": false, "null": false }],
  ["not true", { not: true }, { "1": false }],
  ["not false", { not: false }, { "1": true }],
  ["propertyNames", { propertyNames: { maxLength: 1 } }, { '{"💩":1}': true, '{"ab":1}': false, '{"__proto__":1}': false, "{}": true }],
  ["maxProperties counts __proto__ and indices", { maxProperties: 1 }, { '{"__proto__":1,"a":1}': false, '{"0":1,"a":1}': false, '{"a":1,"a":2}': true }],
  ["the same key twice: the last counts", { properties: { a: { type: "number" } } }, { '{"a":"x","a":1}': true, '{"a":1,"a":"x"}': false }],
  ["minimum at the edges", { minimum: 9007199254740992 }, { "9007199254740991": false, "9007199254740992": true, "9007199254740993": true }],
  ["exclusiveMinimum 0", { exclusiveMinimum: 0 }, { "0": false, "-0": false, "5e-324": true, "1e-400": false }],
  ["maximum 1e308", { maximum: 1e308 }, { "1e308": true, "1.1e308": false, "1e999": false }],
  ["70 required", { required: Array.from({ length: 70 }, (_, i) => "p" + i) }, { [members(70)]: true, [members(69)]: false, [members(70, 64)]: false, [members(70, 63)]: false }],
  ["boolean schemas in properties", { properties: { a: false, b: true } }, { '{"a":1}': false, '{"b":1}': true, "{}": true, '{"a":null}': false }],
  ["$id does not count inside enum | const", { $defs: { a: { enum: [{ $id: "http://x.test/e", type: "null" }] }, b: { $id: "http://x.test/e", type: "string" } }, $ref: "http://x.test/e" }, { '"a"': true, "null": false }],
  ["$anchor in another resource is not seen", { $id: "http://x.test/root", $ref: "#a", $defs: { in: { $id: "inner", $anchor: "a", type: "number" }, out: { $anchor: "a", type: "string" } } }, { '"s"': true, "1": false }],
  ["type object takes no array, type array no object", { type: "object" }, { "[]": false, "{}": true, "null": false }],

  // No text of the schema becomes program text.
  ["keys that would end a string, a comment or a template", { properties: Object.fromEntries(awkwardTexts.map(key => [key, { type: "number" }])), additionalProperties: false }, { [textOf(Object.fromEntries(awkwardTexts.map(key => [key, 1])))]: true, ...Object.fromEntries(awkwardTexts.map(key => [textOf({ [key]: "s" }), false])), [textOf({ " ": 1 })]: false, [textOf({ "\\\\": 1 })]: false }],
  ["constants that would end a string, a comment or a template", { enum: awkwardTexts }, { ...Object.fromEntries(awkwardTexts.map(value => [textOf(value), true])), [textOf(" ")]: false, [textOf("\\\\")]: false, '""': false }],
  ["a pattern with a quote and a slash", { pattern: '^"/"$' }, { [textOf('"/"')]: true, [textOf("/")]: false }],

  // A number is finite: what JSON.parse turns into Infinity fails every schema but `true` and `{}`.
  ["too large for a double, no type: maximum", { maximum: 100 }, { "1e999": false, "-1e999": false, "100": true }],
  ["too large for a double, no type: minimum", { minimum: 0 }, { "1e999": false, "-1e999": false }],
  ["too large for a double, no type: not", { not: { type: "string" } }, { "1e999": false, "1": true }],
  ["too large for a double, no type: minLength", { minLength: 1 }, { "1e999": false, "1": true }],
  ["too large for a double, in an array", { items: { type: "number" } }, { "[1e999]": false, "[1]": true }],
  ["too large for a double, contains", { contains: { type: "number" } }, { "[1e999]": false }],
  ["too large for a double, under {}", {}, { "1e999": true }],
  ["too large for a double, under true", true, { "1e999": true }],

  // The rules that have a node of their own.
  ["contains between 2 and 3", { contains: { const: 1 }, minContains: 2, maxContains: 3 }, { "[1]": false, "[1,1]": true, "[1,2,1,2,1]": true, "[1,1,1,1]": false, "[]": false, "{}": true, '"11"': true, "[1.0,1]": true }],
  ["contains at most 1, none needed", { contains: { type: "string" }, minContains: 0, maxContains: 1 }, { "[]": true, '["a"]': true, '["a","b"]': false, "[1,2]": true }],
  ["contains false", { contains: false }, { "[]": false, "[1]": false, "1": true }],
  ["not under not", { not: { not: { type: "number" } } }, { "1": true, '"a"': false }],
  ["not an object with a member", { not: { type: "object", required: ["a"] } }, { '{"a":1}': false, '{"b":1}': true, "1": true, '{"a":null}': false }],
  ["if then else", { if: { type: "number" }, then: { minimum: 10 }, else: { type: "string" } }, { "10": true, "9": false, '"a"': true, "null": false, "[]": false }],
  ["if else", { if: { required: ["a"] }, else: { required: ["b"] } }, { '{"a":1}': true, '{"b":1}': true, "{}": false, "1": true }],
  ["if false then false", { if: false, then: false }, { "1": true }],
  ["if true then false", { if: true, then: false }, { "1": false, "null": false }],
  ["oneOf of three that overlap", { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }, { multipleOf: 5 }] }, { "2": true, "6": false, "30": false, "7": false, "25": true, '"a"': false }],
  ["oneOf with true", { oneOf: [true, { type: "number" }] }, { "1": false, '"a"': true }],
  ["oneOf of none", { oneOf: [false, false] }, { "1": false }],
  ["allOf whose parts close their own members", { allOf: [{ properties: { a: { type: "number" } }, additionalProperties: false }, { properties: { b: {} } }] }, { '{"a":1}': true, '{"a":1,"b":1}': false, '{"b":1}': false, "{}": true, "1": true }],
  ["allOf with not", { allOf: [{ type: "integer" }, { not: { multipleOf: 2 } }] }, { "1": true, "2": false, "1.5": false }],
  ["allOf with false", { allOf: [true, false] }, { "1": false }],
  ["patternProperties false", { patternProperties: { "^_": false } }, { '{"_a":1}': false, '{"a_":1}': true, '{"__proto__":1}': false, "{}": true, '["_a"]': true }],
  ["two patterns meet one key", { patternProperties: { a: { type: "number" }, b: { minimum: 2 } } }, { '{"ab":2}': true, '{"ab":1}': false, '{"ab":"s"}': false, '{"b":"s"}': true, '{"c":"s"}': true }],
  ["patternProperties and a schema for the rest", { patternProperties: { "^n": { type: "number" } }, additionalProperties: { type: "string" } }, { '{"n":1,"s":"a"}': true, '{"n":"a"}': false, '{"s":1}': false }],
  ["patternProperties meets an index", { patternProperties: { "^[0-9]+$": { type: "string" } }, additionalProperties: false }, { '{"0":"a","12":"b"}': true, '{"0":1}': false, '{"0a":"a"}': false }],
  ["propertyNames by enum", { propertyNames: { enum: ["a", "__proto__"] } }, { '{"a":1}': true, '{"__proto__":1}': true, '{"b":1}': false, '{"constructor":1}': false, "[1]": true }],
  ["propertyNames by pattern", { propertyNames: { pattern: "^[a-z]+$" } }, { '{"ab":1}': true, '{"a1":1}': false, '{"":1}': false, '{"0":1}': false }],
  ["propertyNames false", { propertyNames: false }, { "{}": true, '{"a":1}': false, "[1]": true }],
  ["propertyNames: a key is a string", { propertyNames: { type: "number" } }, { '{"1":1}': false, "{}": true }],
  ["minProperties", { minProperties: 2 }, { '{"a":1}': false, '{"a":1,"b":1}': true, '{"a":1,"a":2}': false, '{"__proto__":1,"0":1}': true, "[1]": true, '"ab"': true, '{"a":null,"b":null}': true }],
  ["maxProperties 0", { maxProperties: 0 }, { "{}": true, '{"":1}': false, '{"__proto__":null}': false }],
  ["dependentRequired", { dependentRequired: { a: ["b", "c"] } }, { '{"a":1,"b":1,"c":1}': true, '{"a":1,"b":1}': false, '{"b":1}': true, '{"a":null}': false, '["a"]': true }],
  ["dependentRequired on inherited names", { dependentRequired: { a: ["toString", "constructor"] } }, { '{"a":1}': false, '{"a":1,"toString":1,"constructor":1}': true }],
  ["dependentSchemas sees the object", { dependentSchemas: { a: { properties: { b: { type: "number" } }, required: ["b"] } } }, { '{"a":1,"b":1}': true, '{"a":1}': false, '{"a":1,"b":"s"}': false, '{"b":"s"}': true, "1": true }],
  ["dependentSchemas false", parsed('{"dependentSchemas":{"__proto__":false,"a":true}}'), { '{"__proto__":1}': false, '{"a":1}': true, "{}": true }],
  ["a tuple says nothing about an array that ends early", { prefixItems: [{ type: "number" }, { type: "string" }], items: false }, { "[]": true, "[1]": true, '[1,"a"]': true, '[1,"a",1]': false, '["a"]': false, "[1,1]": false, "{}": true }],
  ["a tuple whose first element is required", { prefixItems: [{ type: "number" }, { type: "string" }], items: false, minItems: 1 }, { "[]": false, "[1]": true, '[1,"a"]': true, '[1,"a",1]': false }],
  ["a tuple with a rest", { type: "array", prefixItems: [{ type: "number" }, { type: "string" }], items: { type: "boolean" } }, { "[]": true, "[1]": true, '[1,"a"]': true, '[1,"a",true,false]': true, '[1,"a",1]': false, '[1,"a",true,1]': false, "{}": false }],
  ["an open tuple", { prefixItems: [{ type: "number" }] }, { '[1,"a",null]': true, '["a"]': false, "[]": true }],
  ["a tuple that needs more than it describes", { prefixItems: [{ type: "number" }], minItems: 3 }, { "[1,2]": false, '[1,"a",null]': true, '["a",1,1]': false }],
  ["a tuple of draft-07 with a rest", { $schema: draft07, items: [{ type: "number" }], additionalItems: { type: "string" } }, { '[1,"a","b"]': true, "[1,1]": false, "[]": true }],
  ["uniqueItems false", { uniqueItems: false }, { "[1,1]": true }],
  ["uniqueItems tells a string from what it spells", { uniqueItems: true }, { '["[1]",[1]]': true, '["{}",{}]': true, '["null",null]': true, '["1","1.0"]': true, '[{"a":"b"},{"a":"b\\""}]': true, '[["a","b"],["a,b"]]': true, '[{"a":[1,2]},{"a":[1],"b":[2]}]': true, '[{"a":{"b":1}},{"a":{"b":1.0}}]': false, '[[[]],[[]]]': false, '["\\ud83d","\\ud83d"]': false, '["\\ud83d","\\udca9"]': true }],
  ["uniqueItems at every level", { type: "array", uniqueItems: true, items: { $ref: "#" } }, { ["[".repeat(3000) + "]".repeat(3000)]: true, "[[],[[]]]": true, "[[[]],[[]]]": false, "[[[],[]]]": false }],

  // JSON Schema means the `u` flag: a pattern sees code points.
  ["pattern: a look-around stands between code points", { pattern: "(?<!a)(?!a)" }, { '"a💩a"': false, '"a"': false, '"b"': true, '""': true }],
  ["propertyNames: a look-around stands between code points", { propertyNames: { pattern: "(?<!a)(?!a)" } }, { '{"a💩a":1}': false, '{"b":1}': true }],
  ["pattern \\p is not the letter p", { type: "string", pattern: "^\\p{L}+$" }, { '"p{L}"': false, '"é"': true }],
  ["pattern \\p{Lu}", { type: "string", pattern: "^\\p{Lu}" }, { '"p{Lu}x"': false, '"Admin"': true }],
  ["pattern counts code points", { pattern: "^.{2,}$" }, { '"💩"': false, '"💩💩"': true, '"ab"': true }],
  ["pattern \\u{61}", { pattern: "^\\u{61}$" }, { '"a"': true, [textOf("u".repeat(61))]: false }],
  ["patternProperties: . is a code point", { patternProperties: { "^.$": false } }, { '{"💩":1}': false, '{"a":1}': false, '{"ab":1}': true, '{"\\ud83d":1}': false }],
  ["patternProperties: a negated class takes a code point", { patternProperties: { "^[^a]$": false } }, { '{"💩":1}': false, '{"b":1}': false, '{"a":1}': true }],
  ["propertyNames \\p", { propertyNames: { pattern: "^\\p{L}+$" } }, { '{"p{L}":1}': false, '{"é":1}': true }],
  ["propertyNames not \\p{Lu}", { type: "object", propertyNames: { not: { pattern: "^\\p{Lu}" } } }, { '{"Admin":1}': false, '{"admin":1}': true }],
  ["not a pattern of one code point", { type: "string", not: { pattern: "^.$" } }, { '"💩"': false, '"a"': false, '"ab"': true }],
  ["a search that gives up under not", { not: { type: "string", pattern: "^(a+)+$" } }, { [textOf("a".repeat(40) + "!")]: "RangeError", [textOf("a".repeat(40) + "Ā!")]: "RangeError", '"aa"': false, '"b"': true }],

  // What an accept hands back is what was handed in.
  ["a key named __proto__ that a pattern meets", { patternProperties: { "^_": { type: "object" } }, additionalProperties: false }, { '{"__proto__":{"isAdmin":true}}': true, '{"__proto__":1}': false, '{"a":{}}': false }],
  ["a key named __proto__ that additionalProperties meets", { properties: { a: {} }, additionalProperties: { type: "object" } }, { '{"__proto__":{"isAdmin":true}}': true, '{"__proto__":1}': false }],
  ["nothing is stripped, ordered anew or rounded", { properties: { a: { type: "number" } } }, { '{"z":-0,"a":1.0,"b":{"y":1,"x":[{"__proto__":[]},-0.0,1e2]},"1":null}': true }],
  ["no default is filled in", { properties: { a: { type: "number", default: 1 }, b: { default: { c: 1 } } } }, { "{}": true, '{"b":null}': true }],
  ["patternProperties under not, and a schema for the rest", { not: { type: "object", patternProperties: { "^a": { type: "number" } }, additionalProperties: { type: "string" } } }, { '{"a1":5}': false, '{"a1":"s"}': true, '{"b":"s"}': false, '{"b":5}': true }],

  ["a closed object without members", { type: "object", additionalProperties: false }, { "{}": true, '{"isAdmin":true}': false, "42": false, "null": false, '"x"': false, "[1]": false }],
  ["a closed object without members, with patterns", { type: "object", patternProperties: { "^x-": { type: "string" } }, additionalProperties: false }, { "{}": true, '{"x-a":"b"}': true, '{"role":"admin"}': false, '{"x-a":1}': false, "42": false }],
  ["an object with at least one member", { type: "object", minProperties: 1 }, { '{"a":1}': true, "{}": false, "null": false, "7": false, "[]": false }],
  ["members, patterns and nothing else", { type: "object", properties: { a: { type: "number" } }, required: ["a"], patternProperties: { "^x-": { type: "string" } }, additionalProperties: false }, { '{"a":1}': true, '{"a":1,"x-c":"d"}': true, '{"a":1,"b":2}': false, '{"a":1,"x-c":3}': false }],
  ["members, patterns and booleans", { type: "object", properties: { a: { type: "number" } }, required: ["a"], patternProperties: { "^x-": { type: "string" } }, additionalProperties: { type: "boolean" } }, { '{"a":1,"b":true}': true, '{"a":1,"x-c":"d"}': true, '{"a":1,"b":2}': false }],
  ["members, patterns and booleans, none required", { type: "object", properties: { a: { type: "string" } }, patternProperties: { "^x-": { type: "number" } }, additionalProperties: { type: "boolean" } }, { '{"a":"s","x-1":1,"b":true}': true, '{"x-1":true}': false, '{"b":1}': false, '{"a":true}': false }],
  ["not an object of patterns alone", { type: "object", not: { patternProperties: { "^x-": { type: "number" } }, additionalProperties: false } }, { '{"b":1}': true, '{"x-1":"s"}': true, "{}": false, '{"x-1":1}': false }],
  ["a schema that reaches itself through patternProperties", { type: "object", patternProperties: { "^a": { $ref: "#" } }, additionalProperties: false }, { '{"a":{"ab":{}}}': true, "{}": true, '{"a":{"b":1}}': false, '{"a":1}': false }],
  ["a schema that reaches itself through additionalProperties", { type: "object", additionalProperties: { $ref: "#" } }, { "{}": true, '{"a":{"b":{}}}': true, '{"a":1}': false, '{"a":{"b":1}}': false }],
  ["a schema that reaches itself through additionalProperties, beside patterns", { type: "object", patternProperties: { "^a": { type: "string" } }, additionalProperties: { $ref: "#" } }, { '{"a":"s","b":{"a":"s"}}': true, '{"b":{"a":1}}': false, '{"b":1}': false }],
  ["a schema that reaches itself through prefixItems", { anyOf: [{ type: "null" }, { type: "array", prefixItems: [{ $ref: "#" }], items: false, minItems: 1 }] }, { "null": true, "[null]": true, "[[null]]": true, "[1]": false, "[[1]]": false, "[]": false }],
  ["a schema that reaches itself through contains", { type: "array", contains: { $ref: "#" } }, { "[]": false, "[[]]": false, "[1]": false }],
  ["a member named bun.lock", { properties: { "bun.lock": { type: "number" } } }, { '{"bun.lock":1}': true, '{"bun.lock":"s"}': false }],
  ["members named bun.lock and bun.future", { type: "object", properties: { "bun.lock": { type: "string" }, "bun.future": { const: true } }, required: ["bun.lock"] }, { '{"bun.lock":"x"}': true, '{"bun.lock":"x","bun.future":true}': true, '{"bun.lock":1}': false, '{"bun.lock":"x","bun.future":false}': false }],
  ["no pattern, and numbers for the rest", { type: "object", properties: { a: { type: "boolean" } }, required: ["a"], patternProperties: {}, additionalProperties: { type: "number" } }, { '{"a":true,"b":1}': true, '{"a":true,"b":"x"}': false }],
  ["a constant list of an object", { const: [{ a: 1 }] }, { '[{"a":1}]': true, '[{"a":1,"b":2}]': false, "[]": false, '[{"a":1},{"a":1}]': false }],
  ["a tuple whose second element is optional", { type: "array", prefixItems: [{ type: "number" }, { type: "string" }], items: false, minItems: 1 }, { "[1]": true, '[1,"a"]': true, "[1,null]": false, "[1,2]": false, "[]": false, '[1,"a",1]': false }],

  // A fraction as multipleOf: both numbers are taken as the decimals that they are written as.
  ["multipleOf 0.01 of a number", { type: "number", multipleOf: 0.01 }, { "0.07": true, "4.35": true, "19.99": true, "0": true, "-0.01": true, "0.075": false, "1e-9": false }],
  ["multipleOf 3 of a number", { type: "number", multipleOf: 3 }, { "1e17": false, "9": true, "-0": true, "3e15": true }],
  ["multipleOf 0.01 of large numbers", { type: "number", multipleOf: 0.01 }, { "90071992547409.94": true, "1e300": true, "19.995": false }],
  ["multipleOf 0.0001", { type: "number", multipleOf: 0.0001 }, { "0.0075": true, "0.00751": false }],
  ["multipleOf 1e-23", { type: "number", multipleOf: 1e-23 }, { "3e-23": true }],
  ["multipleOf 5e-324", { type: "number", multipleOf: 5e-324 }, { "1.5e-323": true }],
  ["not a multiple of 0.01", { not: { multipleOf: 0.01 } }, { "0.07": false, "19.99": false, "0.075": true, '"a"': false }],
  ["if a multiple of 0.1 then nothing", { if: { multipleOf: 0.1 }, then: false }, { "0.3": false, "0.35": true, "null": false }],
  ["oneOf with a fraction", { oneOf: [{ multipleOf: 0.01 }, { minimum: 0 }] }, { "0.07": false, "-0.07": true, "0.075": true, "-0.075": false }],
  ["contains no multiple of 0.01", { contains: { type: "number", multipleOf: 0.01 }, minContains: 0, maxContains: 0 }, { "[0.07]": false, "[0.075]": true, "[]": true }],
  ["multipleOf 0.03 where a product is rounded", { type: "number", multipleOf: 0.03 }, { "81720242497126.4": "closed", "0.09": true }],
  ["multipleOf 0.009 where a product is rounded", { type: "number", multipleOf: 0.009 }, { "8934541292994.56": "closed", "0.018": true }],
  ["multipleOf 3e-14", { type: "number", multipleOf: 3e-14 }, { "64.4": "closed" }],
  ["multipleOf 0.3 of a large whole number", { type: "number", multipleOf: 0.3 }, { "5404319552844595": "closed", "2702159776422297.5": "closed", "0.9": true, "3": true }],
  ["not a multiple of 0.01, a large number", { not: { multipleOf: 0.01 } }, { "90071992547409.94": "closed" }],
  ["not a multiple of 0.00002, a large number", { not: { multipleOf: 0.00002 } }, { "88837290713570.5": "closed" }],

  // No fixed width cuts in silence.
  ["70 keys of dependentRequired", { dependentRequired: byKey(() => ["x"]) }, { '{"k69":1}': false, '{"k64":1}': false, '{"k63":1}': false, '{"k0":1}': false, '{"k69":1,"x":1}': true, '{"x":1}': true }, beyondTheChecker],
  ["70 keys of dependentSchemas", { dependentSchemas: byKey(() => ({ required: ["x"] })) }, { '{"k69":1}': false, '{"k64":1}': false, '{"k0":1}': false, '{"k69":1,"x":1}': true }, beyondTheChecker],
  ["70 patterns", { patternProperties: byKey(() => ({ type: "number" }), i => "^k" + i + "$") }, { '{"k69":"s"}': false, '{"k64":"s"}': false, '{"k0":"s"}': false, '{"k69":1}': true, '{"k70":"s"}': true }, beyondTheChecker],
  ["70 arms of oneOf", { oneOf: seventy.map(i => ({ minimum: i })) }, { "0": true, "0.5": true, "1": false, "69": false, "-1": false }, beyondTheChecker],
  ["70 arms of anyOf", { anyOf: seventy.map(i => ({ const: i })) }, { "69": true, "64": true, "0": true, "70": false }, beyondTheChecker],
  ["70 parts of allOf", { allOf: seventy.map(i => ({ not: { const: i } })) }, { "69": false, "64": false, "0": false, "70": true }, beyondTheChecker],
  ["70 members of a closed object", { properties: byKey(() => ({ type: "number" })), additionalProperties: false }, { '{"k69":1}': true, '{"k69":"s"}': false, '{"k64":"s"}': false, '{"k70":1}': false }],
  ["70 constants", { enum: seventy.map(i => "v" + i) }, { '"v69"': true, '"v64"': true, '"v70"': false }],
  ["minProperties beyond 32 bits", { minProperties: 4294967297 }, { '{"a":1}': false, "{}": false, "1": true }],
  ["minContains beyond 32 bits", { contains: {}, minContains: 4294967296 }, { "[]": false, "[1]": false }],
  ["minItems beyond 32 bits", { minItems: 4294967297 }, { "[1]": false, "[]": false }],
  ["minLength beyond 32 bits", { minLength: 4294967297 }, { '"a"': false, '""': false }],
  ["maxProperties beyond 32 bits", { maxProperties: 4294967296 }, { '{"a":1}': true }],
  ["a constant that no double holds", { enum: [1e400] }, { "1e400": false, "1e999": false, "1": false }],
  ["a constant that no double holds, const", { const: -1e400 }, { "-1e400": false }],

  ...[10, 30, 60, 120].map(
    (levels): Trap => [
      levels + " times not, in a member that only a pattern names",
      { type: "object", patternProperties: { "^a": under(levels, "not", { type: "string" }) } },
      { '{"a":"x"}': true, '{"a":1}': false, '{"b":1}': true },
      ["not", "Not", "patternProperties", "PatternProperties", "FromJSONSchema", ...beyondTheChecker],
    ],
  ),
  ...[10, 30, 60].map(
    (levels): Trap => [
      levels + " levels of items",
      under(levels, "items", { type: "string" }),
      { ["[".repeat(levels) + '"x"' + "]".repeat(levels)]: true, ["[".repeat(levels) + "1" + "]".repeat(levels)]: false },
      ["items", "FromJSONSchema", ...beyondTheChecker],
    ],
  ),

  // A schema that asks itself about the same value has no answer.
  ["not itself", { not: { $ref: "#" } }, neverAccepted],
  ["if itself then nothing", { if: { $ref: "#" }, then: false }, neverAccepted],
  ["oneOf itself or anything", { oneOf: [{ $ref: "#" }, {}] }, neverAccepted],
  ["allOf itself", { allOf: [{ $ref: "#" }] }, neverAccepted],
  ["not one of two definitions that are each other", { $defs: { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } }, not: { $ref: "#/$defs/a" } }, neverAccepted],

  // Strings as a text spells them.
  ["an escaped key: dependentRequired", { dependentRequired: { a: ["b"] } }, { '{"\\u0061":1}': false, '{"\\u0061":1,"\\u0062":1}': true }],
  ["an escaped key: patternProperties", { patternProperties: { "^_": false } }, { '{"\\u005fa":1}': false, '{"\\u0061_":1}': true }],
  ["an escaped key: propertyNames", { propertyNames: { enum: ["a"] } }, { '{"\\u005f_proto__":1}': false, '{"\\u0061":1}': true, '{"a\\u0000":1}': false }],
  ["an escaped key: maxProperties", { maxProperties: 0 }, { '{"\\u005f_proto__":1}': false }],
  ["an escaped key: a closed object", { properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false }, { '{"\\u0061":1}': true, '{"\\u0061":"s"}': false, '{"\\u0062":1}': false, '{"a":1,"\\u0061":"s"}': false, '{"a":"s","\\u0061":1}': true, '{"a":1,"a\\u0000":1}': false }],
  ["an escaped constant", { enum: ["a", "/"] }, { '"\\u0061"': true, '"\\/"': true, '"a\\u0000"': false, '"\\u0000a"': false }],
  ["NUL behind an ipv4", { format: "ipv4" }, { '"1.2.3.4"': true, '"1.2.3.4\\u0000"': false }],
  ["NUL behind a date", { format: "date" }, { '"2020-01-01"': true, '"2020-01-01\\u0000"': false }],
  ["NUL behind an email", { format: "email" }, { '"a@b.co"': true, '"a@b.co\\u0000"': false }],
  ["NUL behind a hostname", { format: "hostname" }, { '"b.co"': true, '"b.co\\u0000"': false, '"example."': false, '"."': false, '"example．com"': false, '"ab--cd"': false }],

  ["a host name with a label that begins with xn--", { type: "string", format: "hostname" }, { '"xn--X"': false, '"XN--aa---o47jg78q"': false, '"xn--hello-txk"': false, '"xn--l-fda"': false, '"xn--vek"': false, '"xn--02b508i"': false, '"a.example"': true }],
  ["no host name", { type: "string", not: { format: "hostname" } }, { '"xn--X"': "closed", '"xn--l-fda"': "closed", '"xn--bcher-kva.example"': "closed", '"-a"': true, '"a.example"': false }],
  ["an email whose domain has a label that begins with xn--", { format: "email" }, { '"a@xn--X"': false, '"a@xn--l-fda.example"': false, '"a@b.example"': true }],

  // `null` where the schema states no type.
  ["null under oneOf: both arms take it", { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }] }, { "null": false, "2": true, "6": false }],
  ["null under oneOf: a rule about strings, and type null", { oneOf: [{ minLength: 1 }, { type: "null" }] }, { "null": false, '""': false, '"a"': true, "1": true }],
  ["null under allOf with not", { allOf: [{ minimum: 1 }, { not: { maximum: 5 } }] }, { "null": false, "6": true, "3": false }],
  ["null under not", { not: { minProperties: 1 } }, { "null": false, "{}": true, '{"a":1}': false }],
  ["null under not under not", { not: { not: { minLength: 1 } } }, { "null": true, '""': false }],
  ["null behind $ref", { $ref: "#/$defs/a", $defs: { a: { not: { minimum: 1 } } } }, { "null": false, "0": true, "1": false }],
  ["null under anyOf", { anyOf: [{ not: { maxLength: 1 } }, { type: "number" }] }, { "null": false, "1": true, '"ab"': true, '"a"': false }],
  ["null under if", { if: { minimum: 0 }, then: false }, { "null": false, "-1": true, "0": false }],
  ["null under oneOf: one arm takes it", { oneOf: [{ type: "null" }, { type: "number" }] }, { "null": true, "1": true, '"a"': false }],

  // A JSON Pointer in $ref is written with escapes.
  ["$ref with ~1", { $ref: "#/$defs/a~1b", $defs: { "a/b": { type: "number" } } }, { "1": true, '"a"': false }],
  ["$ref with ~0", { $ref: "#/$defs/a~0b", $defs: { "a~b": { type: "number" } } }, { "1": true, '"a"': false }],
  ["$ref with ~01", { $ref: "#/$defs/a~01b", $defs: { "a~1b": { type: "number" }, "a/b": { type: "string" } } }, { "1": true, '"a"': false }],
  ["$ref with %25", { $ref: "#/$defs/a%25b", $defs: { "a%b": { type: "number" } } }, { "1": true, '"a"': false }],
  ["$ref into a list", { $ref: "#/allOf/1", allOf: [true, { type: "number" }] }, { "1": true, '"a"': false }],

  // What JSON.parse turns into Infinity, below a keyword that turns a refusal round.
  ...belowWhatTurnsRound((name, schema, textOf): Trap => ["too large for a double: " + name, schema, { [textOf("1e999")]: false, [textOf("-1e999")]: false, [textOf("1")]: true, [textOf('"x"')]: false }]),
  ["too large for a double: a member that is required and has no schema", { type: "object", required: ["a"] }, { '{"a":1e999}': true, '{"a":null}': true, "{}": false }],
  ["too large for a double: a member that not requires", { type: "object", not: { required: ["isAdmin"] } }, { '{"isAdmin":1e999}': false, '{"isAdmin":true}': false, "{}": true }],
  ["too large for a double: a member that not requires, no type", { not: { required: ["a"] } }, { '{"a":1e999}': false, '{"a":-1e999}': false }],
  ["too large for a double: a member that if requires", { type: "object", if: { required: ["admin"] }, then: { required: ["token"] } }, { '{"admin":1e999}': false, '{"admin":1}': false, '{"admin":1e999,"token":1}': false, "{}": true }],
  ["too large for a double: a member that one arm requires", { type: "object", oneOf: [{ required: ["a"] }, { required: ["b"] }] }, { '{"a":1e999,"b":1}': false, '{"b":1}': true, '{"a":1e999}': false, "{}": false }],
  ["too large for a double: a member with the schema {}", { type: "object", not: { properties: { a: {} }, required: ["a"] } }, { '{"a":1e999}': false }],
  ["too large for a double: contains at most one", { type: "array", contains: { required: ["a"] }, maxContains: 1 }, { '[{"a":1},{"a":1e999}]': false, '[{"a":1}]': true, '[{"a":1e999}]': false }],
  ["too large for a double: dependentSchemas with not", { type: "object", dependentSchemas: { guest: { not: { required: ["role"] } } } }, { '{"guest":1,"role":1e999}': false, '{"guest":1}': true }],
  ["too large for a double: allOf that says nothing, under not", { type: "object", not: { properties: { a: { allOf: [{}, {}] } } } }, { '{"a":1e999}': false, "{}": false }],
  ["too large for a double: a rule about strings, under not", { type: "object", not: { properties: { a: { minLength: 3 } } } }, { '{"a":1e999}': false, '{"a":5}': false, '{"a":"ab"}': true }],
  ["too large for a double: items under not", { type: "array", not: { items: { maxLength: 2 } } }, { "[1e999]": false, "[5]": false, '["abc"]': true }],
  ["too large for a double: both arms of oneOf", { oneOf: [{ properties: { c: { maxLength: 2 } } }, { type: "object" }] }, { '{"c":1e999}': false, '{"c":"abc"}': true }],
  ["too large for a double: a number under not", { type: "object", not: { required: ["level"], properties: { level: { type: "number" } } } }, { '{"level":1e999}': false, '{"level":7}': false, '{"level":"x"}': true }],
  ["too large for a double: a number under if", { type: "object", if: { required: ["amount"], properties: { amount: { type: "number" } } }, then: { properties: { amount: { maximum: 100 } } } }, { '{"amount":1e999}': false, '{"amount":101}': false, '{"amount":100}': true }],
  ["too large for a double: contains none", { type: "array", contains: { type: "number" }, minContains: 0, maxContains: 0 }, { "[1e999]": false, "[1]": false, '["a"]': true }],
  ["too large for a double: two of them are not told apart, under not", { type: "array", not: { uniqueItems: true } }, { "[1e999,2e999]": false, "[[1e999],[2e999]]": false, '[{"a":1e999},{"a":2e999}]': false, "[-1e999,-2e999]": false, "[1,1]": true, "[1,2]": false }],
  ["too large for a double: two of them are not told apart, under if", { type: "array", if: { uniqueItems: true }, then: false }, { "[1e999,2e999]": false, "[1,1]": true, "[1,2]": false }],
  ["too large for a double: beside an arm that says nothing", { anyOf: [{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, {}] }, { '{"a":1e999}': true, '{"a":"s"}': true }],
  ["too large for a double: items in one arm of oneOf", { type: "array", oneOf: [{ items: { type: "number" } }, {}] }, { "[1e999]": false, "[1]": false, '["a"]': true }],
];

/** Other documents that the type is given, by their URIs. */
export const trapsWithDocuments: [name: string, schema: unknown, documents: Record<string, unknown>, cases: Record<string, Expected>][] = [
  ["another document by a URN", { $ref: "urn:example:b" }, { "urn:example:b": { type: "string" } }, { '"s"': true, "1": false }],
  ["a place in another document", { $ref: "http://x.test/a.json#/$defs/t" }, { "http://x.test/a.json": { $defs: { t: { type: "number" } } } }, { "1": true, '"s"': false }],
  ["another document through another", { $ref: "http://x.test/a.json" }, { "http://x.test/a.json": { $ref: "http://x.test/b.json" }, "http://x.test/b.json": { properties: { q: { type: "number" } } } }, { '{"q":1}': true, '{"q":"s"}': false }],
  ["a document that nothing refers to has no part in the type", { type: "string" }, { "http://x.test/unused.json": { bad: 1 } }, { '"s"': true, "1": false }],
  ["a misspelled keyword in another document", { $ref: "http://x.test/a.json" }, { "http://x.test/a.json": { $ref: "http://x.test/b.json" }, "http://x.test/b.json": { properties: { q: { bad: true } } } }, { "{}": true }],
  ["another document of a draft that is refused", { $ref: "http://x.test/a#/$defs/t" }, { "http://x.test/a": { $schema: draft2019, $defs: { t: { prefixItems: [{ type: "string" }], items: { type: "number" } } } } }, { '["a",1]': false }],
  ["a keyword that is refused, elsewhere in another document", { $ref: "http://x.test/a#/$defs/t" }, { "http://x.test/a": { $defs: { t: { type: "number" }, u: { unevaluatedItems: false } } } }, { "1": true }],
];

export type ValueTrap = [name: string, schema: unknown, values: Record<string, Expected>];

const whatJSONCannotHold = ["undefined", "NaN", "Infinity", "-Infinity", "10n", 'Symbol("s")', "() => 1", "class {}"];
const each = (expected: Expected) => Object.fromEntries(whatJSONCannotHold.map(source => [source, expected]));

/** Values that reach `validate` and that no text spells: a request without a body, `Number(query)`, `.nan` in YAML, a structured clone. Each key is a TypeScript expression. */
export const valuesThatNoTextSpells: ValueTrap[] = [
  ["{} takes everything", {}, each(true)],
  ["true takes everything", true, each(true)],
  ["annotations alone take everything", { title: "t", description: "d" }, each(true)],
  ["not a string", { not: { type: "string" } }, each(false)],
  ["not not a string", { not: { not: { type: "string" } } }, each(false)],
  ["not a rule about numbers", { not: { minimum: 1 } }, each(false)],
  ["minLength", { minLength: 1 }, each(false)],
  ["maximum", { maximum: 1 }, each(false)],
  ["multipleOf", { multipleOf: 1 }, each(false)],
  ["format", { format: "date" }, each(false)],
  ["pattern", { pattern: "a" }, each(false)],
  ["properties", { properties: { a: {} } }, each(false)],
  ["required of nothing", { required: [] }, each(false)],
  ["patternProperties", { patternProperties: { a: {} } }, each(false)],
  ["propertyNames", { propertyNames: {} }, each(false)],
  ["maxProperties", { maxProperties: 9 }, each(false)],
  ["dependentRequired", { dependentRequired: { a: ["b"] } }, each(false)],
  ["dependentSchemas", { dependentSchemas: { a: {} } }, each(false)],
  ["items", { items: {} }, each(false)],
  ["uniqueItems", { uniqueItems: true }, each(false)],
  ["contains none", { contains: {}, minContains: 0 }, each(false)],
  ["if then", { if: { type: "number" }, then: { minimum: 0 } }, each(false)],
  ["if that refuses, without else", { if: { type: "string" }, then: false }, each(false)],
  ["oneOf", { oneOf: [{ type: "string" }, { minimum: 0 }] }, each(false)],
  ["anyOf of rules", { anyOf: [{ minimum: 0 }, { minLength: 1 }] }, each(false)],
  ["allOf of rules", { allOf: [{ minimum: 0 }, { minLength: 1 }] }, each(false)],
  ["every type", { type: ["null", "boolean", "number", "string", "array", "object"] }, each(false)],
  ["enum", { enum: [null, 0, "", false] }, each(false)],
  ["const null", { const: null }, each(false)],
  ["in a member", { properties: { a: { not: { type: "string" } } } }, { "({ a: NaN })": false, "({ a: 10n })": false, "({ a: () => 1 })": false, '({ a: Symbol("s") })': false, "({ a: Infinity })": false }],
  ["in an element", { items: { not: { type: "string" } } }, { "[NaN]": false, "[undefined]": false, "[10n]": false, "[() => 1]": false, '[Symbol("s")]': false }],
  ["in a member, below not", { type: "object", not: { properties: { a: { minLength: 3 } } } }, { "({ a: NaN })": false, "({ a: 10n })": false, "({ a: () => 1 })": false, '({ a: Symbol("s") })': false }],
  ["a member that not requires", { type: "object", not: { required: ["a"] } }, { "({ a: NaN })": false, "({ a: 10n })": false, "({ a: () => 1 })": false, '({ a: Symbol("s") })': false }],
  ["an element, where contains allows none", { type: "array", contains: { type: "number" }, minContains: 0, maxContains: 0 }, { "[NaN]": false, "[Infinity]": false }],
  ...belowWhatTurnsRound(
    (name, schema, sourceOf, isElement): ValueTrap => [
      name,
      schema,
      Object.fromEntries([
        ...[...whatJSONCannotHold.filter(source => source !== "undefined"), ...(isElement ? ["undefined", ","] : [])].map(source => ["(" + sourceOf(source) + ")", false]),
        ["(" + sourceOf("1") + ")", true],
        ["(" + sourceOf('"x"') + ")", false],
      ]),
    ],
  ),
  ["oneOf of a type and everything", { oneOf: [{ type: "string" }, {}] }, each(false)],
  ["uniqueItems: twice what is no JSON value", { uniqueItems: true }, { "[NaN, NaN]": false, "[undefined, undefined]": false, "[10n, 10n]": false }],

  ["a hole: type array", { type: "array" }, { "[,]": false, "[1, , 2]": false, "Array(3)": false, "Array(4294967295)": false }],
  ["a hole: uniqueItems", { uniqueItems: true }, { "[, 1]": false, "[, undefined]": false }],
  ["a hole: items under not", { type: "array", not: { items: { type: "number" } } }, { "[,]": false, '["a", ,]': false }],
  ["a hole: items under if", { type: "array", if: { items: { type: "number" } }, else: true, then: false }, { "[,]": false }],
  ["a hole: items in one arm of oneOf", { type: "array", oneOf: [{ items: { type: "number" } }, {}] }, { "[,]": false }],
  ["a hole: contains none", { type: "array", contains: { type: "number" }, minContains: 0, maxContains: 0 }, { "[,]": false }],
  ["a hole: an optional element", { prefixItems: [{ type: "number" }, { type: "string" }], items: { type: "boolean" } }, { "[1, , true]": false, "[, 'a']": false, "[1, 'a', , true]": false }],

  ["undefined is no optional element", { prefixItems: [{ type: "number" }, { type: "string" }], items: false }, { "[1, undefined]": false, "[undefined]": false, "[undefined, 'a']": false }],
  ["undefined is no element of the rest", { prefixItems: [{ type: "number" }, { type: "string" }], items: { type: "boolean" } }, { "[1, 'a', undefined]": false, "[1, undefined, true]": false }],
];
