import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun outdated", () => {
  let i = 0;
  function setupTest() {
    const testDir = tempDirWithFiles("outdated-" + i++, {
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        dependencies: {
          // Use packages with known older versions for testing
          "lodash": "1.0.0", // Very old version, latest is 4.17.21
          "express": "1.0.0", // Very old version, latest is 4.x
        },
        devDependencies: {
          "typescript": "~5.0.0", // Older but valid version of TypeScript
        },
      }),
    });
    return testDir;
  }

  async function runCommand(cmd: string[], testDir: string) {
    const { stdout, stderr, exited } = Bun.spawn({
      cmd,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: {
        ...bunEnv,
        BUN_DEBUG_QUIET_LOGS: "1", // Suppress debug logs
      },
    });

    const [output, error, exitCode] = await Promise.all([
      new Response(stdout).text(),
      new Response(stderr).text(),
      exited,
    ]);

    return { output, error, code: exitCode };
  }

  describe("bun outdated --json", () => {
    it("should output outdated dependencies in JSON format", async () => {
      const testDir = await setupTest();
      
      // First install to create a lockfile
      const installResult = await runCommand([bunExe(), "install"], testDir);
      if (installResult.code !== 0) {
        console.error("Install failed:", installResult.error);
        console.error("Install stdout:", installResult.output);
      }
      expect(installResult.code).toBe(0);
      
      // Then run outdated --json
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json"], testDir);

      if (code !== 0) {
        console.error("Command failed with code:", code);
        console.error("Error output:", error);
        console.error("Stdout:", output);
      }
      expect(code).toBe(0);

      // Parse the JSON to verify it's valid
      let json;
      try {
        json = JSON.parse(output);
      } catch (e) {
        console.error("Failed to parse JSON:", e);
        console.error("Raw output:", JSON.stringify(output));
        throw e;
      }
      
      // Check that we have at least some outdated packages
      expect(Object.keys(json).length).toBeGreaterThan(0);
      
      // Check the structure of each outdated package entry
      for (const [packageName, packageInfo] of Object.entries(json)) {
        expect(packageName).toMatch(/^[a-zA-Z0-9@\/\-\._\(\) ]+$/); // Valid package name format
        expect(packageInfo).toHaveProperty("current");
        expect(packageInfo).toHaveProperty("wanted");
        expect(packageInfo).toHaveProperty("latest");
        expect(typeof (packageInfo as any).current).toBe("string");
        expect(typeof (packageInfo as any).wanted).toBe("string");
        expect(typeof (packageInfo as any).latest).toBe("string");
      }
    });

    it("should output JSON with workspace information when using filters", async () => {
      const testDir = tempDirWithFiles("outdated-workspace-" + i++, {
        "package.json": JSON.stringify({
          name: "root-pkg",
          version: "1.0.0",
          workspaces: ["./packages/*"],
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app-pkg",
          version: "1.0.0",
          dependencies: {
            "lodash": "1.0.0",
          },
        }),
      });
      
      // Install to create lockfile
      const installResult = await runCommand([bunExe(), "install"], testDir);
      expect(installResult.code).toBe(0);
      
      // Run outdated with filter to include workspace info
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json", "--filter=*"], testDir);

      expect(code).toBe(0);
      

      if (output.trim()) {
        const json = JSON.parse(output);
        
        // When using filters, we should have dependent info
        for (const [, packageInfo] of Object.entries(json)) {
          expect(packageInfo).toHaveProperty("current");
          expect(packageInfo).toHaveProperty("wanted");
          expect(packageInfo).toHaveProperty("latest");
          expect(packageInfo).toHaveProperty("dependent");
        }
      }
    });

    it("should include dependency type field for dev dependencies", async () => {
      const testDir = await setupTest();
      
      // Install to create lockfile
      const installResult = await runCommand([bunExe(), "install"], testDir);
      expect(installResult.code).toBe(0);
      
      // Run outdated --json
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json"], testDir);

      expect(code).toBe(0);
      

      if (output.trim()) {
        const json = JSON.parse(output);
        
        // Check if we have any dev dependencies with type field
        const packages = Object.entries(json);
        const devDependencies = packages.filter(([, info]) => (info as any).type === "dev");
        
        // We should have at least the typescript dev dependency if it's outdated
        if (devDependencies.length > 0) {
          devDependencies.forEach(([packageName, packageInfo]) => {
            expect((packageInfo as any).type).toBe("dev");
            expect(packageInfo).toHaveProperty("current");
            expect(packageInfo).toHaveProperty("wanted"); 
            expect(packageInfo).toHaveProperty("latest");
            // Package name should be clean (no (dev) suffix)
            expect(packageName).not.toContain(" (dev)");
          });
        }
      }
    });

    it("should output empty JSON object when no packages are outdated", async () => {
      const testDir = tempDirWithFiles("outdated-empty-" + i++, {
        "package.json": JSON.stringify({
          name: "test-pkg",
          version: "1.0.0",
          dependencies: {
            // Use a package that's already at latest version
            "lodash": "4.17.21", // This should be the latest version
          },
        }),
      });
      
      // Install to create lockfile
      const installResult = await runCommand([bunExe(), "install"], testDir);
      expect(installResult.code).toBe(0);
      
      // Run outdated --json
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json"], testDir);

      expect(code).toBe(0);
      
      
      if (output.trim()) {
        const json = JSON.parse(output);
        // Should be an empty object if no packages are outdated
        expect(typeof json).toBe("object");
        expect(Object.keys(json).length).toBe(0);
      }
    });

    it("should support package filtering with --json", async () => {
      const testDir = await setupTest();
      
      // Install to create lockfile
      const installResult = await runCommand([bunExe(), "install"], testDir);
      expect(installResult.code).toBe(0);
      
      // Run outdated --json with package filter
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json", "lodash"], testDir);

      expect(code).toBe(0);
      

      if (output.trim()) {
        const json = JSON.parse(output);
        
        // Should only contain lodash-related packages
        const packageNames = Object.keys(json);
        packageNames.forEach(name => {
          expect(name.toLowerCase()).toMatch(/lodash/);
        });
      }
    });
  });

  describe("bun outdated (table format)", () => {
    it("should output table format by default", async () => {
      const testDir = await setupTest();
      
      // Install to create lockfile
      const installResult = await runCommand([bunExe(), "install"], testDir);
      expect(installResult.code).toBe(0);
      
      // Run outdated without --json
      const { output, error, code } = await runCommand([bunExe(), "outdated"], testDir);

      expect(code).toBe(0);
      

      // Should contain table headers
      if (output.trim()) {
        expect(output).toContain("Package");
        expect(output).toContain("Current");
        expect(output).toContain("Update");
        expect(output).toContain("Latest");
                // Should contain table formatting characters (Unicode or ASCII)
        expect(output).toMatch(/[│┌┐└┘─|]/);
      }
    });
  });
});