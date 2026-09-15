import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawn as cpSpawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The grandchild. It reports what console it has, then appends a line to stdout
// every 100ms until the stop file exists, and exits with 42. It gives up after
// 300 lines so that a failed test cannot leave it running.
const grandchildScript = /* ps1 */ `
param([string]$StopFile)
Add-Type -Namespace Win32 -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("kernel32.dll")] public static extern uint GetConsoleCP();
[DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] list, uint count);
'@
$list = New-Object 'uint32[]' 64
$count = [Win32.Console]::GetConsoleProcessList($list, 64)
$attached = @()
for ($i = 0; $i -lt $count; $i++) { $attached += [int64]$list[$i] }
$info = @{
  pid = $PID
  hasConsole = ([Win32.Console]::GetConsoleCP() -ne 0)
  window = [Win32.Console]::GetConsoleWindow().ToInt64()
  attached = $attached
}
Write-Output ("info " + (ConvertTo-Json -Compress -InputObject $info))
for ($i = 0; $i -lt 300 -and -not (Test-Path -LiteralPath $StopFile); $i++) {
  Write-Output "tick $i"
  Start-Sleep -Milliseconds 100
}
exit 42
`;

// The intermediate process. It spawns the grandchild with ["ignore", fd, fd],
// unrefs it, prints both pids and exits. With "wait" it stays alive until the
// grandchild has reported its console, so that report is made while this
// process is still attached to its own console.
const intermediateScript = /* ts */ `
import { spawn as cpSpawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";

const [api, keepAlive, wait, log, script, stopFile] = process.argv.slice(2);
const fd = openSync(log, "a");
const cmd = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, stopFile];
const options = { stdio: ["ignore", fd, fd], windowsHide: true, windowsKeepAlive: keepAlive === "true" };

let pid;
if (api === "Bun.spawn") {
  const proc = Bun.spawn({ cmd, ...options });
  proc.unref();
  pid = proc.pid;
} else {
  const child = cpSpawn(cmd[0], cmd.slice(1), options);
  child.unref();
  pid = child.pid;
}

if (wait === "wait") {
  const deadline = Date.now() + 20_000;
  while (!/info .*\\r?\\n/.test(readFileSync(log, "utf8"))) {
    if (Date.now() > deadline) throw new Error("the grandchild did not report its console");
    await Bun.sleep(50);
  }
}
console.log(JSON.stringify({ intermediate: process.pid, grandchild: pid }));
`;

const files = { "intermediate-fixture.ts": intermediateScript, "grandchild.ps1": grandchildScript };

type GrandchildInfo = { pid: number; hasConsole: boolean; window: number; attached: number[] };

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(what: string, condition: () => boolean) {
  const deadline = Date.now() + 30_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await Bun.sleep(50);
  }
}

