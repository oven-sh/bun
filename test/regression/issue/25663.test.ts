import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/25663 (the Windows
// console raw-mode problem; this is the restore-after-child-exit half).
//
// On Windows, a child spawned with an inherited console stdin
// can switch the shared console input buffer back to cooked mode
// (ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT). libuv's uv_tty_set_mode caches the
// last mode it applied and early-returns for the same mode, so it never
// re-applies raw mode and an interactive TUI is left with cooked, echoed,
// line-buffered stdin. spawnProcessWindows now snapshots the console input mode
// before the child runs and restores it on exit (windows_console_in_snapshot /
// windows_console_in_restore in src/spawn/process.rs; WindowsConsoleInGuard in
// the src/runtime/api/bun/process.zig porting reference).
//
// IMPORTANT: the cooking child must be a *non-Bun* process. Bun restores its own
// console mode on exit (Bun__restoreWindowsStdio in src/bun_core/output.rs), so
// a Bun child self-heals and would mask the bug — making the test pass with or
// without the fix. We use a PowerShell P/Invoke that cooks the shared buffer and
// exits without restoring, exactly like cmd.exe / PowerShell / git / node do in
// the wild.
//
// We need a real console to observe this, so the scenario runs inside a
// Bun.Terminal (ConPTY). process.stdin.isRaw only reflects libuv's cache — the
// exact thing that is wrong here — so the parent reads the *actual* console mode
// via bun:ffi GetConsoleMode instead.

// PowerShell cooker: switch the shared console input buffer to cooked mode and
// write "<before> <after>" so the parent can confirm the cook actually landed
// (otherwise the test could pass vacuously if the child never cooked).
const COOKER_PS1 = String.raw`
param([string]$OutFile)
$sig = @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
  [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
}
"@
Add-Type -TypeDefinition $sig
$h = [K]::GetStdHandle(-10)
[uint32]$before = 0; [void][K]::GetConsoleMode($h, [ref]$before)
[void][K]::SetConsoleMode($h, (0x1 -bor 0x2 -bor 0x4))
[uint32]$aft = 0; [void][K]::GetConsoleMode($h, [ref]$aft)
"$before $aft" | Set-Content -Path $OutFile -Encoding ascii
`;

// Parent role — runs inside the ConPTY so there is a real console.
const PARENT = /* ts */ `
import { dlopen, FFIType, ptr } from "bun:ffi";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const k32 = dlopen("kernel32.dll", {
  GetStdHandle: { args: [FFIType.u32], returns: FFIType.ptr },
  GetConsoleMode: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});

const STD_INPUT_HANDLE = 0xfffffff6; // (DWORD)-10
const ENABLE_LINE_INPUT = 0x0002;
const stdinHandle = k32.symbols.GetStdHandle(STD_INPUT_HANDLE);

function consoleMode(): number | null {
  const buf = new Uint32Array(1);
  if (k32.symbols.GetConsoleMode(stdinHandle, ptr(buf)) === 0) return null;
  return buf[0];
}

const dir = dirname(import.meta.path);
const cooker = join(dir, "cook.ps1");
const outFile = join(dir, "cook.out");

const initial = consoleMode();
if (initial === null) {
  // No real console (ConPTY unavailable) — report so the test can skip rather
  // than assert on a meaningless value.
  console.log("RESULT:" + JSON.stringify({ error: "stdin is not a console" }));
  process.exit(0);
}

process.stdin.setRawMode(true);
const rawMode = consoleMode() ?? 0;

// Spawn a non-Bun child that inherits this console and cooks it.
Bun.spawnSync({
  cmd: ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", cooker, "-OutFile", outFile],
  stdio: ["inherit", "inherit", "inherit"],
  env: process.env,
});

const afterChild = consoleMode() ?? 0;

// Did the child actually cook the shared buffer? (precondition guard so the
// assertion below can't pass vacuously.)
let childCooked = false;
try {
  const parts = readFileSync(outFile, "utf8").trim().split(/\\s+/);
  childCooked = (Number(parts[1]) & ENABLE_LINE_INPUT) !== 0;
} catch {}

console.log(
  "RESULT:" +
    JSON.stringify({
      rawHasLineInput: (rawMode & ENABLE_LINE_INPUT) !== 0,
      childCooked,
      afterHasLineInput: (afterChild & ENABLE_LINE_INPUT) !== 0,
    }),
);
`;

test.if(isWindows)("console raw mode is restored after a non-Bun child cooks the console", async () => {
  const dir = tempDirWithFiles("win32-console-restore", {
    "parent.ts": PARENT,
    "cook.ps1": COOKER_PS1,
  });

  let output = "";
  const { promise: gotResult, resolve } = Promise.withResolvers<void>();

  await using terminal = new Bun.Terminal({
    cols: 200,
    data(_term, data) {
      output += Buffer.from(data).toString("latin1");
      if (output.includes("RESULT:")) resolve();
    },
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "parent.ts")],
    env: bunEnv,
    terminal,
  });

  await Promise.race([gotResult, proc.exited]);
  await proc.exited;

  const line = output.split(/\r?\n/).find(l => l.includes("RESULT:"));
  expect(line, `expected a RESULT line, got:\n${output}`).toBeDefined();
  const result = JSON.parse(line!.slice(line!.indexOf("RESULT:") + "RESULT:".length));

  // If ConPTY isn't available the scenario can't run; don't assert on noise.
  if (result.error) return;

  // setRawMode(true) must really clear line input on the OS console...
  expect(result.rawHasLineInput).toBe(false);
  // ...the non-Bun child must actually have cooked the shared buffer (otherwise
  // this test would pass vacuously)...
  expect(result.childCooked).toBe(true);
  // ...and raw mode must still be in effect after the child cooked and exited.
  // Without the fix the child's cooked mode leaks and this assertion fails.
  expect(result.afterHasLineInput).toBe(false);
});
