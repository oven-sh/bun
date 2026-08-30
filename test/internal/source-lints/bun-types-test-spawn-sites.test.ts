import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// test/integration/bun-types/bun-types.test.ts type-checks the whole fixture directory
// (test/integration/bun-types/fixture/*.ts), so the assertions for a .d.ts change belong
// in the fixture, where every case checks them. #34573 instead added a case that spawned
// tsc over an inline snippet for one API, and that block became the template: within a
// month a couple of dozen open PRs had each added a copy for their own API, duplicating
// assertions already in the fixture and conflicting with each other. #39270 replaced it
// with a single case that spawns the fixture's own tsc over the whole fixture. Every one
// of those copies spawned a compiler, so holding the file at one spawn site is what keeps
// the template from coming back.
const lintedFile = "test/integration/bun-types/bun-types.test.ts";

test(`${lintedFile} spawns a compiler in exactly one place`, () => {
  const source = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", lintedFile), "utf8");

  const spawnSites = source
    .split("\n")
    .flatMap((line, index) =>
      /\bBun\.spawn(Sync)?\(/.test(line) ? [`${lintedFile}:${index + 1}: ${line.trim()}`] : [],
    );

  expect(
    spawnSites,
    `${lintedFile} should spawn a compiler once, over the whole fixture. To cover a .d.ts change, add the assertions to test/integration/bun-types/fixture/*.ts instead of a tsc run of their own. Spawn sites:\n${spawnSites.join("\n")}`,
  ).toHaveLength(1);
});
