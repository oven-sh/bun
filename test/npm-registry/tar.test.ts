import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildTarball, computeIntegrity, readPackageJson, readTarball } from "npm-registry";
import type { FileTree } from "./src/types";

const FILES = {
  "package.json": `${JSON.stringify({ name: "x", version: "1.0.0", bin: { x: "cli.js" } }, null, 2)}\n`,
  "cli.js": "#!/usr/bin/env node\nprocess.exit(0);\n",
  "lib/index.js": "module.exports = 1;\n",
};

/** Reads a golden source dir into the {@link FileTree} `buildTarball` takes. */
function readSourceTree(root: string): FileTree {
  const files: FileTree = {};
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else files[path] = readFileSync(join(root, path));
    }
  };
  walk("");
  return files;
}

const GOLDENS = join(import.meta.dir, "goldens");

describe("buildTarball", () => {
  // The oracle: real `npm pack` output. Compared on the tar payload,
  // not the .tgz bytes, so a zlib bump cannot churn it. See goldens/README.md.
  describe.each([
    { dir: "golden-plain", tgz: "golden-plain-1.0.0.tgz", mode: {} },
    { dir: "golden-with-bin", tgz: "golden-with-bin-1.0.0.tgz", mode: { "cli.js": 0o755 } },
    { dir: "golden-with-gyp", tgz: "golden-with-gyp-1.0.0.tgz", mode: {} },
    { dir: "golden-scoped", tgz: "golden-scoped-1.0.0.tgz", mode: {} },
    { dir: "golden-long-path", tgz: "golden-long-path-1.0.0.tgz", mode: {} },
  ])("byte-equals npm pack for $dir", ({ dir, tgz, mode }) => {
    test("gunzip(buildTarball(src)) === gunzip(npm pack src)", () => {
      const files = readSourceTree(join(GOLDENS, "src", dir));
      const mine = Bun.gunzipSync(buildTarball(files, { mode }).bytes);
      const npms = Bun.gunzipSync(readFileSync(join(GOLDENS, tgz)));
      expect(Buffer.from(mine).equals(Buffer.from(npms))).toBe(true);
    });
  });

  // A pinned known-answer hash of one canonical package. This is the
  // guard tar.ts's gzip comment refers to: it trips when zlib, the
  // compression level default, or the tar header encoding changes, and
  // it is what makes `bytes[9] = 0xff` an invariant rather than a
  // claim. The constant is allowed to change only when such a change
  // lands; regenerate it from the new output and say why in the commit.
  test("pinned known-answer sha512", () => {
    const { bytes } = buildTarball({ "package.json": '{"name":"canonical","version":"1.0.0"}\n' });
    expect(bytes[9]).toBe(0xff);
    expect(computeIntegrity(bytes).integrity).toMatchInlineSnapshot(
      `"sha512-LTPiu0U0O2Pfy+dl3ZvohGOVozxDeWg1H6DBVkT8wzlIxloxIYzblzxejT60VwETKlQYTjSPFW2HvX4jgeN9Ow=="`,
    );
  });

  test("round-trips through bun's own tar reader", async () => {
    const { bytes, fileCount, unpackedSize } = buildTarball(FILES, { mode: { "cli.js": 0o755 } });
    const { files, stats } = await readTarball(bytes);
    expect(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString()]))).toEqual(FILES);
    expect(stats).toEqual({ fileCount, unpackedSize });
  });

  test("everything lives under package/", async () => {
    const { bytes } = buildTarball(FILES);
    const entries = await new Bun.Archive(bytes).files();
    expect([...entries.keys()].sort()).toEqual(["package/cli.js", "package/lib/index.js", "package/package.json"]);
  });

  test("mode is expressible per entry and defaults to 0644", () => {
    // npm packages published from Windows routinely ship bins at 0644;
    // bun's `chmod_on_ok` is what makes them runnable. The writer must
    // be able to produce that shape, so mode is an input, not derived.
    const { bytes } = buildTarball(
      { "package.json": "{}", "a.js": "#!/usr/bin/env node\n", "b.js": "x", "c.js": "x" },
      { mode: { "b.js": 0o755 } },
    );
    const tar = Bun.gunzipSync(bytes);
    const modes: Record<string, number> = {};
    for (let offset = 0; offset + 512 <= tar.length; offset += 512) {
      const header = tar.subarray(offset, offset + 512);
      const name = Buffer.from(header.subarray(0, 100)).toString().replace(/\0.*$/s, "");
      if (name.length === 0) break;
      modes[name] = parseInt(Buffer.from(header.subarray(100, 108)).toString().trim(), 8);
      const size = parseInt(Buffer.from(header.subarray(124, 136)).toString().trim(), 8);
      offset += Math.ceil(size / 512) * 512;
    }
    expect(modes).toEqual({
      "package/package.json": 0o644,
      "package/a.js": 0o644,
      "package/b.js": 0o755,
      "package/c.js": 0o644,
    });
  });

  test("rejects a non-ASCII entry path loudly", () => {
    // The ustar header has no declared name encoding, and
    // `Bun.Archive` (this library's own reader) resolves names through
    // the process locale: under a `C` locale it reads `café.js` back
    // as "". Refusing to build one is the only outcome that cannot
    // silently lose an entry.
    expect(() => buildTarball({ "package.json": "{}", "café.js": "a" })).toThrow(
      'non-ASCII tarball entry path is not supported: "café.js"',
    );
  });

  test("splits paths longer than 100 bytes across the ustar prefix field", async () => {
    const deep = `${"a".repeat(80)}/${"b".repeat(80)}/leaf.txt`;
    const { bytes } = buildTarball({ "package.json": "{}", [deep]: "x" });
    const { files } = await readTarball(bytes);
    expect(Object.keys(files).sort()).toEqual([deep, "package.json"]);
  });

  test("rejects a path that cannot be represented", () => {
    expect(() => buildTarball({ [Buffer.alloc(300, "a").toString()]: "x" })).toThrow("too long");
  });

  test("rejects traversal in entry paths", () => {
    expect(() => buildTarball({ "../escape": "x" })).toThrow("invalid tarball entry path");
    expect(() => buildTarball({ "/abs": "x" })).toThrow("invalid tarball entry path");
  });
});

describe("readPackageJson", () => {
  test("reads package/package.json out of a tarball", async () => {
    const { bytes } = buildTarball(FILES);
    expect(await readPackageJson(bytes)).toEqual({ name: "x", version: "1.0.0", bin: { x: "cli.js" } });
  });

  test("throws on a tarball with no package.json", async () => {
    const { bytes } = buildTarball({ "readme.md": "hi" });
    await expect(readPackageJson(bytes)).rejects.toThrow("no package.json");
  });
});
