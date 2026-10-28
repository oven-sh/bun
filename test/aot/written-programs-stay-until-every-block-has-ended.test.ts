// The parts of a unit that are run together (TEST_PART=aot/every-program) are `describe` blocks of one file. Each lists the programs, and what they take is written below one folder.
import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join, sep } from "path";
import { find, isGroup, taken } from "./run-programs";

const kept = join(import.meta.dir, "programs") + sep;
const topic = "language";

describe("a block that lists the programs and takes none", () => {
  const listed = find(topic);
  test("lists programs that are yet to be written", () => {
    expect(listed.some(path => !path.startsWith(kept))).toBe(true);
  });
});

describe("a block that runs after it", () => {
  const first = find(topic).find(path => !path.startsWith(kept) && !isGroup(path));
  const written = taken(find(topic), path => path === first);
  test("finds the program that it has taken", () => {
    expect(written).toEqual([first!]);
    expect(existsSync(written[0])).toBe(true);
  });
});
