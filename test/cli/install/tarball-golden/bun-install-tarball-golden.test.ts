// Tarballs of every shape the tar reader knows about, well formed and damaged, with what
// `bun install` made of each one when it was recorded. See record.ts.
import { describe, expect, test } from "bun:test";
import { bunExe, isLinux, isMacOS, isWindows } from "harness";
import { join } from "node:path";
import { loadCases } from "../../../js/bun/archive-golden/observe";
import { install, type Case } from "./install";

const all = await loadCases<Case>(join(import.meta.dir, "cases.json.gz"));
const cases = all
  .map((c, id) => ({ ...c, id }))
  // Recorded on Linux. Names outside ASCII are decoded differently on Windows, and neither its file
  // systems nor those of macOS take every name.
  .filter(c => isLinux || ((isMacOS ? c.mac : c.win) && !/[^\x20-\x7e\n]|[:*?<>|\\]|^link /m.test(c.tree ?? "")));
// Windows has no permission bits.
const comparable = (tree: string | null | undefined) => (isWindows ? tree?.replace(/^(\w+ ".*") \d+/gm, "$1") : tree);

// One `bun install` per group, small enough for a debug build to finish in time.
const groups = <T>(of: T[]) =>
  Array.from({ length: Math.ceil(of.length / 60) }, (_, i) => [of.slice(i * 60, i * 60 + 60)]);
const accepted = cases.filter(c => c.tree !== null);
const refused = cases.filter(c => c.tree === null);

test("there are cases for this platform", () => {
  expect(accepted.length).toBeGreaterThan(50);
  expect(refused.length).toBeGreaterThan(20);
});

describe.each([
  ["while they download", true],
  ["from memory", false],
])("tarballs extracted %s", (_, streaming) => {
  test.each(groups(accepted))("are installed the way it was recorded", async group => {
    const { trees, exitCode } = await install(bunExe(), group, streaming);
    const different = group
      .filter(c => comparable(trees.get(c.id)) !== comparable(c.tree))
      .map(c => `case ${c.id}\n--- expected\n${c.tree}--- actual\n${trees.get(c.id)}`);
    expect(different.slice(0, 5).join("\n")).toBe("");
    expect(exitCode).toBe(0);
  });

  test.each(groups(refused))("are refused if they were when it was recorded", async group => {
    const { trees, exitCode, stderr } = await install(bunExe(), group, streaming);
    expect(group.filter(c => trees.get(c.id) !== null).map(c => c.id)).toEqual([]);
    // Only the streaming extractor says how far into the download it got.
    expect(stderr.includes("(at byte ")).toBe(streaming);
    expect(exitCode).toBe(1);
  });
});
