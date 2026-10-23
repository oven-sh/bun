// Tarballs of every shape the tar reader knows about, well formed and damaged, with what
// `bun install` made of each one when it was recorded. See record.ts.
import { describe, expect, test } from "bun:test";
import { bunExe, isLinux, isMacOS, isWindows } from "harness";
import { join } from "node:path";
import { install, type Case } from "./install";

const all: Case[] = JSON.parse(
  Buffer.from(Bun.gunzipSync(await Bun.file(join(import.meta.dir, "cases.json.gz")).bytes())).toString(),
);
const cases = all
  .map((c, id) => ({ ...c, id }))
  // Recorded on Linux. Names outside ASCII are decoded differently on Windows, and neither its file
  // systems nor those of macOS take every name.
  .filter(c => isLinux || ((isMacOS ? c.mac : c.win) && !/[^\x20-\x7e\n]|[:*?<>|\\]|^link /m.test(c.tree ?? "")));
// Windows has no permission bits.
const comparable = (tree: string | null | undefined) => (isWindows ? tree?.replace(/^(\w+ ".*") \d+/gm, "$1") : tree);

describe.each([
  ["while they download", true],
  ["from memory", false],
])("tarballs extracted %s", (_, streaming) => {
  test.concurrent(
    "are installed the way it was recorded",
    async () => {
      const accepted = cases.filter(c => c.tree !== null);
      expect(accepted.length).toBeGreaterThan(200);
      const { trees, exitCode, stderr } = await install(bunExe(), accepted, streaming);
      const different = accepted
        .filter(c => comparable(trees.get(c.id)) !== comparable(c.tree))
        .map(c => `case ${c.id}\n--- expected\n${c.tree}--- actual\n${trees.get(c.id)}`);
      expect(different.slice(0, 5).join("\n")).toBe("");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  test.concurrent(
    "are refused if they were when it was recorded",
    async () => {
      const refused = cases.filter(c => c.tree === null);
      expect(refused.length).toBeGreaterThan(50);
      const { trees, exitCode, stderr } = await install(bunExe(), refused, streaming);
      expect(refused.filter(c => trees.get(c.id) !== null).map(c => c.id)).toEqual([]);
      // Only the streaming extractor says how far into the download it got.
      expect(stderr.includes("(at byte ")).toBe(streaming);
      expect(exitCode).toBe(1);
    },
    60_000,
  );
});
