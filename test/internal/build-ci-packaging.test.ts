/**
 * stageForZip() (scripts/build/ci.ts) assembles the directory that
 * packageAndUpload() zips: files are hard-linked into it instead of copied
 * (the staging dir is deleted right after zipping), directories such as the
 * darwin .dSYM bundle are copied, and anything that cannot be linked falls
 * back to a copy.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { stageForZip } from "../../scripts/build/ci.ts";

test("files are hard-linked into the staging dir, directories are copied", () => {
  using dir = tempDir("build-stage-zip", {
    "out/bun-profile": "binary",
    "out/bun-profile.dSYM/Contents/Resources/DWARF/bun-profile": "dwarf",
    "stage/.keep": "",
  });
  const root = String(dir);
  const file = join(root, "out", "bun-profile");
  const bundle = join(root, "out", "bun-profile.dSYM");

  stageForZip(file, join(root, "stage", "bun-profile"));
  stageForZip(bundle, join(root, "stage", "bun-profile.dSYM"));

  expect(readFileSync(join(root, "stage", "bun-profile"), "utf8")).toBe("binary");
  if (!isWindows) {
    expect(statSync(file).nlink).toBe(2);
  }
  expect(
    readFileSync(join(root, "stage", "bun-profile.dSYM", "Contents", "Resources", "DWARF", "bun-profile"), "utf8"),
  ).toBe("dwarf");
  // The bundle was copied, not linked: its files are independent of the originals.
  expect(statSync(join(bundle, "Contents", "Resources", "DWARF", "bun-profile")).nlink).toBe(1);
});

test("a file that cannot be linked is copied", () => {
  using dir = tempDir("build-stage-zip", { "out/features.json": "{}" });
  const root = String(dir);
  // Linking onto an existing path fails (EEXIST); the copy path overwrites it.
  using stage = tempDir("build-stage-zip-dest", { "features.json": "stale" });
  stageForZip(join(root, "out", "features.json"), join(String(stage), "features.json"));
  expect(readFileSync(join(String(stage), "features.json"), "utf8")).toBe("{}");
});
