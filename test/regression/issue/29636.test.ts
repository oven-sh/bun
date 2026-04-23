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

  test("strips surrounding double-quotes from PATH segments (matches libuv/node-which)", () => {
    // Windows PATH entries can be double-quoted — required when the
    // directory itself contains `;`, and sometimes added by installers or
    // manual System-Properties edits. libuv's `search_path`, npm's
    // `node-which` (used by cross-spawn), and cmd.exe all strip a wrapping
    // pair before probing. Without the strip, `path.join('"…"', 'bun.cmd')`
    // retains the literal quotes and `existsSync` misses.
    using dir = tempDir("issue-29636-quoted", { "bun.cmd": "@echo off\r\n" });
    const result = resolveCommand("bun", { PATH: `"${String(dir)}"`, PATHEXT: ".cmd" }, "win32");
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

  test("with both `PATH` and `Path` present, lexicographically-first (PATH) wins — matches Node spawn dedup", () => {
    // This mirrors `{...process.env, ...userEnv}` on Windows, where
    // `process.env`'s canonical `Path` is inserted first and a user's
    // launch.json `"env": {"PATH": ...}` override is inserted second.
    // Node's spawn on Windows sorts env keys and keeps the first
    // case-insensitive match — so `PATH` < `Path` < `path` by ASCII,
    // and `PATH` (the user's override) is what the child actually runs
    // with. `resolveCommand` must walk the same one, or we'd resolve
    // `bun` from the system PATH while the spawned process sees the
    // user's override and ends up running a different binary.
    using dirSystem = tempDir("issue-29636-system", { "bun.exe": "MZ" });
    using dirUser = tempDir("issue-29636-user", { "bun.exe": "MZ" });
    const result = resolveCommand(
      "bun",
      {
        // Insertion order intentionally simulates `{...process.env, ...userEnv}`:
        // `Path` (canonical Windows casing) first, then uppercase `PATH` override.
        Path: String(dirSystem),
        PATH: String(dirUser),
        PATHEXT: ".exe",
      },
      "win32",
    );
    // The user's `PATH` should win here, matching what Node's spawn will
    // actually hand to the child.
    expect(result).toEqual({ command: join(String(dirUser), "bun.exe"), useShell: false });
  });
});

