// The steps of all the searches of one call come out of one budget. Each search here ends below the limit of a single one, and forty of them lie far above it.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { finish, throwsRangeError } from "./check";

type Slow = Schema.Pattern<"^(a|aa)+(a|aa)+(a|aa)+(a|aa)+(a|aa)+$">;
type NoneMatches = string[] & Schema.Contains<string & Slow, 0, 0>;
type NoSuchKey = { b?: unknown } & Schema.PatternProperties<{ "^(a|aa)+(a|aa)+(a|aa)+(a|aa)+(a|aa)+$": never }>;
type NoSuchName = Record<string, unknown> & Schema.PropertyNames<string & Schema.Not<string & Slow>>;

const texts = Array.from({ length: 40 }, (_, i) => "a".repeat(18) + "b" + i);
const keys = Object.fromEntries(texts.map(text => [text, 1]));

throwsRangeError("forty elements", () => validate<NoneMatches>(texts));
throwsRangeError("forty keys", () => validate<NoSuchKey>(keys));
throwsRangeError("forty names", () => validate<NoSuchName>(keys));
throwsRangeError("forty keys, by text", () => JSON.parse<NoSuchKey>(globalThis.JSON.stringify(keys)));

finish();
