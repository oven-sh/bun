// https://github.com/oven-sh/bun/issues/29636
//
// On Windows, child_process.spawn("bun", ...) from the VS Code debug adapter
// fails with `Error: spawn EINVAL`. Node's spawn does not apply PATHEXT
// resolution, and since the CVE-2024-27980 hardening it refuses to launch
// .cmd/.bat files without `shell: true`. Bun installed via the npm wrapper
// lives on PATH as `bun.cmd`, so `spawn("bun", ...)` hits both problems at
// once and fails before the debugger ever connects.
//
// Fix: WebSocketDebugAdapter now resolves bare command names to their absolute
// .exe/.cmd path via PATH + PATHEXT before handing them to spawn. Exposed as
// the `resolveCommand` helper so this regression stays pinned down.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resolveCommand } from "../../../packages/bun-debug-adapter-protocol/src/debugger/adapter.ts";

/**
 * Build an ad-hoc PATH directory containing `files`. Each key is a filename
 * (e.g. `"bun.cmd"`); each value is the file body. The files are written with
 * executable permissions so the host OS won't reject them for reasons
 * unrelated to the test.
 */
function makePathDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-29636-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
    try {
      chmodSync(full, 0o755);
    } catch {}
  }
  return dir;
}

describe("issue #29636 — resolveCommand", () => {
  test("is a no-op on POSIX platforms", () => {
    // On non-Windows hosts `spawn` already walks PATH on its own. The helper
    // must not second-guess that or it risks resolving to the wrong binary.
    expect(resolveCommand("bun", { PATH: "/does/not/exist" }, "linux")).toBe("bun");
    expect(resolveCommand("bun", { PATH: "/does/not/exist" }, "darwin")).toBe("bun");
  });

  // NOTE: PATHEXT in these tests is lowercase so the extensions we supply
  // match the files we create on disk regardless of the host filesystem's
  // case-sensitivity. Real Windows NTFS is case-insensitive so `.CMD` in
  // PATHEXT happily matches a `bun.cmd` file; we're only spoofing `win32`
  // here, so we keep casings aligned to avoid a Linux-only false failure.

  test("resolves a bare `bun` to `bun.cmd` (the reported scenario)", () => {
    // This is the exact reproduction from the bug report: the npm wrapper
    // places `bun.cmd` on PATH, and the debug adapter spawns `"bun"`. Before
    // the fix spawn returned EINVAL; now we hand spawn the absolute .cmd path.
    const dir = makePathDir({ "bun.cmd": "@echo off\r\necho hi\r\n" });
    const result = resolveCommand("bun", { PATH: dir, PATHEXT: ".com;.exe;.bat;.cmd" }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("prefers `.exe` over `.cmd` when both are on PATH (PATHEXT order)", () => {
    // When a real `bun.exe` is alongside an npm-wrapper `bun.cmd`, PATHEXT
    // dictates which one wins. `.exe` typically comes first, matching
    // Windows' own behaviour.
    const dir = makePathDir({
      "bun.cmd": "@echo off\r\n",
      "bun.exe": "MZ", // PE magic; contents don't matter for this lookup
    });
    const result = resolveCommand("bun", { PATH: dir, PATHEXT: ".exe;.cmd" }, "win32");
    expect(result).toBe(join(dir, "bun.exe"));
  });

  test("respects a reversed PATHEXT (`.cmd` before `.exe`)", () => {
    // A user-configured PATHEXT that lists `.cmd` first must be honoured —
    // otherwise we'd silently override their preference.
    const dir = makePathDir({
      "bun.cmd": "@echo off\r\n",
      "bun.exe": "MZ",
    });
    const result = resolveCommand("bun", { PATH: dir, PATHEXT: ".cmd;.exe" }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("returns the original command when nothing matches on PATH", () => {
    // Falling through to `spawn` lets it emit the usual ENOENT. Swallowing
    // that would hide genuine "command missing" diagnostics from users.
    const dir = makePathDir({});
    expect(resolveCommand("bun", { PATH: dir, PATHEXT: ".exe;.cmd" }, "win32")).toBe("bun");
  });

  test("leaves absolute paths untouched", () => {
    // If the caller already supplied an absolute path, the PATH walk is
    // noise — and worse, it could shadow the explicit path with a different
    // binary found earlier on PATH.
    const dir = makePathDir({ "bun.cmd": "@echo off\r\n" });
    const abs = join(dir, "bun.cmd");
    expect(resolveCommand(abs, { PATH: dir }, "win32")).toBe(abs);
  });

  test("leaves relative paths containing separators untouched", () => {
    // `spawn` handles these relative to `cwd`; we don't want to second-
    // guess which directory the user meant.
    expect(resolveCommand(`.${sep}bun`, { PATH: "" }, "win32")).toBe(`.${sep}bun`);
    expect(resolveCommand("tools/bun", { PATH: "" }, "win32")).toBe("tools/bun");
  });

  test("leaves commands that already have an extension untouched", () => {
    // If the caller explicitly asked for `bun.exe` / `bun.cmd` we honour
    // their choice and don't re-resolve it.
    expect(resolveCommand("bun.exe", { PATH: "" }, "win32")).toBe("bun.exe");
    expect(resolveCommand("bun.cmd", { PATH: "" }, "win32")).toBe("bun.cmd");
  });

  test("skips empty PATH entries without spuriously matching CWD", () => {
    // Windows PATH routinely contains `;;` separators or trailing `;`.
    // An empty path segment must not degenerate into a lookup in the
    // current directory, which could pick up a hostile `bun.cmd` in CWD.
    const dir = makePathDir({ "bun.cmd": "@echo off\r\n" });
    const result = resolveCommand("bun", { PATH: `;${dir};`, PATHEXT: ".cmd" }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("accepts case-variant env keys (`Path`, `path`)", () => {
    // Windows env vars are case-insensitive at the OS layer but JS exposes
    // them as-is. Node's process.env preserves whatever casing the launching
    // shell used, so we must check all three common spellings.
    const dir = makePathDir({ "bun.exe": "MZ" });
    expect(resolveCommand("bun", { Path: dir, PATHEXT: ".exe" }, "win32")).toBe(join(dir, "bun.exe"));
    expect(resolveCommand("bun", { path: dir, PATHEXT: ".exe" }, "win32")).toBe(join(dir, "bun.exe"));
  });
});