describe("issue #29636 — buildShellCommand", () => {
  // These tests assert the *exact* command-line string we feed to cmd.exe
  // via `windowsVerbatimArguments: true`. The encoding matches cross-spawn's
  // parse.js with `doubleEscapeMetaChars: true` for .cmd/.bat targets:
  //
  // - The whole body is wrapped in `"..."` for cmd.exe `/s` to strip.
  // - The command is caret-escaped ONCE (it's used to locate the program,
  //   not re-interpreted as a batch-line body).
  // - Each arg is wrapped (qntm-style for embedded `"`) and then
  //   caret-escaped TWICE so one caret layer survives into the shim's own
  //   cmd.exe re-parse when `%*` expands. Without the second pass, an arg
  //   like `fetch("http://a?x=1&y=2")` would split the command on `&` in
  //   the shim's batch context (the BatBadBut pattern).

  test('no-metachar tokens: each argument gets `^^^"…^^^"` wrapping', () => {
    // After both cmd.exe parses consume their caret layer, the debuggee
    // sees argv = [bun.cmd, run, dev].
    expect(buildShellCommand("bun.cmd", ["run", "dev"])).toBe(`"bun.cmd ^^^"run^^^" ^^^"dev^^^""`);
  });

  test("spaces in the command path survive (the npm-wrapper scenario)", () => {
    // `%APPDATA%\npm\bun.cmd` sits under a username that commonly contains
    // a space (`John Doe`). The command path is caret-escaped once (`John^
    // Doe`); the argument's space is part of the per-arg double pass, so
    // it shows up as `^^^ ` between the inner quotes.
    const cmdPath = "C:\\Users\\John Doe\\AppData\\Roaming\\npm\\bun.cmd";
    const programArg = "C:\\Users\\John Doe\\project\\app.ts";
    expect(buildShellCommand(cmdPath, [programArg])).toBe(
      `"C:\\Users\\John^ Doe\\AppData\\Roaming\\npm\\bun.cmd ^^^"C:\\Users\\John^^^ Doe\\project\\app.ts^^^""`,
    );
  });

  test('literal `"` in an arg is backslash-escaped (qntm) then double caret-escaped', () => {
    // `CommandLineToArgvW`'s rules: inside `"..."` a `"` must be `\"`.
    // qntm's algorithm escapes `"` as `\"` and doubles any preceding run
    // of `\`. Then the whole line is double caret-escaped so neither the
    // outer cmd.exe nor the shim's inner cmd enter quote-state.
    // Target argv[1] = `say "hi"`.
    expect(buildShellCommand("foo.cmd", ['say "hi"'])).toBe(`"foo.cmd ^^^"say^^^ \\^^^"hi\\^^^"^^^""`);
  });

  test("cmd metacharacters (& | < > etc.) survive the batch-file re-parse", () => {
    // This is the BatBadBut case claude[bot] flagged: the shim re-parses
    // `%*` in batch context where `\` is NOT an escape. Without the second
    // caret layer, `\"…\"` would toggle quote-state in the shim and an
    // inner `&` would be treated as a command separator. Double caret
    // escaping keeps the second layer for that inner parse to consume.
    expect(buildShellCommand("foo.cmd", ["--flag=a&b"])).toBe(`"foo.cmd ^^^"--flag=a^^^&b^^^""`);
  });

  test('embedded `"` + metachar (the BatBadBut pattern) stays intact', () => {
    // `fetch("http://a?x=1&y=2")` — the `&` sits between two embedded `"`
    // bytes in the arg. Single caret-escape is NOT enough: after the
    // outer cmd consumes it, the shim's re-parse sees `"fetch(\"...\")"`
    // where `\"` toggles quote-state (because `\` isn't an escape in
    // batch) and the `&` falls outside, splitting the command. Double
    // caret-escape survives both parses.
    expect(buildShellCommand("foo.cmd", ['fetch("http://a?x=1&y=2")'])).toBe(
      `"foo.cmd ^^^"fetch^^^(\\^^^"http://a?x=1^^^&y=2\\^^^"^^^)^^^""`,
    );
  });

  test("empty args list still produces a well-formed wrapped body", () => {
    // No args at all — the body is just the (caret-escaped) command and
    // the wrapper strips to `bun.cmd` for cmd.exe to execute.
    expect(buildShellCommand("bun.cmd", [])).toBe(`"bun.cmd"`);
  });

  test("`%` is caret-escaped (twice) so neither cmd parse expands `%VAR%`", () => {
    // cmd.exe does `%VAR%` expansion in phase 1 BEFORE quote recognition
    // in phase 2 — at BOTH the outer and the shim's inner parses. Double
    // caret-escape defeats both: the outer phase-1 scanner sees `PATH^`
    // (undefined), then phase 2 strips one caret; the shim's phase-1
    // scanner sees `PATH^` again, and its phase 2 strips the last caret.
    expect(buildShellCommand("foo.cmd", ["--flag=%PATH%"])).toBe(`"foo.cmd ^^^"--flag=^^^%PATH^^^%^^^""`);
  });

  test("a lone `%` round-trips through without introducing a literal caret", () => {
    // Regression guard: the earlier `^%`-inside-quotes attempt corrupted
    // common cases like `%20` and trailing `%` with literal carets. With
    // the cross-spawn scheme every caret is consumed across the two
    // parses, so the debuggee receives the byte unchanged.
    expect(buildShellCommand("foo.cmd", ["file%20name"])).toBe(`"foo.cmd ^^^"file^^^%20name^^^""`);
    expect(buildShellCommand("foo.cmd", ["80%"])).toBe(`"foo.cmd ^^^"80^^^%^^^""`);
  });
});

