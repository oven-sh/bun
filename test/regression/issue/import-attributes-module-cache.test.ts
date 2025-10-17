import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("import attributes should not be ignored by module cache", () => {
  test("dynamic import with different import attributes should load separately", async () => {
    using dir = tempDir("import-attrs", {
      "data.js": `export const value = "module data";`,
      "test.js": `
        const asText = await import("./data.js", { with: { type: "text" } });
        const asModule = await import("./data.js");

        console.log("text:", typeof asText.default);
        console.log("module:", typeof asModule.value);

        if (typeof asText.default === "string" && typeof asModule.value === "string") {
          console.log("SUCCESS");
        } else {
          console.log("FAIL");
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("text: string");
    expect(stdout).toContain("module: string");
    expect(stdout).toContain("SUCCESS");
  });

  test("dynamic import with same file but different order should work", async () => {
    using dir = tempDir("import-attrs-order", {
      "data.js": `export const value = "module data";`,
      "test.js": `
        // Import as module first, then as text
        const asModule = await import("./data.js");
        const asText = await import("./data.js", { with: { type: "text" } });

        console.log("module:", typeof asModule.value);
        console.log("text:", typeof asText.default);

        if (typeof asText.default === "string" && typeof asModule.value === "string") {
          console.log("SUCCESS");
        } else {
          console.log("FAIL");
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("module: string");
    expect(stdout).toContain("text: string");
    expect(stdout).toContain("SUCCESS");
  });

  test("bundled static imports with different import attributes should load separately", async () => {
    using dir = tempDir("import-attrs-bundled", {
      "data.js": `export const value = "module data";`,
      "entry.js": `
        import asText from "./data.js" with { type: "text" };
        import { value } from "./data.js";

        console.log("text:", typeof asText);
        console.log("module:", typeof value);

        if (typeof asText === "string" && typeof value === "string") {
          console.log("SUCCESS");
        } else {
          console.log("FAIL");
          process.exit(1);
        }
      `,
    });

    // Bundle the code
    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--outfile=bundle.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await buildProc.exited;

    // Run the bundled output
    await using runProc = Bun.spawn({
      cmd: [bunExe(), "bundle.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([runProc.stdout.text(), runProc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("text: string");
    expect(stdout).toContain("module: string");
    expect(stdout).toContain("SUCCESS");
  });

  // NOTE: Unbundled static imports with different import attributes don't work yet
  // because JSC doesn't pass import attributes to moduleLoaderResolve at parse time.
  // The bundler fix above works because Bun controls the entire module resolution.
  test.todo("unbundled static import with different import attributes should load separately", async () => {
    using dir = tempDir("import-attrs-static", {
      "data.js": `export const value = "module data";`,
      "test.js": `
        import asText from "./data.js" with { type: "text" };
        import { value } from "./data.js";

        console.log("text:", typeof asText);
        console.log("module:", typeof value);

        if (typeof asText === "string" && typeof value === "string") {
          console.log("SUCCESS");
        } else {
          console.log("FAIL");
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("text: string");
    expect(stdout).toContain("module: string");
    expect(stdout).toContain("SUCCESS");
  });
});
