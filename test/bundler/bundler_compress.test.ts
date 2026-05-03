import { describe, expect, test } from "bun:test";
import { gunzipSync, brotliDecompressSync, zstdDecompressSync } from "node:zlib";
import { tmpdirSync, bunExe, bunEnv } from "harness";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

describe("Bun.build compress", () => {
  function fixture(dir: string) {
    Bun.write(
      join(dir, "entry.js"),
      `import {greet} from "./dep.js";\nconsole.log(greet, ${JSON.stringify("x".repeat(2000))});\n`,
    );
    Bun.write(join(dir, "dep.js"), `export const greet = "hello world";\n`);
  }

  test("emits .gz/.br/.zst alongside outputs (outdir)", async () => {
    const dir = tmpdirSync();
    fixture(dir);
    const out = join(dir, "out");
    const result = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      outdir: out,
      compress: ["gzip", "br", "zstd"],
    });
    expect(result.success).toBe(true);

    const files = readdirSync(out).sort();
    expect(files).toEqual(["entry.js", "entry.js.br", "entry.js.gz", "entry.js.zst"]);

    const original = readFileSync(join(out, "entry.js"));
    expect(gunzipSync(readFileSync(join(out, "entry.js.gz"))).equals(original)).toBe(true);
    expect(brotliDecompressSync(readFileSync(join(out, "entry.js.br"))).equals(original)).toBe(true);
    expect(zstdDecompressSync(readFileSync(join(out, "entry.js.zst"))).equals(original)).toBe(true);

    const compressed = result.outputs.filter(o => o.kind === "compressed");
    expect(compressed.length).toBe(3);
  });

  test("returns compressed Blobs without outdir", async () => {
    const dir = tmpdirSync();
    fixture(dir);
    const result = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      compress: { gzip: true, level: "max" },
    });
    expect(result.success).toBe(true);

    const entry = result.outputs.find(o => o.kind === "entry-point")!;
    const gz = result.outputs.find(o => o.kind === "compressed" && o.path.endsWith(".gz"))!;
    expect(gz).toBeDefined();

    const original = Buffer.from(await entry.arrayBuffer());
    const decompressed = gunzipSync(Buffer.from(await gz.arrayBuffer()));
    expect(decompressed.equals(original)).toBe(true);
    expect(gz.size).toBeLessThan(entry.size);
  });

  test("compress: true enables gzip", async () => {
    const dir = tmpdirSync();
    fixture(dir);
    const result = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      compress: true,
    });
    const kinds = result.outputs.filter(o => o.kind === "compressed").map(o => o.path.split(".").pop());
    expect(kinds).toEqual(["gz"]);
  });

  test("compresses sourcemaps too", async () => {
    const dir = tmpdirSync();
    fixture(dir);
    const out = join(dir, "out");
    const result = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      outdir: out,
      sourcemap: "linked",
      compress: "gzip",
    });
    expect(result.success).toBe(true);
    const files = readdirSync(out).sort();
    expect(files).toContain("entry.js.map.gz");
    const map = readFileSync(join(out, "entry.js.map"));
    expect(gunzipSync(readFileSync(join(out, "entry.js.map.gz"))).equals(map)).toBe(true);
  });

  test("CLI --compress writes to outdir", async () => {
    const dir = tmpdirSync();
    fixture(dir);
    const out = join(dir, "out");
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "build", "./entry.js", "--outdir", out, "--compress=gzip,zstd", "--compress-level=max"],
      cwd: dir,
      env: bunEnv,
    });
    expect(proc.exitCode).toBe(0);
    const files = readdirSync(out).sort();
    expect(files).toEqual(["entry.js", "entry.js.gz", "entry.js.zst"]);
    const original = readFileSync(join(out, "entry.js"));
    expect(gunzipSync(readFileSync(join(out, "entry.js.gz"))).equals(original)).toBe(true);
  });
});
