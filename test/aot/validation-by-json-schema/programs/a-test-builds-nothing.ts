// A type under Not, If, OneOf, AllOf, Contains, PatternProperties, PropertyNames or DependentSchemas is a test. It fills no default and builds nothing:
// the result is what the rest of the type describes.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { finish, yields } from "./check";

type Filled = { d?: number & Schema.Default<5> };
type Base = { a?: number };

type UnderIf = Base & Schema.If<Filled, Filled, Filled>;
type UnderNot = Base & Schema.Not<Filled & { never: 1 }>;
type UnderOneOf = Base & Schema.OneOf<[Filled, Filled & { never: 1 }]>;
type UnderAllOf = Base & Schema.AllOf<[Filled, Filled]>;
type UnderDependentSchemas = Base & Schema.DependentSchemas<{ a: Filled }>;
type UnderContains = Base[] & Schema.Contains<Filled>;
type UnderPatternProperties = Base & Schema.PatternProperties<{ "^x": Filled }>;

yields("if", '{"a":1}', () => validate<UnderIf>({ a: 1 }));
yields("not", '{"a":1}', () => validate<UnderNot>({ a: 1 }));
yields("oneOf", '{"a":1}', () => validate<UnderOneOf>({ a: 1 }));
yields("allOf", '{"a":1}', () => validate<UnderAllOf>({ a: 1 }));
yields("dependentSchemas", '{"a":1}', () => validate<UnderDependentSchemas>({ a: 1 }));
yields("contains", '[{"a":1}]', () => validate<UnderContains>([{ a: 1 }]));
yields("patternProperties", '{"x":{"a":1}}', () => validate<UnderPatternProperties>({ x: { a: 1 } }));

yields("if, by text", '{"a":1}', () => JSON.parse<UnderIf>('{"a":1}'));
yields("not, by text", '{"a":1}', () => JSON.parse<UnderNot>('{"a":1}'));
yields("oneOf, by text", '{"a":1}', () => JSON.parse<UnderOneOf>('{"a":1}'));
yields("allOf, by text", '{"a":1}', () => JSON.parse<UnderAllOf>('{"a":1}'));
yields("dependentSchemas, by text", '{"a":1}', () => JSON.parse<UnderDependentSchemas>('{"a":1}'));
yields("contains, by text", '[{"a":1}]', () => JSON.parse<UnderContains>('[{"a":1}]'));
yields("patternProperties, by text", '{"x":{"a":1}}', () => JSON.parse<UnderPatternProperties>('{"x":{"a":1}}'));

const given = { a: 1 };
validate<UnderIf>(given);
validate<UnderAllOf>(given);
yields("the value that was handed in is as it was", '{"a":1}', () => given);

finish();
