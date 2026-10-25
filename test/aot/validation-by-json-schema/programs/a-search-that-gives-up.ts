// A regular expression search that reaches its limit of steps has no answer. "No match" would be an accept under `Not`,
// under a pattern whose members are forbidden, and under names that must not match. The check throws a RangeError.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, endsClosed, finish, refuses, throwsRangeError } from "./check";

type Slow = Schema.Pattern<"^(a|aa)+(a|aa)+(a|aa)+(a|aa)+(a|aa)+$">;
type Matches = string & Slow;
type DoesNotMatch = string & Schema.Not<string & Slow>;
type NoSuchKey = { b?: unknown } & Schema.PatternProperties<{ "^(a|aa)+(a|aa)+(a|aa)+(a|aa)+(a|aa)+$": never }>;
type OnlySuchKeys = { b?: unknown } & Schema.PatternProperties<{ "^(a|aa)+(a|aa)+(a|aa)+(a|aa)+(a|aa)+$": number }, never>;
type SlowByCodePoints = string & Schema.Not<string & Schema.Pattern<"^(a|aa)+(a|aa)+(a|aa)+(a|aa)+(a|aa)+$", "u">>;
type NoSuchName = Record<string, unknown> & Schema.PropertyNames<string & Schema.Not<string & Slow>>;
type IfItMatches = string & Schema.If<string & Slow, never, string>;
type OneOfThem = string & Schema.OneOf<[string & Slow, string]>;
type NoneMatches = string[] & Schema.Contains<string & Slow, 0, 0>;

// `Bun.gc` is declared by bun-types, which a build does not need.
const collect = (Bun as unknown as { gc(force: boolean): void }).gc;
const hard = "a".repeat(200) + "b";
const quoted = globalThis.JSON.stringify(hard);

accepts("what matches", () => validate<Matches>("aaaaa"));
refuses("what does not", () => validate<Matches>("ab"));
refuses("not: what matches", () => validate<DoesNotMatch>("aaaaa"));
accepts("not: what does not", () => validate<DoesNotMatch>("ab"));

endsClosed("a pattern", () => validate<Matches>(hard));
throwsRangeError("not a pattern", () => validate<DoesNotMatch>(hard));
throwsRangeError("not a pattern, by text", () => JSON.parse<DoesNotMatch>(quoted));
throwsRangeError("a forbidden key", () => validate<NoSuchKey>({ [hard]: 1 }));
throwsRangeError("a forbidden key, by text", () => JSON.parse<NoSuchKey>("{" + quoted + ":1}"));
throwsRangeError("a forbidden name", () => validate<NoSuchName>({ [hard]: 1 }));
throwsRangeError("a condition", () => validate<IfItMatches>(hard));
throwsRangeError("exactly one", () => validate<OneOfThem>(hard));
throwsRangeError("contains none", () => validate<NoneMatches>([hard]));
endsClosed("a key that only a pattern could allow", () => validate<OnlySuchKeys>({ [hard]: 1 }));
throwsRangeError("not a pattern with the u flag", () => validate<SlowByCodePoints>(hard));

// A search that gave up has no answer the next time either, whatever was matched or collected in between.
for (let round = 0; round < 2; round++) {
  throwsRangeError("not a pattern, again", () => validate<DoesNotMatch>(hard));
  throwsRangeError("not a pattern, a text of wider characters", () => validate<DoesNotMatch>("a".repeat(200) + "\u0100"));
  accepts("not a pattern, what does not match, in between", () => validate<DoesNotMatch>("ab"));
  collect(true);
}

finish();
