// https://github.com/oven-sh/bun/issues/29636
//
// On Windows, child_process.spawn("bun", ...) from the VS Code debug adapter
// fails with `Error: spawn EINVAL`. Three distinct Windows-only gotchas combine
// to break the npm-installed Bun case:
//
//   1. Node's `spawn` does not walk PATHEXT, so a bare `"bun"` is never
//      auto-resolved to `bun.cmd` / `bun.exe`. When Bun is installed via the
//      npm wrapper only `bun.cmd` is discoverable on PATH (the real `.exe`
//      lives under `node_modules\bun\bin\` which is not on PATH).
//   2. Since CVE-2024-27980 (Node >= 18.20.2 / 20.12.2 / 21.7.3),
//      `ProcessWrap::Spawn` rejects any `options.file` whose extension is
//      `.bat`/`.cmd` with `EINVAL` unless `cmd.exe` is the actual file being
//      spawned. The check is suffix-based — an absolute `C:\...\bun.cmd`
//      fails the same way as a bare `bun.cmd`.
//   3. Node's built-in `shell: true` on Windows builds the final command
//      line as `[file, ...args].join(' ')` with no per-argument quoting, so
//      any space in the resolved path (e.g. `C:\Users\Name With Space\...`)
//      or in an argument breaks cmd.exe's tokenizer.
//
// Fix: `resolveCommand` walks PATH+PATHEXT to find the real file and reports
// whether a `cmd.exe` shell invocation is required. `buildShellCommand`
// constructs a properly quoted `/d /s /c` argument that survives spaces in
// paths. WebSocketDebugAdapter#spawn wires them together with
// `windowsVerbatimArguments: true` so libuv doesn't re-quote.

import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join, sep } from "node:path";
import {
  buildShellCommand,
  resolveCommand,
} from "../../../packages/bun-debug-adapter-protocol/src/debugger/adapter.ts";

