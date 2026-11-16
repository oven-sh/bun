// --trim keeps a class of Intl or Temporal where code in sight makes an instance or names the class. A method that is called on a value of unknown type works on every instance that can exist.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

// `unknown` hides its argument from the compiler, and lets every name from run time in.
const unknown = `const unknown = new Function("value", process.argv[9] ?? "return value");\n`;
const programs: Record<string, [string, string[], string]> = {
  "a collator": [`console.log(unknown(new Intl.Collator("en")).compare("a", "b"));`, [], "-1\n"],
  "a collator out of a destructured Intl": [
    `const { Collator } = Intl;\nconsole.log(unknown(new Collator("en")).compare("b", "a"));`,
    [],
    "1\n",
  ],
  "a class of Intl that is named on an unknown value": [
    `console.log(new (unknown(Intl).Collator)("en").compare("a", "a"));`,
    [],
    "0\n",
  ],
  "a class of Intl that is named on a global object from a text": [
    `console.log(new (unknown(0) ?? 0, new Function(process.argv[2])().Intl.PluralRules)("en").select(1));`,
    ["return globalThis"],
    "one\n",
  ],
  "a segmenter and its segments": [
    `for (const { segment } of unknown(new Intl.Segmenter("en")).segment("ab")) console.log(segment);`,
    [],
    "a\nb\n",
  ],
  "the iterator of segments": [
    `console.log(unknown(unknown(new Intl.Segmenter("en")).segment("ab"))[Symbol.iterator]().next().value.segment);`,
    [],
    "a\n",
  ],
  "a number that is printed for a locale": [`console.log(unknown(1234.5).toLocaleString("en"));`, [], "1,234.5\n"],
  "a date that is printed for a locale": [
    `console.log(unknown(new Date(0)).toLocaleDateString("en", { timeZone: "UTC" }));`,
    [],
    "1/1/1970\n",
  ],
  "strings that are compared for a locale": [`console.log(unknown("a").localeCompare("b"));`, [], "-1\n"],
  "an instance whose class is read off it": [
    `const made = unknown(new Intl.Collator("en"));\nconsole.log(new made.constructor("en").compare("a", "b"));`,
    [],
    "-1\n",
  ],
  "an instance in a container": [
    `const made = new Map([["key", new Intl.ListFormat("en")]]);\nconsole.log(unknown(made).get("key").format(["a", "b"]));`,
    [],
    "a and b\n",
  ],
  "an instance that a worker's message does not carry but a closure does": [
    `const make = () => new Intl.RelativeTimeFormat("en");\nconsole.log(unknown(make)().format(-1, "day"));`,
    [],
    "1 day ago\n",
  ],
  "a duration": [
    `console.log(String(unknown(Temporal.Duration.from({ hours: 1 })).add({ minutes: 1 })));`,
    [],
    "PT1H1M\n",
  ],
  "a Temporal class that is named on an unknown value": [
    `console.log(String(unknown(Temporal).PlainDate.from("2020-01-01").add({ days: 1 })));`,
    [],
    "2020-01-02\n",
  ],
  "an instant from a date": [
    `console.log(String(unknown(new Date(0)).toTemporalInstant()));`,
    [],
    "1970-01-01T00:00:00Z\n",
  ],
  "the clock": [`console.log(typeof unknown(Temporal.Now).instant().epochMilliseconds);`, [], "number\n"],
};

if (!canTrim)
  console.error("SKIPPED: trimmed-intl-and-temporal-instances.test.ts: this build of Bun doesn't support --trim");

(canTrim && !unsupported ? describe : describe.skip)("in a trimmed executable", () => {
  test.each(Object.keys(programs))(
    "%s",
    title =>
      slot(async () => {
        const [text, args, expected] = programs[title];
        using dir = tempDir("trimmed-intl-instances", { "program.js": unknown + text + "\n" });
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...withoutDebugInformation, "--aot", "program.js", "--outfile"];
        built(await spawned([...build, "whole"], folder, bunEnv));
        built(await spawned([...build, "trimmed", "--trim"], folder, bunEnv));
        const whole = await spawned([join(folder, "whole"), ...args], folder, bunEnv);
        const trimmed = await spawned([join(folder, "trimmed"), ...args], folder, bunEnv);
        expect({ title, whole: whole.stdout, trimmed: trimmed.stdout, stderr: trimmed.stderr }).toEqual({
          title,
          whole: expected,
          trimmed: expected,
          stderr: "",
        });
      }),
    600_000,
  );
});
