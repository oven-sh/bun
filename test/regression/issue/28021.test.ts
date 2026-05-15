import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { globSync, mkdirSync, writeFileSync } from "node:fs";
import { glob as asyncGlob } from "node:fs/promises";
import { basename, join } from "node:path";

describe("fs.glob matches dot files with explicit dot patterns", () => {
  function setup() {
    const dir = tempDir("glob-dot-test", {
      ".hidden": "hidden file",
      ".hidden2": "another hidden",
      "visible": "visible file",
      "visible2": "another visible",
    });
    mkdirSync(join(String(dir), ".hidden-dir"), { recursive: true });
    writeFileSync(join(String(dir), ".hidden-dir", "inside"), "inside hidden dir");
    return dir;
  }

  interface GlobOptions {
    cwd?: string;
    exclude?: ((ent: string) => boolean) | string[];
  }

  async function collectAsync(pattern: string, options?: GlobOptions): Promise<string[]> {
    const results: string[] = [];
    for await (const match of asyncGlob(pattern, options)) {
      results.push(match);
    }
    return results.sort();
  }

  function collectSync(pattern: string, options?: GlobOptions): string[] {
    const results: string[] = [];
    for (const match of globSync(pattern, options)) {
      results.push(match);
    }
    return results.sort();
  }

  test("wildcard * should NOT match dot files", async () => {
    using dir = setup();
    const results = await collectAsync(join(String(dir), "*"));
    expect(results.every(r => !basename(r).startsWith("."))).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test(".* pattern should match dot files (async)", async () => {
    using dir = setup();
    const results = await collectAsync(join(String(dir), ".*"));
    const basenames = results.map(r => basename(r));
    expect(basenames).toContain(".hidden");
    expect(basenames).toContain(".hidden2");
    expect(basenames).toContain(".hidden-dir");
  });

  test(".* pattern should match dot files (sync)", () => {
    using dir = setup();
    const results = collectSync(join(String(dir), ".*"));
    const basenames = results.map(r => basename(r));
    expect(basenames).toContain(".hidden");
    expect(basenames).toContain(".hidden2");
    expect(basenames).toContain(".hidden-dir");
  });

  test(".h* pattern should match dot files starting with .h", async () => {
    using dir = setup();
    const results = await collectAsync(join(String(dir), ".h*"));
    expect(results.length).toBeGreaterThanOrEqual(2);
    const basenames = results.map(r => basename(r));
    expect(basenames).toContain(".hidden");
    expect(basenames).toContain(".hidden2");
  });

  test("fs.glob with cwd option and relative dot pattern", async () => {
    using dir = setup();
    const cwd = String(dir);
    const results = await collectAsync(".*", { cwd });
    const basenames = results.map(r => basename(r));
    expect(basenames).toContain(".hidden");
    expect(basenames).toContain(".hidden2");
    expect(basenames).toContain(".hidden-dir");
  });

  test("Bun.Glob with .* pattern and dot:false should match dot files", () => {
    using dir = setup();
    const cwd = String(dir);
    const results = Array.from(new Bun.Glob(".*").scanSync({ cwd, dot: false, onlyFiles: false })).sort();
    expect(results).toContain(".hidden");
    expect(results).toContain(".hidden2");
    expect(results).toContain(".hidden-dir");
  });

  test("Bun.Glob with .h* pattern and dot:false should match dot files", () => {
    using dir = setup();
    const cwd = String(dir);
    const results = Array.from(new Bun.Glob(".h*").scanSync({ cwd, dot: false, onlyFiles: false })).sort();
    expect(results).toContain(".hidden");
    expect(results).toContain(".hidden2");
    expect(results).toContain(".hidden-dir");
  });

  test("Bun.Glob with * and dot:false should NOT match dot files", () => {
    using dir = setup();
    const cwd = String(dir);
    const results = Array.from(new Bun.Glob("*").scanSync({ cwd, dot: false }));
    expect(results).toContain("visible");
    expect(results).toContain("visible2");
    expect(results.every(r => !r.startsWith("."))).toBe(true);
  });

  test("Bun.Glob with literal .hidden and dot:false should match", () => {
    using dir = setup();
    const cwd = String(dir);
    const results = Array.from(new Bun.Glob(".hidden").scanSync({ cwd, dot: false }));
    expect(results).toContain(".hidden");
  });
});
