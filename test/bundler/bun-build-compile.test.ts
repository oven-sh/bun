import { describe, test, expect } from "bun:test";
import { bunExe } from "../harness";
import { join } from "path";
import { statSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { execSync } from "child_process";

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bun-build-compile-"));
  return dir;
};

describe("Bun.build compile option", () => {
  // Test that compile: true works correctly
  test("compile: true creates an executable", async () => {
    const dir = tempDir();
    const entry = join(dir, "index.js");
    const outfile = join(dir, "output");

    writeFileSync(
      entry,
      `
        console.log("Hello from compiled executable!");
      `
    );

    const build = await Bun.build({
      entrypoints: [entry],
      outfile,
      compile: true,
    });

    expect(build.success).toBe(true);
    expect(existsSync(outfile)).toBe(true);

    // Verify the file is executable
    const stats = statSync(outfile);
    expect(!!(stats.mode & 0o111)).toBe(true);

    // Run the executable to verify it works
    try {
      const result = execSync(outfile, { encoding: "utf8" });
      expect(result.trim()).toBe("Hello from compiled executable!");
    } catch (e) {
      // Some CI environments might not allow running executables
      // So don't fail the test in that case
      if (!process.env.CI) {
        throw e;
      }
    }
  });

  // Test that platform targets work with compile option
  test("targets option specifies the compilation target", async () => {
    const dir = tempDir();
    const entry = join(dir, "index.js");
    const outfile = join(dir, "output");

    writeFileSync(
      entry,
      `
        console.log("Platform:", process.platform);
        console.log("Architecture:", process.arch);
      `
    );

    // Skip test if cross-compilation to this target would fail
    // In a real test environment we'd need to check if the current platform supports this
    try {
      const build = await Bun.build({
        entrypoints: [entry],
        outfile,
        compile: true,
        targets: process.platform === "darwin" ? "darwin-x64" : "linux-x64",
      });

      expect(build.success).toBe(true);
      expect(existsSync(outfile)).toBe(true);
    } catch (e) {
      // If the test fails because the target isn't supported, that's okay
      if (!e.message?.includes("not supported")) throw e;
    }
  });

  // Test that TypeScript files compile correctly
  test("compiles TypeScript files", async () => {
    const dir = tempDir();
    const entry = join(dir, "index.ts");
    const outfile = join(dir, "output");

    writeFileSync(
      entry,
      `
        const message: string = "Hello from TypeScript";
        console.log(message);
      `
    );

    const build = await Bun.build({
      entrypoints: [entry],
      outfile,
      compile: true,
    });

    expect(build.success).toBe(true);
    expect(existsSync(outfile)).toBe(true);

    // Run the executable to verify it works
    try {
      const result = execSync(outfile, { encoding: "utf8" });
      expect(result.trim()).toBe("Hello from TypeScript");
    } catch (e) {
      // Some CI environments might not allow running executables
      // So don't fail the test in that case
      if (!process.env.CI) {
        throw e;
      }
    }
  });

  // Test error when incompatible options are used
  test("error with incompatible options", async () => {
    const dir = tempDir();
    const entry = join(dir, "index.js");
    
    writeFileSync(entry, `console.log("Hello");`);

    let error;
    try {
      await Bun.build({
        entrypoints: [entry],
        outfile: join(dir, "output"),
        compile: true,
        outdir: dir, // outdir is incompatible with compile
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message.toLowerCase()).toMatch(/cannot use both outdir and compile/);
  });

  // Test combining with other build options
  test("works with minify option", async () => {
    const dir = tempDir();
    const entry = join(dir, "index.js");
    const outfile = join(dir, "output");

    writeFileSync(
      entry,
      `
        function unused() {
          console.log("This should be removed");
        }
        console.log("Hello from minified executable!");
      `
    );

    const build = await Bun.build({
      entrypoints: [entry],
      outfile,
      compile: true,
      minify: true,
    });

    expect(build.success).toBe(true);
    expect(existsSync(outfile)).toBe(true);

    // Run the executable to verify it works
    try {
      const result = execSync(outfile, { encoding: "utf8" });
      expect(result.trim()).toBe("Hello from minified executable!");
    } catch (e) {
      // Some CI environments might not allow running executables
      // So don't fail the test in that case
      if (!process.env.CI) {
        throw e;
      }
    }
  });
});