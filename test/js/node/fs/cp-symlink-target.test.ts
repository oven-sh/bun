/**
 * This test runs under `bun test` and (via node:test/node:assert) under
 * `node --experimental-strip-types --test`.
 *
 * On Linux/FreeBSD, Bun's native fs.cp fallback for symlinks used to call
 * symlink(src, dest) — creating a link whose *target string* was the path of
 * the source symlink instead of what the source symlink pointed at. Every
 * copied link therefore pointed back into the source tree, and removing the
 * source left them dangling. The fix reads the source link's target with
 * readlink() first and, since the native fast path only runs when
 * verbatimSymlinks is not set, resolves a relative target against dirname(src)
 * like Node does.
 */
import assert from "node:assert";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

// On Windows the copied link's target comes from GetFinalPathNameByHandleW,
// which returns the filesystem's canonical case (e.g. C:\Windows\Temp), while
// paths built from os.tmpdir() carry the environment's case (e.g.
// C:\Windows\TEMP). They name the same file, so compare case-insensitively.
const normPath = process.platform === "win32" ? (p: string) => p.toLowerCase() : (p: string) => p;

function makeFixture() {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cp-symlink-"));
  const origTarget = path.join(base, "target.txt");
  fs.writeFileSync(origTarget, "hello");
  fs.mkdirSync(path.join(base, "from"));
  fs.writeFileSync(path.join(base, "from", "keep"), "");

  // Absolute target — exercises the isAbsolute fast path.
  const srcAbs = path.join(base, "from", "abs_link");
  fs.symlinkSync(origTarget, srcAbs);

  // Relative target — exercises the dirname(src) resolve path.
  const srcRel = path.join(base, "from", "rel_link");
  fs.symlinkSync(path.join("..", "target.txt"), srcRel);

  return { base, origTarget, srcAbs, srcRel };
}

function check(base: string, origTarget: string, srcAbs: string, srcRel: string) {
  for (const [which, srcLink] of [
    ["abs_link", srcAbs],
    ["rel_link", srcRel],
  ] as const) {
    const copiedLink = path.join(base, "to", which);
    assert.ok(fs.lstatSync(copiedLink).isSymbolicLink(), `copied ${which} should be a symlink`);

    // The copied link's target string must not be the path of the source
    // symlink. With the bug, readlink(copiedLink) returned srcLink.
    const copiedTarget = fs.readlinkSync(copiedLink);
    assert.notStrictEqual(
      normPath(copiedTarget),
      normPath(srcLink),
      `copied ${which} target must not be the source symlink path (got ${copiedTarget})`,
    );
    assert.strictEqual(
      normPath(fs.realpathSync(copiedLink)),
      normPath(fs.realpathSync(origTarget)),
      `copied ${which} must resolve to the original target`,
    );
  }

  // Deleting the source tree must not break the absolute link, since its
  // target lives outside the source tree. With the bug, the copied link
  // pointed at from/abs_link and would dangle once from/ was removed.
  fs.rmSync(path.join(base, "from"), { recursive: true, force: true });
  assert.strictEqual(
    fs.readFileSync(path.join(base, "to", "abs_link"), "utf8"),
    "hello",
    "copied abs_link must remain valid after the source tree is removed",
  );
}

describe("fs.cp preserves symlink targets instead of linking back to the source path", () => {
  test("fs.cpSync", () => {
    const { base, origTarget, srcAbs, srcRel } = makeFixture();
    try {
      fs.cpSync(path.join(base, "from"), path.join(base, "to"), { recursive: true });
      check(base, origTarget, srcAbs, srcRel);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("fs.promises.cp", async () => {
    const { base, origTarget, srcAbs, srcRel } = makeFixture();
    try {
      await fsp.cp(path.join(base, "from"), path.join(base, "to"), { recursive: true });
      check(base, origTarget, srcAbs, srcRel);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
