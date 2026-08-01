// https://github.com/oven-sh/bun/issues/3332
// Sourcemap `sources` entries must be relative to the .map file's own
// directory (per the sourcemap spec), not to the build outdir.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("issue 3332: sourcemap sources are relative to the map file", () => {
  test("nested outdir layout (monorepo-style root)", async () => {
    using dir = tempDir("issue-3332", {
      "xxx/package.json": JSON.stringify({ name: "xxx", dependencies: { "tiny-dep": "1.0.0" } }),
      "xxx/node_modules/tiny-dep/package.json": JSON.stringify({
        name: "tiny-dep",
        version: "1.0.0",
        main: "index.js",
      }),
      "xxx/node_modules/tiny-dep/index.js": `module.exports = { dep: "tiny" };`,
      "xxx/repos/livex/store/src/util.ts": `export const util = () => "util";`,
      "xxx/repos/livex/web/src/index.ts": `
        import { util } from "../../store/src/util";
        import dep from "tiny-dep";
        console.log(util(), dep);
      `,
      "xxx/repos/livex/server/src/bundler/foo.ts": `
        import { util } from "../../../store/src/util";
        import dep from "tiny-dep";
        console.log("foo", util(), dep);
      `,
    });

    const root = path.join(String(dir), "xxx");
    const outdir = path.join(String(dir), "out");

    const result = await Bun.build({
      root,
      entrypoints: [
        path.join(root, "repos/livex/web/src/index.ts"),
        path.join(root, "repos/livex/server/src/bundler/foo.ts"),
      ],
      outdir,
      sourcemap: "external",
    });
    expect(result.success).toBe(true);

    const maps = result.outputs.filter(o => o.path.endsWith(".map"));
    expect(maps.length).toBe(2);

    for (const map of maps) {
      // Each map lands in a subdirectory of outdir mirroring the source tree,
      // so its directory differs from outdir. That is the case the bug broke.
      const mapDir = path.dirname(map.path);
      expect(mapDir).not.toBe(outdir);

      const json = JSON.parse(readFileSync(map.path, "utf8"));
      expect(Array.isArray(json.sources)).toBe(true);
      expect(json.sources.length).toBeGreaterThanOrEqual(3);

      for (const src of json.sources as string[]) {
        const resolved = path.resolve(mapDir, src);
        // Every source entry must resolve to a real file from the map's own
        // directory. Before the fix these resolved under out/repos/.../xxx/...
        // which does not exist.
        expect(existsSync(resolved), `source ${JSON.stringify(src)} in ${map.path} -> ${resolved}`).toBe(true);
      }
    }
  });

  test("flat outdir (single entrypoint in outdir root) still resolves", async () => {
    using dir = tempDir("issue-3332-flat", {
      "src/entry.ts": `
        import { helper } from "./lib/helper";
        console.log(helper());
      `,
      "src/lib/helper.ts": `export const helper = () => "hi";`,
    });

    const outdir = path.join(String(dir), "dist");
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "src/entry.ts")],
      outdir,
      sourcemap: "external",
    });
    expect(result.success).toBe(true);

    const [map] = result.outputs.filter(o => o.path.endsWith(".map"));
    expect(map).toBeDefined();
    // With a single entrypoint and no `root`, the map sits directly in outdir.
    expect(path.dirname(map.path)).toBe(outdir);

    const json = JSON.parse(readFileSync(map.path, "utf8"));
    for (const src of json.sources as string[]) {
      const resolved = path.resolve(path.dirname(map.path), src);
      expect(existsSync(resolved), `source ${JSON.stringify(src)} -> ${resolved}`).toBe(true);
    }
  });

  test("inline sourcemap in a nested chunk resolves from the map file", async () => {
    using dir = tempDir("issue-3332-inline", {
      "xxx/repos/app/src/util.ts": `export const util = () => 1;`,
      "xxx/repos/app/src/entry.ts": `
        import { util } from "./util";
        console.log(util());
      `,
      "xxx/repos/other/stub.ts": `export {};`,
    });

    const root = path.join(String(dir), "xxx");
    const outdir = path.join(String(dir), "out");
    const result = await Bun.build({
      root,
      entrypoints: [path.join(root, "repos/app/src/entry.ts"), path.join(root, "repos/other/stub.ts")],
      outdir,
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    const entry = result.outputs.find(o => o.path.endsWith("entry.js"));
    expect(entry).toBeDefined();
    const jsDir = path.dirname(entry!.path);
    expect(jsDir).not.toBe(outdir);

    const code = readFileSync(entry!.path, "utf8");
    const m = code.match(/sourceMappingURL=data:application\/json;[^,]+,([A-Za-z0-9+/=]+)/);
    expect(m).toBeTruthy();
    const json = JSON.parse(Buffer.from(m![1], "base64").toString("utf8"));
    for (const src of json.sources as string[]) {
      const resolved = path.resolve(jsDir, src);
      expect(existsSync(resolved), `source ${JSON.stringify(src)} -> ${resolved}`).toBe(true);
    }
  });
});
