// Regression guard for scripts/vs-shell.ps1: Enter-VsDevShell parses
// `cmd /c set` output line by line, so a multi-line env value (e.g. the
// commit message in BUILDKITE_MESSAGE) used to leak each `KEY=VALUE`-shaped
// body line as its own env var. A body line like `BUN_JSC_foo=bar baz` then
// aborted every spawned Bun process on the Windows test lanes.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";

test.skipIf(!isWindows || !existsSync(vswhere))(
  "vs-shell.ps1 shields multi-line env vars from Enter-VsDevShell",
  async () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const vsShell = join(repoRoot, "scripts", "vs-shell.ps1");
    const probe = ["line1", "VS_SHELL_LEAKED=oops", "BUN_JSC_notARealOption=1 some trailing text", "line4"].join("\n");

    const dump =
      "process.stdout.write(JSON.stringify({" +
      "probe:process.env.VS_SHELL_PROBE," +
      "leaked:process.env.VS_SHELL_LEAKED," +
      "jsc:process.env.BUN_JSC_notARealOption," +
      "vs:process.env.VSINSTALLDIR" +
      "}))";

    const env: Record<string, string | undefined> = { ...bunEnv, VS_SHELL_PROBE: probe };
    // The Windows test runner already sits inside vs-shell.ps1, so VSINSTALLDIR
    // is set; unset it so the child re-runs the loader and hits the stash path.
    delete env.VSINSTALLDIR;

    await using proc = Bun.spawn({
      cmd: ["pwsh", "-NoProfile", "-File", vsShell, bunExe(), "-e", dump],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // vs-shell.ps1 writes status lines before `$ <cmd>`; the JSON is the last line.
    const jsonLine = stdout.trimEnd().split("\n").pop() ?? "";
    let result: { probe: unknown; leaked: unknown; jsc: unknown; vs: unknown };
    try {
      result = JSON.parse(jsonLine);
    } catch {
      throw new Error(`expected JSON on last line, got:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    }

    expect(result).toEqual({
      probe, // round-tripped intact, newlines preserved
      leaked: undefined, // body line did not become its own var
      jsc: undefined, // body line did not become its own var
      vs: expect.any(String), // VS env was still loaded
    });
    expect(stderr).not.toContain("invalid JSC environment variable");
    expect(exitCode).toBe(0);
  },
);
