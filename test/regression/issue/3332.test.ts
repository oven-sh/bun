import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "path";

describe("issue #3332 - sourcemap sources should be relative to root", () => {
  test("JS sourcemap sources are relative to root, not output directory", async () => {
    using dir = tempDir("issue-3332-js", {
      "src/index.ts": `import { helper } from './nested/helper';
console.log(helper());`,
      "src/nested/helper.ts": `export function helper() {
  return 'hello';
}`,
    });

    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "src/index.ts")],
      outdir: path.join(String(dir), "dist"),
      root: String(dir),
      sourcemap: "external",
    });

    expect(result.success).toBe(true);

    // Find the sourcemap output
    const sourcemapOutput = result.outputs.find(o => o.kind === "sourcemap");
    expect(sourcemapOutput).toBeDefined();

    // Parse the sourcemap
    const mapContent = await sourcemapOutput!.text();
    const map = JSON.parse(mapContent);

    // Sources should be relative to root (the project directory), not output directory
    // Expected: ["src/nested/helper.ts", "src/index.ts"] (or similar)
    // Bug behavior: ["../src/nested/helper.ts", "../src/index.ts"] (relative to dist/src/)
    for (const source of map.sources) {
      expect(source).not.toMatch(/^\.\.\//);
      expect(source).toMatch(/^src\//);
    }

    expect(map.sources).toContain("src/index.ts");
    expect(map.sources).toContain("src/nested/helper.ts");
  });

  test("sourcemap sources without explicit root use cwd", async () => {
    using dir = tempDir("issue-3332-no-root", {
      "index.ts": `console.log('hello');`,
    });

    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "index.ts")],
      outdir: path.join(String(dir), "dist"),
      sourcemap: "external",
    });

    expect(result.success).toBe(true);

    const sourcemapOutput = result.outputs.find(o => o.kind === "sourcemap");
    expect(sourcemapOutput).toBeDefined();

    const mapContent = await sourcemapOutput!.text();
    const map = JSON.parse(mapContent);

    // Sources should contain just the filename or a relative path, not "../"
    for (const source of map.sources) {
      expect(source).not.toMatch(/^\.\.\//);
      // Verify the source path ends with "index.ts"
      expect(source).toEndWith("index.ts");
    }

    // Verify we have exactly one source file
    expect(map.sources).toHaveLength(1);
  });
});
