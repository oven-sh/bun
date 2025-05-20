import { test, expect, describe } from "bun:test";
import { tempDirWithFiles, bunExe } from "harness";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { spawnSync } from "child_process";

describe("Bun.build compile option", () => {
  // Test that compile: true works correctly
  test("compile: true creates an executable", async () => {
    const dir = tempDirWithFiles("compile-test", {
      "index.js": `
        console.log("Hello from compiled executable!");
      `,
    });

    const outfile = join(dir, "output");
    
    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      outfile,
      compile: true,
    });

    expect(build.success).toBe(true);
    expect(existsSync(outfile)).toBe(true);
    
    // Verify the file is executable
    const stats = statSync(outfile);
    expect(!!(stats.mode & 0o111)).toBe(true);
    
    // Run the executable to verify it works
    const { stdout } = spawnSync(outfile, [], { encoding: "utf8" });
    expect(stdout.trim()).toBe("Hello from compiled executable!");
  });

  // Test the targets option
  test("targets option specifies the compilation target", async () => {
    const dir = tempDirWithFiles("compile-targets-test", {
      "index.js": `
        console.log("Platform:", process.platform);
        console.log("Architecture:", process.arch);
      `,
    });

    const outfile = join(dir, "output");
    
    // Skip test if cross-compilation to this target would fail
    // In a real test environment we'd need to check if the current platform supports this
    try {
      const build = await Bun.build({
        entrypoints: [join(dir, "index.js")],
        outfile,
        compile: true,
        targets: process.platform === "darwin" ? "darwin-x64" : "linux-x64",
      });
  
      expect(build.success).toBe(true);
      expect(existsSync(outfile)).toBe(true);
    } catch (e) {
      // If the test fails because the target isn't supported, that's okay
      if (!e.message.includes("not supported")) throw e;
    }
  });

  // Test error when multiple targets are specified (currently not supported)
  test("error when multiple targets are specified", async () => {
    const dir = tempDirWithFiles("compile-multi-targets-test", {
      "index.js": `console.log("Hello");`,
    });

    let error;
    try {
      await Bun.build({
        entrypoints: [join(dir, "index.js")],
        outfile: join(dir, "output"),
        compile: true,
        targets: ["darwin-x64", "linux-x64"],
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toMatch(/multiple targets are not supported/i);
  });

  // Test TypeScript compilation
  test("compiles TypeScript files", async () => {
    const dir = tempDirWithFiles("compile-ts-test", {
      "index.ts": `
        const message: string = "Hello from TypeScript";
        console.log(message);
      `,
    });

    const outfile = join(dir, "output");
    
    const build = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      outfile,
      compile: true,
    });

    expect(build.success).toBe(true);
    expect(existsSync(outfile)).toBe(true);
    
    // Run the executable to verify it works
    const { stdout } = spawnSync(outfile, [], { encoding: "utf8" });
    expect(stdout.trim()).toBe("Hello from TypeScript");
  });

  // Test error when incompatible options are used
  test("error with incompatible options", async () => {
    const dir = tempDirWithFiles("compile-error-test", {
      "index.js": `console.log("Hello");`,
    });

    let error;
    try {
      await Bun.build({
        entrypoints: [join(dir, "index.js")],
        outfile: join(dir, "output"),
        compile: true,
        outdir: dir, // outdir is incompatible with compile
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toMatch(/cannot use both outdir and compile/i);
  });
});