import { describe, expect, test } from "bun:test";
import { rm, writeFile, mkdir, exists, cp } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "bun";

describe("esbuild integration test", () => {
  test("install and use esbuild", async () => {
    const packageDir = mkdtempSync(join(realpathSync(tmpdir()), "bun-esbuild-test-"));

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "bun-esbuild-test",
        version: "1.0.0",
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "esbuild@0.19.8"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(out).toContain("esbuild@0.19.8");
    expect(await exited).toBe(0);

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "esbuild", "--version"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toBe("");
    expect(out).toContain("0.19.8");
    expect(await exited).toBe(0);

    await rm(packageDir, { recursive: true, force: true });
  });

  test("install and use estrella", async () => {
    const packageDir = mkdtempSync(join(realpathSync(tmpdir()), "bun-ebuild-estrella-test-"));

    await rm(packageDir, { recursive: true, force: true });
  });
});
