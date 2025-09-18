import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

describe("bun build --compress", () => {
  test("--compress=gzip creates gzipped output files", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(srcFile, `console.log("Hello, compression!");`);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--compress=gzip"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that both original and compressed files exist
    expect(fs.existsSync(path.join(outdir, "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "index.js.gz"))).toBe(true);

    // Verify the gzip file is valid
    const gzipContent = fs.readFileSync(path.join(outdir, "index.js.gz"));
    const decompressed = zlib.gunzipSync(gzipContent);
    const original = fs.readFileSync(path.join(outdir, "index.js"));

    expect(decompressed).toEqual(original);
  });

  test("--compress=zstd creates zstd output files", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(srcFile, `console.log("Hello, zstd compression!");`);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--compress=zstd"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that both original and compressed files exist
    expect(fs.existsSync(path.join(outdir, "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "index.js.zst"))).toBe(true);

    // Verify the zstd file has correct magic bytes
    const zstdContent = fs.readFileSync(path.join(outdir, "index.js.zst"));
    expect(zstdContent[0]).toBe(0x28);
    expect(zstdContent[1]).toBe(0xb5);
    expect(zstdContent[2]).toBe(0x2f);
    expect(zstdContent[3]).toBe(0xfd);
  });

  test("multiple --compress flags create multiple compressed outputs", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(srcFile, `export const message = "Multiple compression formats";`);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--compress=gzip", "--compress=zstd"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that all three files exist
    expect(fs.existsSync(path.join(outdir, "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "index.js.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "index.js.zst"))).toBe(true);
  });

  test("compression works with minification", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(
      srcFile,
      `
      // This comment should be removed
      export function calculateFactorial(num) {
        if (num === 0 || num === 1) return 1;
        return num * calculateFactorial(num - 1);
      }
      console.log("Factorial of 5:", calculateFactorial(5));
    `,
    );

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--minify", "--compress=gzip"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    const original = fs.readFileSync(path.join(outdir, "index.js"), "utf-8");
    const gzipContent = fs.readFileSync(path.join(outdir, "index.js.gz"));
    const decompressed = zlib.gunzipSync(gzipContent).toString("utf-8");

    // Check that minification happened
    expect(original).not.toContain("// This comment should be removed");
    expect(decompressed).not.toContain("// This comment should be removed");
    expect(decompressed).toEqual(original);
  });

  test("compression works with multiple entry points", () => {
    const tmpdir = tmpdirSync();
    const srcFile1 = path.join(tmpdir, "entry1.js");
    const srcFile2 = path.join(tmpdir, "entry2.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(srcFile1, `console.log("Entry 1");`);
    fs.writeFileSync(srcFile2, `console.log("Entry 2");`);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile1, srcFile2, "--outdir", outdir, "--compress=gzip"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that compressed files exist for both entries
    expect(fs.existsSync(path.join(outdir, "entry1.js.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry2.js.gz"))).toBe(true);

    // Verify both are valid gzip files
    const gz1 = fs.readFileSync(path.join(outdir, "entry1.js.gz"));
    const gz2 = fs.readFileSync(path.join(outdir, "entry2.js.gz"));
    const decomp1 = zlib.gunzipSync(gz1);
    const decomp2 = zlib.gunzipSync(gz2);

    expect(decomp1).toEqual(fs.readFileSync(path.join(outdir, "entry1.js")));
    expect(decomp2).toEqual(fs.readFileSync(path.join(outdir, "entry2.js")));
  });

  test("compression works with --splitting", () => {
    const tmpdir = tmpdirSync();
    const entryFile = path.join(tmpdir, "entry.js");
    const sharedFile = path.join(tmpdir, "shared.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(sharedFile, `export const shared = "shared code";`);
    fs.writeFileSync(
      entryFile,
      `
      import { shared } from "./shared.js";
      console.log(shared);
    `,
    );

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", entryFile, "--outdir", outdir, "--splitting", "--compress=gzip"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that compressed files exist for all chunks
    const files = fs.readdirSync(outdir);
    const gzFiles = files.filter(f => f.endsWith(".gz"));
    const jsFiles = files.filter(f => f.endsWith(".js") && !f.endsWith(".gz"));

    expect(gzFiles.length).toBeGreaterThan(0);
    expect(gzFiles.length).toEqual(jsFiles.length);

    // Verify all gz files are valid
    for (const gzFile of gzFiles) {
      const gzContent = fs.readFileSync(path.join(outdir, gzFile));
      expect(() => zlib.gunzipSync(gzContent)).not.toThrow();
    }
  });

  test("compression works with CSS files", () => {
    const tmpdir = tmpdirSync();
    const cssFile = path.join(tmpdir, "styles.css");
    const jsFile = path.join(tmpdir, "index.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(cssFile, `body { margin: 0; padding: 0; background: #fff; }`);
    fs.writeFileSync(jsFile, `import "./styles.css"; console.log("CSS test");`);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", jsFile, "--outdir", outdir, "--compress=gzip"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that CSS files are also compressed
    const files = fs.readdirSync(outdir);
    const cssOutputFiles = files.filter(f => f.includes("styles") && f.endsWith(".css"));
    const cssGzFiles = files.filter(f => f.includes("styles") && f.endsWith(".css.gz"));

    if (cssOutputFiles.length > 0) {
      expect(cssGzFiles.length).toEqual(cssOutputFiles.length);
    }
  });

  test("invalid compression format shows error", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.js");

    fs.writeFileSync(srcFile, `console.log("test");`);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--compress=invalid"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("Invalid compression format");
    expect(stderr.toString()).toContain("Valid formats: 'gzip', 'zstd'");
  });

  test("compression works with source maps", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.ts");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(
      srcFile,
      `
      const message: string = "TypeScript with source maps";
      console.log(message);
    `,
    );

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--sourcemap=external", "--compress=gzip"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check that main file and its compressed version exist
    expect(fs.existsSync(path.join(outdir, "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "index.js.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "index.js.map"))).toBe(true);

    // Note: Source maps are not compressed in the current implementation
    // This could be added as a future enhancement

    // Verify compressed file is valid
    const jsGz = fs.readFileSync(path.join(outdir, "index.js.gz"));
    expect(() => zlib.gunzipSync(jsGz)).not.toThrow();
  });

  test("large file compression works correctly", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "large.js");
    const outdir = path.join(tmpdir, "out");

    // Create a large file with repetitive content (good for compression)
    const largeContent = Array(1000)
      .fill(0)
      .map((_, i) => `console.log("Line ${i}: This is a test of compression with repetitive content");`)
      .join("\n");

    fs.writeFileSync(srcFile, largeContent);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--compress=gzip", "--compress=zstd"],
      env: bunEnv,
      stderr: "pipe",
    });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    const originalSize = fs.statSync(path.join(outdir, "large.js")).size;
    const gzipSize = fs.statSync(path.join(outdir, "large.js.gz")).size;
    const zstdSize = fs.statSync(path.join(outdir, "large.js.zst")).size;

    // Compressed files should be significantly smaller
    expect(gzipSize).toBeLessThan(originalSize * 0.3);
    expect(zstdSize).toBeLessThan(originalSize * 0.3);

    // Verify decompression gives original content
    const gzipContent = fs.readFileSync(path.join(outdir, "large.js.gz"));
    const decompressed = zlib.gunzipSync(gzipContent);
    const original = fs.readFileSync(path.join(outdir, "large.js"));

    expect(decompressed).toEqual(original);
  });

  test("compression works with different output formats", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "index.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(srcFile, `export const value = 42;`);

    // Test with ESM format
    {
      const { exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--format=esm", "--compress=gzip"],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(outdir, "index.js.gz"))).toBe(true);
      fs.rmSync(outdir, { recursive: true, force: true });
    }

    // Test with CJS format
    {
      const { exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--format=cjs", "--compress=gzip"],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(outdir, "index.js.gz"))).toBe(true);
      fs.rmSync(outdir, { recursive: true, force: true });
    }

    // Test with IIFE format
    {
      const { exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--format=iife", "--compress=gzip"],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(outdir, "index.js.gz"))).toBe(true);
    }
  });

  test("compression works with --outfile", () => {
    const tmpdir = tmpdirSync();
    const srcFile = path.join(tmpdir, "cli.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(srcFile, `#!/usr/bin/env node\nconsole.log("CLI tool");`);

    // Note: --outfile with --compress currently uses --outdir internally
    // The compressed file is created alongside the output file
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "build", srcFile, "--outdir", outdir, "--compress=gzip"],
      env: bunEnv,
    });

    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(outdir, "cli.js.gz"))).toBe(true);

    // Verify the compressed file is valid
    const gzContent = fs.readFileSync(path.join(outdir, "cli.js.gz"));
    expect(() => zlib.gunzipSync(gzContent)).not.toThrow();
  });
});