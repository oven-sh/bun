// Bun's ICU reads its data in forms of its own (oven-sh/icu), and the data leaves out what nothing in Bun can reach.
// These tests ask for all of it, through the APIs that anybody uses, and compare the answers with those of ICU's own data.
//
// The answers are hashed by subject: a locale, a collation, a block of code points. When one is wrong, ask the same
// of a build that is right and compare: `sections[name].ask(subject, console.log, await readInputs())`.
//
// When ICU is bumped, `generate.ts` says how to write the fixtures again.
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, isMacOS } from "harness";
import { readExpected } from "./fixtures";
import { ask } from "./pool";
import { sections } from "./questions";

// The data is the same bytes in every build, so a build that is many times slower asks about a sample.
const every = isDebug ? 200 : isASAN ? 10 : 1;
const names = Object.keys(sections);

// Not on macOS, where the data is the system's, of whatever version that has.
describe.skipIf(isMacOS)("ICU's data", () => {
  const answers = isMacOS ? undefined : ask(names, every);
  const expected = readExpected();

  test.each(names)(
    "%s",
    async name => {
      const found = await answers!.get(name)!;
      const wanted = new Map([...(await expected)].filter(([key]) => key.startsWith(name + "/")));
      expect(found.size).toBe(Math.ceil(wanted.size / every));
      expect([...found].filter(([key, hash]) => wanted.get(key) !== hash).map(([key]) => key)).toEqual([]);
    },
    180_000,
  );
});
