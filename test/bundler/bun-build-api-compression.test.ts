import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

describe("Bun.build compress API", () => {
  test("compress: 'gzip' creates gzipped output", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(entryPath, `console.log("Hello from Bun.build API!");`);

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: "gzip",
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.gz"))).toBe(true);

    // Verify gzip file is valid
    const gzContent = fs.readFileSync(path.join(outdir, "entry.js.gz"));
    const decompressed = zlib.gunzipSync(gzContent);
    const original = fs.readFileSync(path.join(outdir, "entry.js"));
    expect(decompressed).toEqual(original);
  });

  test("compress: 'zstd' creates zstd output", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(entryPath, `export const message = "zstd compression test";`);

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: "zstd",
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.zst"))).toBe(true);

    // Verify zstd magic bytes
    const zstdContent = fs.readFileSync(path.join(outdir, "entry.js.zst"));
    expect(zstdContent[0]).toBe(0x28);
    expect(zstdContent[1]).toBe(0xb5);
    expect(zstdContent[2]).toBe(0x2f);
    expect(zstdContent[3]).toBe(0xfd);
  });

  test("compress: { gzip: true, zstd: true } creates both formats", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(entryPath, `console.log("Both compression formats");`);

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: { gzip: true, zstd: true },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.zst"))).toBe(true);
  });

  test("compress: { gzip: false, zstd: true } creates only zstd", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(entryPath, `console.log("Only zstd");`);

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: { gzip: false, zstd: true },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.gz"))).toBe(false);
    expect(fs.existsSync(path.join(outdir, "entry.js.zst"))).toBe(true);
  });

  test("compress works with minify", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(
      entryPath,
      `
      // This comment should be removed
      function longFunctionName(parameter) {
        const variableName = parameter + 1;
        return variableName;
      }
      console.log(longFunctionName(5));
    `,
    );

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: "gzip",
      minify: true,
    });

    expect(result.success).toBe(true);

    const original = fs.readFileSync(path.join(outdir, "entry.js"), "utf-8");
    const gzContent = fs.readFileSync(path.join(outdir, "entry.js.gz"));
    const decompressed = zlib.gunzipSync(gzContent).toString("utf-8");

    // Check minification happened
    expect(original).not.toContain("// This comment should be removed");
    expect(original).not.toContain("longFunctionName");
    expect(decompressed).toEqual(original);
  });

  test("compress works with splitting", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    const sharedPath = path.join(tmpdir, "shared.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(sharedPath, `export const shared = "shared module";`);
    fs.writeFileSync(entryPath, `import { shared } from "./shared.js";\nconsole.log(shared);`);

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: "gzip",
      splitting: true,
    });

    expect(result.success).toBe(true);

    const files = fs.readdirSync(outdir);
    const gzFiles = files.filter(f => f.endsWith(".gz"));
    const jsFiles = files.filter(f => f.endsWith(".js") && !f.endsWith(".gz"));

    expect(gzFiles.length).toBeGreaterThan(0);
    expect(gzFiles.length).toEqual(jsFiles.length);

    // Verify all gz files are valid
    for (const gzFile of gzFiles) {
      const content = fs.readFileSync(path.join(outdir, gzFile));
      expect(() => zlib.gunzipSync(content)).not.toThrow();
    }
  });

  test("invalid compress option throws error", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.js");
    fs.writeFileSync(entryPath, `console.log("test");`);

    try {
      await Bun.build({
        entrypoints: [entryPath],
        outdir: tmpdir,
        compress: "invalid" as any,
      });
      expect(false).toBe(true); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("compress must be");
    }
  });

  test("compress with multiple entrypoints", async () => {
    const tmpdir = tmpdirSync();
    const entry1Path = path.join(tmpdir, "entry1.js");
    const entry2Path = path.join(tmpdir, "entry2.js");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(entry1Path, `console.log("Entry 1");`);
    fs.writeFileSync(entry2Path, `console.log("Entry 2");`);

    const result = await Bun.build({
      entrypoints: [entry1Path, entry2Path],
      outdir,
      compress: { gzip: true },
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry1.js.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry2.js.gz"))).toBe(true);
  });

  test("compression ratio on large files", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "large.js");
    const outdir = path.join(tmpdir, "out");

    // Create a large file with repetitive content
    const largeContent = Array(500)
      .fill(0)
      .map((_, i) => `console.log("Line ${i}: This is repetitive content for compression testing");`)
      .join("\n");

    fs.writeFileSync(entryPath, largeContent);

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: { gzip: true, zstd: true },
    });

    expect(result.success).toBe(true);

    const originalSize = fs.statSync(path.join(outdir, "large.js")).size;
    const gzipSize = fs.statSync(path.join(outdir, "large.js.gz")).size;
    const zstdSize = fs.statSync(path.join(outdir, "large.js.zst")).size;

    // Both should achieve good compression on repetitive content
    expect(gzipSize).toBeLessThan(originalSize * 0.2);
    expect(zstdSize).toBeLessThan(originalSize * 0.2);
  });

  test("compress with sourcemap compresses both files", async () => {
    const tmpdir = tmpdirSync();
    const entryPath = path.join(tmpdir, "entry.ts");
    const outdir = path.join(tmpdir, "out");

    fs.writeFileSync(
      entryPath,
      `const message: string = "TypeScript with sourcemap";
console.log(message);`,
    );

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir,
      compress: { gzip: true, zstd: true },
      sourcemap: "external",
    });

    expect(result.success).toBe(true);

    // Check all files exist
    expect(fs.existsSync(path.join(outdir, "entry.js"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.zst"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.map"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.map.gz"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "entry.js.map.zst"))).toBe(true);

    // Verify gzip files are valid
    const jsGz = fs.readFileSync(path.join(outdir, "entry.js.gz"));
    const mapGz = fs.readFileSync(path.join(outdir, "entry.js.map.gz"));
    expect(() => zlib.gunzipSync(jsGz)).not.toThrow();
    expect(() => zlib.gunzipSync(mapGz)).not.toThrow();

    // Verify zstd files have correct magic bytes
    const jsZst = fs.readFileSync(path.join(outdir, "entry.js.zst"));
    const mapZst = fs.readFileSync(path.join(outdir, "entry.js.map.zst"));
    expect(jsZst[0]).toBe(0x28);
    expect(mapZst[0]).toBe(0x28);

    // Verify decompressed content matches
    const original = fs.readFileSync(path.join(outdir, "entry.js"));
    const decompressed = zlib.gunzipSync(jsGz);
    expect(decompressed).toEqual(original);
  });
});