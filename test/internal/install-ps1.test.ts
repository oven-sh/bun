/**
 * Coverage for the PowerShell scripts in the repo, mainly src/runtime/cli/install.ps1
 * (what `irm bun.sh/install.ps1 | iex` runs). The installer cannot run end to end
 * without downloading a release, so this file
 *
 *   1. lints every .ps1 for a common parameter that was given no value. PowerShell
 *      parses `Get-Command bun -ErrorAction` fine and only rejects it when the
 *      command binds its parameters, so the mistake surfaces as a runtime exception
 *      (and not at all inside a `try {} catch {}`), and
 *   2. runs the installer's "is some other bun already in PATH?" block, extracted
 *      from the script, in real Windows PowerShell and pwsh against a fake PATH.
 *
 * Part 2 needs the Windows lanes, which do not run test/internal/source-lints/,
 * which is why the lint in part 1 lives here too.
 */
import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const installScript = path.join(repoRoot, "src", "runtime", "cli", "install.ps1");

test("no PowerShell script passes a value-taking common parameter without a value", async () => {
  // Common parameters (about_CommonParameters) that take an argument. A line
  // where one of them is followed by nothing, a statement terminator, a comment,
  // or the next parameter is missing its argument.
  const dangling =
    /-(?:ErrorAction|WarningAction|InformationAction|ProgressAction|ErrorVariable|WarningVariable|InformationVariable|OutVariable|OutBuffer|PipelineVariable)\b[ \t]*(?:$|[;|)}#]|-[A-Za-z])/i;

  const violations: string[] = [];
  let scanned = 0;
  for (const root of ["src", "scripts", ".buildkite"]) {
    for await (const rel of new Glob("**/*.ps1").scan({ cwd: path.join(repoRoot, root) })) {
      scanned++;
      const relFromRepo = path.join(root, rel).replaceAll("\\", "/");
      const source = readFileSync(path.join(repoRoot, root, rel), "utf8")
        .replaceAll("\r\n", "\n")
        .replace(/<#[\s\S]*?#>/g, m => m.replace(/[^\n]/g, ""));
      for (const [index, line] of source.split("\n").entries()) {
        if (line.trimStart().startsWith("#")) continue;
        if (dangling.test(line)) violations.push(`${relFromRepo}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  // install.ps1 and uninstall.ps1 at least; guards against the scan silently
  // matching nothing if the scripts move.
  expect(scanned).toBeGreaterThanOrEqual(2);
  expect(violations).toEqual([]);
});

// The block that decides whether typing `bun` after the install would run
// something other than the bun.exe that was just installed. Its outputs are the
// warning it prints and $hasExistingOther, which the rest of the script uses to
// decide whether adding the install dir to PATH is worth anything.
function existingBunCheck(): string {
  const source = readFileSync(installScript, "utf8");
  const startMarker = "$hasExistingOther = $false";
  const endMarker = "} catch {}";
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + endMarker.length);
}

// Runs the block once per PATH layout. Mirrors what the installer has set up by
// the time the block runs: $ErrorActionPreference is Stop, $BunBin is the
// DirectoryInfo returned by `mkdir -Force`, and the string form of that object is
// what an earlier install would have written into PATH.
const driver = (block: string) => `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
$BunBin = mkdir -Force "$PSScriptRoot\\bun\\bin"
$other = "$PSScriptRoot\\other"
$shim = "$PSScriptRoot\\npm"

$layouts = [ordered]@{
  "nothing named bun in PATH" = "$PSScriptRoot\\empty"
  "only the installed bun.exe in PATH" = "$BunBin"
  "another bun.exe in PATH" = "$other"
  "a bun.cmd shim in PATH" = "$shim"
  "another bun.exe ahead of the installed one" = "$other;$BunBin"
  "the installed one ahead of another bun.exe" = "$BunBin;$other"
}

$check = @'
${block}
'@

$results = [ordered]@{}
foreach ($name in $layouts.Keys) {
  $env:Path = $layouts[$name]
  $hasExistingOther = $null
  $warnings = @(Invoke-Expression $check 3>&1 | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
  $results[$name] = [ordered]@{
    hasExistingOther = $hasExistingOther
    warning = if ($warnings.Count -gt 0) { $warnings[0].Message } else { $null }
  }
}
$results | ConvertTo-Json -Compress -Depth 3
`;

describe.skipIf(!isWindows).concurrent("install.ps1: existing bun in PATH check", () => {
  // `powershell` (Windows PowerShell 5.1) is what the documented install command
  // uses; pwsh is what scripts/bootstrap.ps1 runs the installer with.
  test.each(["powershell", "pwsh"])("%s", async shell => {
    using dir = tempDir("install-ps1", {
      "driver.ps1": driver(existingBunCheck()),
      // Get-Command only looks at names and PATHEXT; nothing here is executed.
      "bun/bin/bun.exe": "",
      "other/bun.exe": "",
      "npm/bun.cmd": "",
      "empty/.keep": "",
    });

    await using proc = Bun.spawn({
      cmd: [
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(String(dir), "driver.ps1"),
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const otherExe = path.join(String(dir), "other", "bun.exe");
    const shimCmd = path.join(String(dir), "npm", "bun.cmd");
    const shadowed = (by: string) => ({ hasExistingOther: true, warning: expect.stringContaining(by) });
    const usesNewInstall = { hasExistingOther: false, warning: null };
    expect(JSON.parse(stdout)).toEqual({
      "nothing named bun in PATH": usesNewInstall,
      "only the installed bun.exe in PATH": usesNewInstall,
      "another bun.exe in PATH": shadowed(otherExe),
      "a bun.cmd shim in PATH": shadowed(shimCmd),
      "another bun.exe ahead of the installed one": shadowed(otherExe),
      "the installed one ahead of another bun.exe": usesNewInstall,
    });
    expect(exitCode).toBe(0);
  });
});