// Only complete lines. Windows PowerShell can start its output with a BOM.
function readLines(log: string) {
  const lines = readFileSync(log, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  lines.pop();
  return lines;
}

function readInfo(log: string): GrandchildInfo {
  return JSON.parse(
    readLines(log)
      .find(l => l.startsWith("info "))!
      .slice("info ".length),
  );
}

function tickCount(log: string) {
  return readLines(log).filter(l => l.startsWith("tick ")).length;
}

async function expectStillAppending(grandchild: number, log: string) {
  expect(isAlive(grandchild)).toBe(true);
  const before = tickCount(log);
  await until("the grandchild appends more lines", () => tickCount(log) >= before + 3);
  expect(isAlive(grandchild)).toBe(true);
}

// Runs the intermediate to completion, then `fn`, then stops the grandchild.
// The intermediate has a console of its own (windowsHide with no inherited
// stdio gives it one), so what the grandchild shares does not depend on the
// console of the test runner.
async function withGrandchild(
  options: { api: string; keepAlive: boolean; wait: boolean },
  fn: (ctx: { intermediate: number; grandchild: number; log: string }) => Promise<void>,
) {
  using dir = tempDir("windows-keep-alive", files);
  const log = join(String(dir), "grandchild.log");
  const stopFile = join(String(dir), "stop");
  let grandchild: number | undefined;
  try {
    await using intermediate = Bun.spawn({
      cmd: [
        bunExe(),
        join(String(dir), "intermediate-fixture.ts"),
        options.api,
        String(options.keepAlive),
        options.wait ? "wait" : "nowait",
        log,
        join(String(dir), "grandchild.ps1"),
        stopFile,
      ],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      intermediate.stdout.text(),
      intermediate.stderr.text(),
      intermediate.exited,
    ]);
    expect({ stdout: stdout.trim().startsWith("{"), stderr, exitCode }).toEqual({
      stdout: true,
      stderr: "",
      exitCode: 0,
    });
    const pids = JSON.parse(stdout) as { intermediate: number; grandchild: number };
    grandchild = pids.grandchild;
    // The intermediate has exited. Its job object is closed.
    expect(isAlive(pids.intermediate)).toBe(false);
    await fn({ ...pids, log });
  } finally {
    writeFileSync(stopFile, "");
    if (grandchild !== undefined) {
      const pid = grandchild;
      await until("the grandchild exits", () => !isAlive(pid)).catch(() => {
        if (isAlive(pid)) process.kill(pid);
      });
    }
  }
}

describe.skipIf(!isWindows)("windowsKeepAlive", () => {
  describe.each(["Bun.spawn", "child_process.spawn"])("%s", api => {
    test.concurrent("the child has a hidden console of its own and outlives the parent", async () => {
      await withGrandchild({ api, keepAlive: true, wait: true }, async ({ grandchild, log }) => {
        // Reported while the intermediate was alive: it is not on this console.
        expect(readInfo(log)).toEqual({ pid: grandchild, hasConsole: true, window: 0, attached: [grandchild] });
        await expectStillAppending(grandchild, log);
      });
    });

    test.concurrent(
      "without it, a windowsHide child shares the parent's console and dies with the parent",
      async () => {
        await withGrandchild({ api, keepAlive: false, wait: true }, async ({ intermediate, grandchild, log }) => {
          const info = readInfo(log);
          expect({ ...info, attached: info.attached.includes(intermediate) }).toEqual({
            pid: grandchild,
            hasConsole: true,
            window: 0,
            attached: true,
          });
          await until("the grandchild is terminated", () => !isAlive(grandchild));
        });
      },
    );
  });

  test.concurrent("the parent can exit right after the spawn", async () => {
    await withGrandchild({ api: "Bun.spawn", keepAlive: true, wait: false }, async ({ grandchild, log }) => {
      await until("the grandchild starts to append lines", () => tickCount(log) > 0);
      await expectStillAppending(grandchild, log);
    });
  });

  test.concurrent("Bun.spawn: exited and onExit report the exit code while the parent is alive", async () => {
    using dir = tempDir("windows-keep-alive-exit", {});
    const fd = openSync(join(String(dir), "out.log"), "a");
    try {
      const onExit = Promise.withResolvers<number | null>();
      const proc = Bun.spawn({
        cmd: ["cmd.exe", "/d", "/s", "/c", "echo hello& exit 42"],
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        windowsKeepAlive: true,
        onExit(_proc, exitCode) {
          onExit.resolve(exitCode);
        },
      });
      expect(await proc.exited).toBe(42);
      expect(await onExit.promise).toBe(42);
      expect(proc.exitCode).toBe(42);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(join(String(dir), "out.log"), "utf8").trim()).toBe("hello");
  });

  test.concurrent("child_process.spawn: 'exit' reports the exit code while the parent is alive", async () => {
    using dir = tempDir("windows-keep-alive-exit-cp", {});
    const fd = openSync(join(String(dir), "out.log"), "a");
    try {
      const child = cpSpawn("cmd.exe", ["/d", "/s", "/c", "echo hello& exit 42"], {
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        windowsKeepAlive: true,
      });
      const { promise, resolve, reject } = Promise.withResolvers<[number | null, string | null]>();
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve([code, signal]));
      expect(await promise).toEqual([42, null]);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(join(String(dir), "out.log"), "utf8").trim()).toBe("hello");
  });

  test("child_process.spawn rejects a windowsKeepAlive that is not a boolean", () => {
    expect(() => cpSpawn("cmd.exe", [], { windowsKeepAlive: "yes" as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});