describe("issue #29636 — escapeMultilineArgsForCmd", () => {
  // cmd.exe's phase-2 parser ends the command at any unescaped `\n`, and
  // there's no caret sequence that produces a literal LF in a cmd command
  // line (`^<LF>` is line continuation, which removes both bytes). So any
  // multi-line content in argv would be silently truncated at the first
  // newline. This helper spots the only case the debug adapter produces
  // multi-line argv (VS Code's "Run/Debug Unsaved Code" → `--eval <src>`)
  // and rewrites it into a file named `[eval]` in `cwd` — matching the
  // exact path the VS Code extension's source-mapping layer expects, so
  // breakpoints set in the untitled editor still bind to the running
  // script and relative imports resolve from `cwd` like they would with
  // `--eval` inline. Files outside the `--eval <source>` pattern have no
  // safe transformation and throw with a clear error.

  test("passes single-line args through unchanged and returns a no-op cleanup", () => {
    const { args, cleanup } = escapeMultilineArgsForCmd(["--watch", "app.ts"]);
    expect(args).toEqual(["--watch", "app.ts"]);
    // cleanup is safe to call even when nothing needs cleaning up.
    expect(() => cleanup()).not.toThrow();
  });

  test("rewrites `--eval <multi-line-source>` to `<cwd>/[eval]`", () => {
    // The npm-wrapper Windows + Unsaved Code scenario. Before this helper
    // the multi-line source reached cmd.exe intact and silently truncated
    // at the first `\n`. After: bun runs `<cwd>/[eval]` instead — exactly
    // the path VS Code's debug-adapter source-mapping layer expects for
    // `--eval` scripts, so breakpoints still bind.
    using dir = tempDir("issue-29636-eval", {});
    const source = "console.log(1);\nconsole.log(2);\n";
    const { args, cleanup } = escapeMultilineArgsForCmd(["--watch", "--eval", source], String(dir));
    try {
      expect(args).toEqual(["--watch", join(String(dir), "[eval]")]);
      expect(existsSync(args[1])).toBe(true);
      expect(readFileSync(args[1], "utf8")).toBe(source);
    } finally {
      cleanup();
      // After cleanup the temp file must be gone — leaking would accumulate
      // `[eval]` files in user project directories over repeated sessions.
      expect(existsSync(args[1])).toBe(false);
    }
  });

  test("accepts `-e` as an alias for `--eval`", () => {
    // bun's short-flag form. Handle it the same way.
    using dir = tempDir("issue-29636-eval-e", {});
    const source = "throw new Error('oops');\nprocess.exit(1);\n";
    const { args, cleanup } = escapeMultilineArgsForCmd(["-e", source], String(dir));
    try {
      expect(args).toEqual([join(String(dir), "[eval]")]);
      expect(readFileSync(args[0], "utf8")).toBe(source);
    } finally {
      cleanup();
    }
  });

  test("throws a clear, actionable error for multi-line args outside the `--eval` pattern", () => {
    // A multi-line arg without a preceding `--eval`/`-e` has no safe
    // transformation — we'd be guessing at bun's semantics. Refuse with a
    // message that points users toward the official installer fix.
    //
    // `#spawn` lets this error propagate up to `launch()`'s catch, which
    // surfaces `.message` verbatim via the stderr output event — so the
    // message content matters for UX, not just "some error was thrown".
    using dir = tempDir("issue-29636-throw", {});
    let caught: Error | undefined;
    try {
      escapeMultilineArgsForCmd(["app.ts", "line1\nline2"], String(dir));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // The user-facing stderr output will be `Failed to start debugger.\n${message}`,
    // so the message needs to explain both *what* failed and *how to fix*.
    expect(caught!.message).toMatch(/multi-line/i);
    expect(caught!.message).toMatch(/cmd\.exe/);
    expect(caught!.message).toMatch(/official installer/i);
    // The helper cleans up any already-created files on the throw path;
    // no `[eval]` should be left behind in the cwd.
    expect(existsSync(join(String(dir), "[eval]"))).toBe(false);
  });

  test("handles `\\r\\n` line endings, not just `\\n`", () => {
    // Windows-style line endings should trigger the same rewrite —
    // phase 1.5 of cmd strips `<CR>` but the `<LF>` still ends the line.
    using dir = tempDir("issue-29636-crlf", {});
    const source = "line1\r\nline2\r\n";
    const { args, cleanup } = escapeMultilineArgsForCmd(["--eval", source], String(dir));
    try {
      expect(args).toEqual([join(String(dir), "[eval]")]);
      expect(readFileSync(args[0], "utf8")).toBe(source);
    } finally {
      cleanup();
    }
  });

  test("rewrite path matches the VS Code extension's `bunEvalPath` derivation", () => {
    // This is the whole point of placing the file at `<cwd>/[eval]`.
    // bun-vscode/src/features/debug.ts:314 derives:
    //     bunEvalPath = join(cwd, "[eval]")
    // and exact-string-compares against Bun's reported script URL. The
    // file we materialise must sit at that exact path, otherwise the
    // extension's outgoing `setBreakpoints` rewrite (untitled-doc → eval
    // path) and incoming `scriptParsed` rewrite (eval path → untitled
    // doc) both miss and breakpoints go unverified.
    using dir = tempDir("issue-29636-bunevalpath", {});
    const expectedBunEvalPath = join(String(dir), "[eval]");
    const { args, cleanup } = escapeMultilineArgsForCmd(["--eval", "x\ny"], String(dir));
    try {
      expect(args[0]).toBe(expectedBunEvalPath);
    } finally {
      cleanup();
    }
  });

  test("refuses to overwrite a pre-existing `<cwd>/[eval]` file", () => {
    // Someone else owns the file at the target path — could be a leftover
    // from a prior crashed debug session, or an intentional file with that
    // name. Silently overwriting and then `rmSync`-ing it on cleanup would
    // destroy their data. Throw early with a message that names the path
    // and points at the workaround.
    using dir = tempDir("issue-29636-collision", { "[eval]": "existing content" });
    const existingPath = join(String(dir), "[eval]");
    let caught: Error | undefined;
    try {
      escapeMultilineArgsForCmd(["--eval", "new\nsource"], String(dir));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toContain(existingPath);
    expect(caught!.message).toMatch(/already exists/);
    // The pre-existing file must NOT have been touched — neither its
    // content nor its existence should have changed.
    expect(existsSync(existingPath)).toBe(true);
    expect(readFileSync(existingPath, "utf8")).toBe("existing content");
  });
});