describe("issue #29636 — resolveCommand", () => {
  test("is a no-op on POSIX platforms", () => {
    // On non-Windows hosts `spawn` already walks PATH on its own. The helper
    // must not second-guess that or it risks resolving to the wrong binary.
    expect(resolveCommand("bun", { PATH: "/does/not/exist" }, "linux")).toEqual({
      command: "bun",
      useShell: false,
    });
    expect(resolveCommand("bun", { PATH: "/does/not/exist" }, "darwin")).toEqual({
      command: "bun",
      useShell: false,
    });
  });

  // NOTE: PATHEXT in these tests is lowercase so the extensions we supply
  // match the files we create on disk regardless of the host filesystem's
  // case-sensitivity. Real Windows NTFS is case-insensitive so `.CMD` in
  // PATHEXT happily matches a `bun.cmd` file; we're only spoofing `win32`
  // here, so we keep casings aligned to avoid a Linux-only false failure.

  test("resolves bare `bun` to `bun.cmd` AND flags shell-required (the #29636 scenario)", () => {
    // Exact reproduction of the bug: only `bun.cmd` on PATH (npm wrapper).
    // Before the fix spawn returned EINVAL. Now the helper hands back the
    // absolute .cmd path *and* tells the caller to set `shell: true`, so
    // Node rewrites the file to cmd.exe and the CVE-2024-27980 check
    // (suffix-based, absolute path does NOT exempt us) never fires.
    using dir = tempDir("issue-29636", { "bun.cmd": "@echo off\r\necho hi\r\n" });
    const result = resolveCommand("bun", { PATH: String(dir), PATHEXT: ".com;.exe;.bat;.cmd" }, "win32");
    expect(result).toEqual({
      command: join(String(dir), "bun.cmd"),
      useShell: true,
    });
  });

  test("prefers `.exe` over `.cmd` when both are on PATH, and does NOT need shell", () => {
    // Native Bun install plus npm wrapper both on PATH: `.exe` comes first in
    // the default PATHEXT, so we resolve to the real binary and can spawn it
    // directly without shell (avoiding the cmd.exe quoting surface entirely).
    using dir = tempDir("issue-29636", {
      "bun.cmd": "@echo off\r\n",
      "bun.exe": "MZ", // PE magic; contents don't matter for this lookup
    });
    const result = resolveCommand("bun", { PATH: String(dir), PATHEXT: ".exe;.cmd" }, "win32");
    expect(result).toEqual({
      command: join(String(dir), "bun.exe"),
      useShell: false,
    });
  });

  test("respects a reversed PATHEXT (`.cmd` before `.exe`) and flags shell", () => {
    // If the user has configured PATHEXT with `.cmd` first, we honour that and
    // set useShell accordingly — same logic whether the ordering is default
    // or user-overridden.
    using dir = tempDir("issue-29636", {
      "bun.cmd": "@echo off\r\n",
      "bun.exe": "MZ",
    });
    const result = resolveCommand("bun", { PATH: String(dir), PATHEXT: ".cmd;.exe" }, "win32");
    expect(result).toEqual({
      command: join(String(dir), "bun.cmd"),
      useShell: true,
    });
  });

  test("returns the original command when nothing matches on PATH", () => {
    // Falling through to `spawn` lets it emit the usual ENOENT. Swallowing
    // that would hide genuine "command missing" diagnostics from users.
    using dir = tempDir("issue-29636", {});
    expect(resolveCommand("bun", { PATH: String(dir), PATHEXT: ".exe;.cmd" }, "win32")).toEqual({
      command: "bun",
      useShell: false,
    });
  });

  test("leaves an absolute `.exe` path untouched and does not need shell", () => {
    // If the caller already supplied an absolute `.exe` path, the PATH walk is
    // noise — and worse, it could shadow the explicit path with a different
    // binary found earlier on PATH.
    using dir = tempDir("issue-29636", { "bun.exe": "MZ" });
    const abs = join(String(dir), "bun.exe");
    expect(resolveCommand(abs, { PATH: String(dir) }, "win32")).toEqual({
      command: abs,
      useShell: false,
    });
  });

  test("flags shell when the caller passes an absolute `.cmd` path directly", () => {
    // CVE-2024-27980's batch-file check is suffix-based: an absolute .cmd
    // path hits the same EINVAL as a bare one. We must flag useShell so the
    // caller spawns through cmd.exe even when they supplied the full path.
    using dir = tempDir("issue-29636", { "bun.cmd": "@echo off\r\n" });
    const abs = join(String(dir), "bun.cmd");
    expect(resolveCommand(abs, { PATH: String(dir) }, "win32")).toEqual({
      command: abs,
      useShell: true,
    });
  });

  test("leaves relative paths containing separators untouched", () => {
    // `spawn` handles these relative to `cwd`; we don't want to second-
    // guess which directory the user meant.
    expect(resolveCommand(`.${sep}bun`, { PATH: "" }, "win32")).toEqual({
      command: `.${sep}bun`,
      useShell: false,
    });
    expect(resolveCommand("tools/bun", { PATH: "" }, "win32")).toEqual({
      command: "tools/bun",
      useShell: false,
    });
  });

  test("honours explicit `.exe` / `.cmd` extensions on bare names", () => {
    // If the caller explicitly asked for `bun.exe` we honour their choice and
    // don't re-resolve it — but we still need to flag useShell for `.cmd`.
    expect(resolveCommand("bun.exe", { PATH: "" }, "win32")).toEqual({
      command: "bun.exe",
      useShell: false,
    });
    expect(resolveCommand("bun.cmd", { PATH: "" }, "win32")).toEqual({
      command: "bun.cmd",
      useShell: true,
    });
  });

  test("skips empty PATH entries without spuriously matching CWD", () => {
    // Windows PATH routinely contains `;;` separators or trailing `;`.
    // An empty path segment must not degenerate into a lookup in the
    // current directory, which could pick up a hostile `bun.cmd` in CWD.
    using dir = tempDir("issue-29636", { "bun.cmd": "@echo off\r\n" });
    const result = resolveCommand("bun", { PATH: `;${String(dir)};`, PATHEXT: ".cmd" }, "win32");
    expect(result).toEqual({
      command: join(String(dir), "bun.cmd"),
      useShell: true,
    });
  });

  test("accepts case-variant env keys (`Path`, `path`)", () => {
    // Windows env vars are case-insensitive at the OS layer but JS exposes
    // them as-is. Node's process.env preserves whatever casing the launching
    // shell used, so we must check all three common spellings.
    using dir = tempDir("issue-29636", { "bun.exe": "MZ" });
    expect(resolveCommand("bun", { Path: String(dir), PATHEXT: ".exe" }, "win32")).toEqual({
      command: join(String(dir), "bun.exe"),
      useShell: false,
    });
    expect(resolveCommand("bun", { path: String(dir), PATHEXT: ".exe" }, "win32")).toEqual({
      command: join(String(dir), "bun.exe"),
      useShell: false,
    });
  });

  test("treats `.BAT` extension case-insensitively (matches Node's check)", () => {
    // Node's IsWindowsBatchFile check is case-insensitive — `.BAT` and `.bat`
    // both trigger EINVAL. Make sure we flag useShell consistently.
    expect(resolveCommand("wrapper.BAT", { PATH: "" }, "win32")).toEqual({
      command: "wrapper.BAT",
      useShell: true,
    });
    expect(resolveCommand("wrapper.CmD", { PATH: "" }, "win32")).toEqual({
      command: "wrapper.CmD",
      useShell: true,
    });
  });
});

