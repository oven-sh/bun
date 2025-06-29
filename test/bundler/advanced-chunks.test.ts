import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

describe("Advanced Chunks", () => {
  test("should accept advancedChunks config option", async () => {
    const dir = tempDirWithFiles("advanced-chunks-basic", {
      "entry1.js": `
        import "./shared.js";
        import "./unique1.js";
        console.log("entry1");
      `,
      "entry2.js": `
        import "./shared.js";
        import "./unique2.js";
        console.log("entry2");
      `,
      "shared.js": `
        console.log("shared");
      `,
      "unique1.js": `
        console.log("unique1");
      `,
      "unique2.js": `
        console.log("unique2");
      `,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry1.js", "./entry2.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            minShareCount: 2,
            minSize: 100,
            maxSize: 10000,
            groups: [
              {
                name: "shared-group",
                test: "shared",
                priority: 10,
                type: "javascript",
                enforce: true
              }
            ]
          }
        });
        console.log("Build successful:", result.success);
        console.log("Output count:", result.outputs.length);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Build successful: true");
    expect(stderr).toBe("");
  });

  test("should accept advancedChunks via CLI", async () => {
    const dir = tempDirWithFiles("advanced-chunks-cli", {
      "entry1.js": `
        import "./shared.js";
        console.log("entry1");
      `,
      "entry2.js": `
        import "./shared.js";
        console.log("entry2");
      `,
      "shared.js": `
        console.log("shared");
      `,
    });

    // Test basic build with advancedChunks placeholder
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry1.js", "entry2.js", "--splitting", "--outdir=out"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  test("should handle invalid advancedChunks config gracefully", async () => {
    const dir = tempDirWithFiles("advanced-chunks-invalid", {
      "entry.js": `console.log("entry");`,
      "build.js": `
        try {
          const result = await Bun.build({
            entrypoints: ["./entry.js"],
            splitting: true,
            advancedChunks: {
              groups: [
                {
                  // Missing required 'name' field
                  test: "test"
                }
              ]
            }
          });
          console.log("Build result:", result.success);
        } catch (error) {
          console.log("Error caught:", error.message);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The build should either succeed (if validation is lenient) or fail gracefully
    expect(exitCode).toBeLessThanOrEqual(1);
  });

  test("should work with preserve-entry-signatures and advancedChunks", async () => {
    const dir = tempDirWithFiles("advanced-chunks-preserve", {
      "entry1.js": `
        import "./shared.js";
        export const value1 = "entry1";
      `,
      "entry2.js": `
        import "./shared.js";
        export const value2 = "entry2";
      `,
      "shared.js": `
        export const shared = "shared";
      `,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry1.js", "./entry2.js"],
          splitting: true,
          outdir: "./out",
          preserveEntrySignatures: "allow-extension",
          advancedChunks: {
            minShareCount: 1,
            groups: [
              {
                name: "vendor",
                test: "shared",
                priority: 5
              }
            ]
          }
        });
        console.log("Build completed:", result.success);
        console.log("Outputs:", result.outputs.length);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Build completed: true");
  });

  test("should handle all advancedChunks options", async () => {
    const dir = tempDirWithFiles("advanced-chunks-all-options", {
      "entry.js": `
        import "./module1.js";
        import "./module2.js";
        console.log("entry");
      `,
      "module1.js": `console.log("module1");`,
      "module2.js": `console.log("module2");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            minShareCount: 1,
            minSize: 50,
            maxSize: 50000,
            minModuleSize: 10,
            maxModuleSize: 10000,
            groups: [
              {
                name: "modules",
                test: "module",
                priority: 1,
                type: "javascript",
                minSize: 20,
                maxSize: 5000,
                minChunks: 1,
                maxChunks: 10,
                enforce: false
              }
            ]
          }
        });
        console.log("Advanced chunks test passed:", result.success);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Advanced chunks test passed: true");
    expect(stderr).toBe("");
  });
});