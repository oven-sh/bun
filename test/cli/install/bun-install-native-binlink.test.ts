import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, VerdaccioRegistry } from "harness";
import { join } from "path";

let verdaccio: VerdaccioRegistry;

beforeAll(async () => {
  setDefaultTimeout(1000 * 60 * 5);
  verdaccio = new VerdaccioRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

describe.skipIf(isWindows).concurrent("native binlink optimization", () => {
  for (const linker of ["hoisted", "isolated"]) {
    test(`uses platform-specific bin instead of main package bin with linker ${linker}`, async () => {
      let env = { ...bunEnv };
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      // Create bunfig
      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${verdaccio.registryUrl()}"
linker = "${linker}"
`,
      );

      // Install the main package
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: {
            "test-native-binlink": "1.0.0",
          },
          nativeDependencies: ["test-native-binlink"],
          trustedDependencies: ["test-native-binlink"],
        }),
      );

      const installProc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });

      expect(await installProc.exited).toBe(0);

      // Run the bin - it should use the platform-specific one (exit code 0)
      // not the main package one (exit code 1)
      const binProc = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });

      const [binStdout, binExitCode] = await Promise.all([binProc.stdout.text(), binProc.exited]);

      // Should exit with 0 (platform-specific) not 1 (main package)
      expect(binExitCode).toBe(0);
      expect(binStdout).toContain("SUCCESS: Using platform-specific bin");

      // Now delete the node_modules folder, keep the bun.lock, re-install
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const installProc2 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc2.exited).toBe(0);

      const binProc2 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout2, binExitCode2] = await Promise.all([binProc2.stdout.text(), binProc2.exited]);
      expect(binStdout2).toContain("SUCCESS: Using platform-specific bin");
      expect(binExitCode2).toBe(0);

      // Now do a no-op re-install.
      const installProc3 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc3.exited).toBe(0);

      const binProc3 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout3, binExitCode3] = await Promise.all([binProc3.stdout.text(), binProc3.exited]);
      expect(binStdout3).toContain("SUCCESS: Using platform-specific bin");
      expect(binExitCode3).toBe(0);

      // Now do an install with the .bin folder gone
      await rm(join(packageDir, "node_modules", ".bin"), { recursive: true, force: true });
      const installProc4 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc4.exited).toBe(0);

      const binProc4 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout4, binExitCode4] = await Promise.all([binProc4.stdout.text(), binProc4.exited]);
      expect(binStdout4).toContain("SUCCESS: Using platform-specific bin");
      expect(binExitCode4).toBe(0);
    });
  }
});
