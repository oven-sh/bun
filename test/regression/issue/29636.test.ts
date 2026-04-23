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
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import {
  buildShellCommand,
  escapeMultilineArgsForCmd,
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

  test("accepts case-variant env keys (`Path`, `path`, `Pathext`)", () => {
    // Windows env vars are case-insensitive at the OS layer but JS exposes
    // them as-is. Node's process.env preserves whatever casing the launching
    // shell used, so we must scan for any case variant.
    using dir = tempDir("issue-29636", { "bun.exe": "MZ" });
    expect(resolveCommand("bun", { Path: String(dir), PATHEXT: ".exe" }, "win32")).toEqual({
      command: join(String(dir), "bun.exe"),
      useShell: false,
    });
    expect(resolveCommand("bun", { path: String(dir), PATHEXT: ".exe" }, "win32")).toEqual({
      command: join(String(dir), "bun.exe"),
      useShell: false,
    });
    // PATHEXT needs the same treatment — a mixed-case Pathext key from a
    // shell that folds casing should still drive extension resolution,
    // otherwise we silently fall back to the default list.
    expect(resolveCommand("bun", { PATH: String(dir), Pathext: ".exe" }, "win32")).toEqual({
      command: join(String(dir), "bun.exe"),
      useShell: false,
    });
    expect(resolveCommand("bun", { PATH: String(dir), pathext: ".exe" }, "win32")).toEqual({
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
  // These tests assert the *exact* command-line string we feed to cmd.exe
  // via `windowsVerbatimArguments: true`. The encoding matches cross-spawn's
  // parse.js: wrap the whole body in `"..."` for cmd.exe `/s` to strip, and
  // within the body caret-escape every metacharacter (including the
  // per-token `"` wrappers) so cmd.exe never enters quote-state in phase 2.
  // Every `^` is then consumed as an escape, the original `"` wrappers
  // survive through to `CommandLineToArgvW` as ordinary quote characters,
  // and `%VAR%` expansion in phase 1 is defeated without leaving literal
  // carets in the debuggee's argv.

  test('no-metachar tokens: each argument gets `^"…^"` wrapping', () => {
    // After cmd.exe `/s` strips the outer quotes and phase 2 consumes the
    // carets, the target sees: `bun.cmd "run" "dev"` → argv `[bun.cmd, run, dev]`.
    expect(buildShellCommand("bun.cmd", ["run", "dev"])).toBe(`"bun.cmd ^"run^" ^"dev^""`);
  });

  test("spaces in the command path survive (the npm-wrapper scenario)", () => {
    // `%APPDATA%\npm\bun.cmd` sits under a username that commonly contains
    // a space (`John Doe`). The unquoted command gets its space caret-
    // escaped (`John^ Doe`), and the argument's space is caret-escaped
    // inside the wrapped+caret-escaped form.
    const cmdPath = "C:\\Users\\John Doe\\AppData\\Roaming\\npm\\bun.cmd";
    const programArg = "C:\\Users\\John Doe\\project\\app.ts";
    expect(buildShellCommand(cmdPath, [programArg])).toBe(
      `"C:\\Users\\John^ Doe\\AppData\\Roaming\\npm\\bun.cmd ^"C:\\Users\\John^ Doe\\project\\app.ts^""`,
    );
  });

  test('literal `"` in an arg is backslash-escaped (qntm) then caret-escaped', () => {
    // `CommandLineToArgvW`'s rules: inside `"..."` a `"` must be `\"`.
    // qntm's algorithm escapes `"` as `\"` and doubles any preceding run
    // of `\`. Then the whole line is caret-escaped so cmd's phase 2
    // doesn't enter quote-state. Target receives argv[1] = `say "hi"`.
    expect(buildShellCommand("foo.cmd", ['say "hi"'])).toBe(`"foo.cmd ^"say^ \\^"hi\\^"^""`);
  });

  test("cmd metacharacters (& | < > etc.) are caret-escaped literally", () => {
    // Without caret-escaping, `&` would be a command separator in phase 2.
    // With caret-escaping via our single pass, `^&` is consumed to leave a
    // literal `&` that reaches argv unchanged.
    expect(buildShellCommand("foo.cmd", ["--flag=a&b"])).toBe(`"foo.cmd ^"--flag=a^&b^""`);
  });

  test("empty args list still produces a well-formed wrapped body", () => {
    // No args at all — the body is just the (caret-escaped) command and
    // the wrapper strips to `bun.cmd` for cmd.exe to execute.
    expect(buildShellCommand("bun.cmd", [])).toBe(`"bun.cmd"`);
  });

  test("`%` is caret-escaped so cmd.exe phase-1 doesn't expand `%VAR%`", () => {
    // This is the trickiest case: cmd.exe does `%VAR%` expansion in parsing
    // phase 1 BEFORE quote recognition in phase 2. A plain `"--flag=%PATH%"`
    // would expand to the user's PATH before any quoting takes effect. And
    // a naive `"--flag=^%PATH^%"` (carets inside a quote-wrapper) fails the
    // other way — inside a quoted region `^` is LITERAL, so carets leak to
    // the debuggee. cross-spawn's trick: escape EVERY cmd metachar including
    // the wrapping quotes. Because `"` appears as `^"` everywhere, phase 2
    // never enters quote-state, so every caret is consumed and phase 1's
    // var-name scanner sees `PATH^` (undefined) → nothing is expanded.
    expect(buildShellCommand("foo.cmd", ["--flag=%PATH%"])).toBe(`"foo.cmd ^"--flag=^%PATH^%^""`);
  });

  test("a lone `%` round-trips through without introducing a literal caret", () => {
    // Regression guard: the previous `^%`-inside-quotes attempt corrupted
    // common cases like `%20` and trailing `%`. With cross-spawn's pattern
    // the `^` is consumed by phase 2 (because it's outside quote-state),
    // so the debuggee receives the byte unchanged.
    expect(buildShellCommand("foo.cmd", ["file%20name"])).toBe(`"foo.cmd ^"file^%20name^""`);
    expect(buildShellCommand("foo.cmd", ["80%"])).toBe(`"foo.cmd ^"80^%^""`);
  });
});

describe("issue #29636 — escapeMultilineArgsForCmd", () => {
  // cmd.exe's phase-2 parser ends the command at any unescaped `\n`, and
  // there's no caret sequence that produces a literal LF in a cmd command
  // line (`^<LF>` is line continuation, which removes both bytes). So any
  // multi-line content in argv would be silently truncated at the first
  // newline. This helper spots the only case the debug adapter produces
  // multi-line argv (VS Code's "Run/Debug Unsaved Code" → `--eval <src>`)
  // and rewrites it into a temp-file program path, or rejects the spawn
  // with a clear error when no safe transformation exists.

  test("passes single-line args through unchanged and returns a no-op cleanup", () => {
    const { args, cleanup } = escapeMultilineArgsForCmd(["--watch", "app.ts"]);
    expect(args).toEqual(["--watch", "app.ts"]);
    // cleanup is safe to call even when nothing needs cleaning up.
    expect(() => cleanup()).not.toThrow();
  });

  test("rewrites `--eval <multi-line-source>` to a temp file path", () => {
    // The npm-wrapper Windows + Unsaved Code scenario. Before this helper
    // the multi-line source reached cmd.exe intact and silenced truncated
    // at the first `\n`. After: bun gets a concrete file to run.
    const source = "console.log(1);\nconsole.log(2);\n";
    const { args, cleanup } = escapeMultilineArgsForCmd(["--watch", "--eval", source]);
    try {
      expect(args.length).toBe(2); // --watch + <tempfile>
      expect(args[0]).toBe("--watch");
      expect(args[1]).not.toBe("--eval");
      expect(args[1]).toMatch(/eval\.ts$/);
      expect(existsSync(args[1])).toBe(true);
      expect(readFileSync(args[1], "utf8")).toBe(source);
    } finally {
      cleanup();
      // After cleanup the temp file must be gone — leaking would accumulate
      // eval sources in the OS temp dir over repeated debug sessions.
      expect(existsSync(args[1])).toBe(false);
    }
  });

  test("accepts `-e` as an alias for `--eval`", () => {
    // bun's short-flag form. Handle it the same way.
    const source = "throw new Error('oops');\nprocess.exit(1);\n";
    const { args, cleanup } = escapeMultilineArgsForCmd(["-e", source]);
    try {
      expect(args.length).toBe(1);
      expect(readFileSync(args[0], "utf8")).toBe(source);
    } finally {
      cleanup();
    }
  });

  test("throws a clear error for multi-line args outside the `--eval` pattern", () => {
    // A multi-line arg without a preceding `--eval`/`-e` has no safe
    // transformation — we'd be guessing at bun's semantics. Refuse with a
    // message that points users toward the official installer fix.
    expect(() => escapeMultilineArgsForCmd(["app.ts", "line1\nline2"])).toThrow(/cmd\.exe/);
    // Should not leak any temp files when it throws. (Difficult to assert
    // directly without listing tmpdir; the helper's implementation cleans
    // up its own dirs on failure — see the throw path.)
  });

  test("handles `\\r\\n` line endings, not just `\\n`", () => {
    // Windows-style line endings should trigger the same rewrite —
    // phase 1.5 of cmd strips `<CR>` but the `<LF>` still ends the line.
    const source = "line1\r\nline2\r\n";
    const { args, cleanup } = escapeMultilineArgsForCmd(["--eval", source]);
    try {
      expect(args.length).toBe(1);
      expect(readFileSync(args[0], "utf8")).toBe(source);
    } finally {
      cleanup();
    }
  });
});
