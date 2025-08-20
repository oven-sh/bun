import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";

describe("autoinstall with security provider", () => {
  test("should disable autoinstall when security provider is configured", async () => {
    const dir = tempDirWithFiles("autoinstall-security", {
      "index.js": "import isEven from 'is-even'; console.log(isEven(2));",
      "bunfig.toml": `
[install]
auto = "force"  # This should be overridden by security provider

[install.security]
provider = "example-security-provider"
`,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "index.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Should not autoinstall when security provider is set
    expect(normalizeBunSnapshot(stderr?.toString("utf8") || "", dir)).toMatchInlineSnapshot(`
      "error: Cannot find package 'is-even' from '<dir>/index.js'

      Bun v<bun-version>+b30ae0956 (macOS arm64)"
    `);
    expect(exitCode).not.toBe(0);
  });

  test("should allow autoinstall without security provider", async () => {
    const dir = tempDirWithFiles("autoinstall-no-security", {
      "index.js": "import isEven from 'is-even'; console.log(isEven(2));",
      "bunfig.toml": `
[install]
auto = "force"  # Should work without security provider
`,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "index.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Should autoinstall when no security provider is set
    expect(normalizeBunSnapshot(stdout?.toString("utf8") || "", dir)).toMatchInlineSnapshot(`"true"`);
    expect(normalizeBunSnapshot(stderr?.toString("utf8") || "", dir)).toMatchInlineSnapshot(`""`);
    expect(exitCode).toBe(0);
  });

  test.each(["-i", "--install=force", "--install=fallback"])("CLI flag %s should be disabled when security provider is configured and show warning", async (flag) => {
    const dir = tempDirWithFiles("autoinstall-security-cli", {
      "index.js": "import isEven from 'is-even'; console.log(isEven(2));",
      "bunfig.toml": `
[install.security]
provider = "example-security-provider"
`,
    });

    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), flag, "index.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrStr = stderr?.toString("utf8") || "";
    
    // Should show warning about autoinstall being disabled
    expect(stderrStr).toContain("warning: Autoinstall is disabled because a security provider is configured");
    
    // Should not autoinstall even with explicit CLI flags when security provider is set
    expect(stderrStr).toContain("error: Cannot find package 'is-even'");
    expect(exitCode).not.toBe(0);
  });
});
