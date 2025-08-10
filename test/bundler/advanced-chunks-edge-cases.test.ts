import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("Advanced Chunks Edge Cases", () => {
  test("should handle empty advancedChunks config", async () => {
    const dir = tempDirWithFiles("advanced-chunks-empty", {
      "entry.js": `console.log("entry");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {}
        });
        console.log("Empty config result:", result.success);
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
    expect(stdout).toContain("Empty config result: true");
    expect(stderr).toBe("");
  });

  test("should handle negative size constraints gracefully", async () => {
    const dir = tempDirWithFiles("advanced-chunks-negative", {
      "entry.js": `console.log("entry");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            minSize: -100,
            maxSize: -50
          }
        });
        console.log("Negative size result:", result.success);
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
    expect(stdout).toContain("Negative size result: true");
  });

  test("should handle groups with missing name gracefully", async () => {
    const dir = tempDirWithFiles("advanced-chunks-no-name", {
      "entry.js": `console.log("entry");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            groups: [
              {
                test: "test",
                priority: 10
              }
            ]
          }
        });
        console.log("Missing name result:", result.success);
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

    // The parsing currently allows missing name and handles it gracefully
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Missing name result: true");
  });

  test("should handle groups with all optional fields", async () => {
    const dir = tempDirWithFiles("advanced-chunks-all-fields", {
      "entry.js": `console.log("entry");`,
      "module1.js": `console.log("module1");`,
      "module2.js": `console.log("module2");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            minShareCount: 1,
            minSize: 0,
            maxSize: Number.MAX_SAFE_INTEGER,
            minModuleSize: 0,
            maxModuleSize: Number.MAX_SAFE_INTEGER,
            groups: [
              {
                name: "test-group",
                test: "module",
                priority: 100,
                type: "javascript",
                minSize: 0,
                maxSize: Number.MAX_SAFE_INTEGER,
                minChunks: 0,
                maxChunks: 1000,
                enforce: true
              }
            ]
          }
        });
        console.log("All fields result:", result.success);
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
    expect(stdout).toContain("All fields result: true");
  });

  test("should work with preserveEntrySignatures and advancedChunks together", async () => {
    const dir = tempDirWithFiles("advanced-chunks-with-preserve", {
      "entry1.js": `
        import "./shared.js";
        export const entry1 = true;
      `,
      "entry2.js": `
        import "./shared.js";
        export const entry2 = true;
      `,
      "shared.js": `
        console.log("shared");
      `,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry1.js", "./entry2.js"],
          splitting: true,
          outdir: "./out",
          preserveEntrySignatures: "strict",
          advancedChunks: {
            minShareCount: 2,
            groups: [
              {
                name: "shared-group",
                test: "shared"
              }
            ]
          }
        });
        console.log("Combined result:", result.success);
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
    expect(stdout).toContain("Combined result: true");
    expect(stdout).toContain("Output count: 3"); // strict mode prevents merging
  });

  test("should handle groups with different priorities", async () => {
    const dir = tempDirWithFiles("advanced-chunks-priorities", {
      "entry.js": `
        import "./module1.js";
        import "./module2.js";
        import "./module3.js";
      `,
      "module1.js": `console.log("module1");`,
      "module2.js": `console.log("module2");`,
      "module3.js": `console.log("module3");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            groups: [
              {
                name: "low-priority",
                test: "module",
                priority: 1
              },
              {
                name: "high-priority",
                test: "module1",
                priority: 100
              },
              {
                name: "medium-priority",
                test: "module2",
                priority: 50
              }
            ]
          }
        });
        console.log("Priority test:", result.success);
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
    expect(stdout).toContain("Priority test: true");
  });

  test("should handle numeric constraints at boundaries", async () => {
    const dir = tempDirWithFiles("advanced-chunks-boundaries", {
      "entry.js": `console.log("entry");`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            minShareCount: 0,
            minSize: 0,
            maxSize: Number.MAX_SAFE_INTEGER,
            minModuleSize: Number.MIN_VALUE,
            maxModuleSize: Number.MAX_VALUE,
            groups: [
              {
                name: "boundary-test",
                priority: Number.MAX_SAFE_INTEGER,
                minChunks: 0,
                maxChunks: Number.MAX_SAFE_INTEGER
              }
            ]
          }
        });
        console.log("Boundary test:", result.success);
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
    expect(stdout).toContain("Boundary test: true");
  });

  test("should handle different module types", async () => {
    const dir = tempDirWithFiles("advanced-chunks-types", {
      "entry.js": `
        import "./style.css";
        import "./data.json";
        console.log("entry");
      `,
      "style.css": `body { color: red; }`,
      "data.json": `{"key": "value"}`,
      "build.js": `
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          splitting: true,
          outdir: "./out",
          advancedChunks: {
            groups: [
              {
                name: "styles",
                type: "css"
              },
              {
                name: "data",
                type: "asset"
              },
              {
                name: "scripts",
                type: "javascript"
              }
            ]
          }
        });
        console.log("Type test:", result.success);
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
    expect(stdout).toContain("Type test: true");
  });
});
