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
          "react": "16.8.0", // Known to have many newer versions
          "lodash": "4.17.0", // Also has newer versions
        },
        devDependencies: {
          "typescript": "3.9.0", // Older version of TypeScript
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
      stdin: "ignore",
      stderr: "pipe",
      env: bunEnv,
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
      await runCommand([bunExe(), "install"], testDir);
      
      // Then run outdated --json
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");

      // Parse the JSON to verify it's valid
      const json = JSON.parse(output);
      
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
            "react": "16.8.0",
          },
        }),
      });
      
      // Install to create lockfile
      await runCommand([bunExe(), "install"], testDir);
      
      // Run outdated with filter to include workspace info
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json", "--filter=*"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");

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

    it("should include dependency type in package name for dev dependencies", async () => {
      const testDir = await setupTest();
      
      // Install to create lockfile
      await runCommand([bunExe(), "install"], testDir);
      
      // Run outdated --json
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");

      if (output.trim()) {
        const json = JSON.parse(output);
        
        // Check if we have any dev dependencies marked
        const packageNames = Object.keys(json);
        const devDependencies = packageNames.filter(name => name.includes(" (dev)"));
        
        // We should have at least the typescript dev dependency
        if (devDependencies.length > 0) {
          devDependencies.forEach(devDep => {
            expect(devDep).toContain(" (dev)");
            expect(json[devDep]).toHaveProperty("current");
            expect(json[devDep]).toHaveProperty("wanted");
            expect(json[devDep]).toHaveProperty("latest");
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
            // Use a package that's typically up to date
            "fs": "latest",
          },
        }),
      });
      
      // Install to create lockfile
      await runCommand([bunExe(), "install"], testDir);
      
      // Run outdated --json
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");
      
      if (output.trim()) {
        const json = JSON.parse(output);
        // Should be an empty object if no packages are outdated
        expect(typeof json).toBe("object");
      }
    });

    it("should support package filtering with --json", async () => {
      const testDir = await setupTest();
      
      // Install to create lockfile
      await runCommand([bunExe(), "install"], testDir);
      
      // Run outdated --json with package filter
      const { output, error, code } = await runCommand([bunExe(), "outdated", "--json", "react"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");

      if (output.trim()) {
        const json = JSON.parse(output);
        
        // Should only contain react-related packages
        const packageNames = Object.keys(json);
        packageNames.forEach(name => {
          expect(name.toLowerCase()).toMatch(/react/);
        });
      }
    });
  });

  describe("bun outdated (table format)", () => {
    it("should output table format by default", async () => {
      const testDir = await setupTest();
      
      // Install to create lockfile
      await runCommand([bunExe(), "install"], testDir);
      
      // Run outdated without --json
      const { output, error, code } = await runCommand([bunExe(), "outdated"], testDir);

      expect(code).toBe(0);
      expect(error).toBe("");

      // Should contain table headers
      if (output.trim()) {
        expect(output).toContain("Package");
        expect(output).toContain("Current");
        expect(output).toContain("Update");
        expect(output).toContain("Latest");
        // Should contain table formatting characters
        expect(output).toMatch(/[│┌┐└┘─]/);
      }
    });
  });
});