describe("issue #29636 — buildShellCommand", () => {
  test("wraps a simple command and args in one outer quote pair", () => {
    // The outer pair is what `cmd /s /c` strips before handing the inner
    // text back to the tokenizer. The per-token quotes survive.
    expect(buildShellCommand("bun.cmd", ["run", "dev"])).toBe('""bun.cmd" "run" "dev""');
  });

  test("keeps spaces in the command path intact", () => {
    // This is the claude[bot] finding: Node's `shell: true` builds the
    // command string as a naive space-join, so a path like the npm global
    // prefix (which contains the Windows user's home directory, commonly
    // a name with a space) would tokenize into "C:\Users\John" and fail.
    // Our quoting puts the whole path inside one "…" token.
    const cmdPath = "C:\\Users\\John Doe\\AppData\\Roaming\\npm\\bun.cmd";
    const programArg = "C:\\Users\\John Doe\\project\\app.ts";
    expect(buildShellCommand(cmdPath, [programArg])).toBe(
      `""C:\\Users\\John Doe\\AppData\\Roaming\\npm\\bun.cmd" "C:\\Users\\John Doe\\project\\app.ts""`,
    );
  });

  test("doubles literal double quotes inside a token", () => {
    // cmd.exe's `/c` processor reads `""` as one literal `"`. Doubling is
    // the idiomatic escape and avoids tripping cmd's quote-state machine.
    // Structure:
    //   arg `say "hi"` → inner escape `say ""hi""` → wrapped `"say ""hi"""`
    //   command `foo.cmd` → wrapped `"foo.cmd"`
    //   body = `"foo.cmd" "say ""hi"""`, outer wrap yields:
    expect(buildShellCommand("foo.cmd", ['say "hi"'])).toBe('""foo.cmd" "say ""hi""""');
  });

  test("passes cmd metacharacters through double quotes unharmed", () => {
    // Inside a `"…"` region cmd.exe takes `&`, `|`, `<`, `>`, `^` literally,
    // so we don't need caret-escaping on top of quoting. This prevents a
    // launch-config arg with an `&` from being reinterpreted as a command
    // separator by cmd.exe.
    expect(buildShellCommand("foo.cmd", ["--flag=a&b"])).toBe('""foo.cmd" "--flag=a&b""');
  });

  test("handles an empty args list", () => {
    // `[].map(...).join(" ")` = `""`, so the `command + " " + ""` case must
    // still emit a well-formed wrapper with just the command.
    expect(buildShellCommand("bun.cmd", [])).toBe('""bun.cmd""');
  });
});
