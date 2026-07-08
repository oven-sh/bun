import { describe, expect, test } from "bun:test";
import { buildTarball, readPackageJson, readTarball } from "npm-registry";

const FILES = {
  "package.json": `${JSON.stringify({ name: "x", version: "1.0.0", bin: { x: "cli.js" } }, null, 2)}\n`,
  "cli.js": "#!/usr/bin/env node\nprocess.exit(0);\n",
  "lib/index.js": "module.exports = 1;\n",
};

describe("buildTarball", () => {
  test("is byte-for-byte deterministic", async () => {
    const a = buildTarball(FILES);
    // Cross a wall-clock second so a writer that stamped `now` into the
    // tar headers (as Bun.Archive does) would produce different bytes.
    await Bun.sleep(1100);
    const b = buildTarball(FILES);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a).toEqual(b);
  });

  test("round-trips through an independent tar reader", async () => {
    const { bytes, fileCount, unpackedSize } = buildTarball(FILES);
    const { files, stats } = await readTarball(bytes);
    expect(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString()]))).toEqual(FILES);
    expect(stats).toEqual({ fileCount, unpackedSize });
  });

  test("everything lives under package/", async () => {
    const { bytes } = buildTarball(FILES);
    const entries = await new Bun.Archive(bytes).files();
    expect([...entries.keys()].sort()).toEqual(["package/cli.js", "package/lib/index.js", "package/package.json"]);
  });

  test("a shebang or an `executable` entry sets the execute bit", () => {
    const { bytes } = buildTarball(
      { "package.json": "{}", "a.js": "#!/usr/bin/env node\n", "b.js": "x", "c.js": "x" },
      { executable: ["b.js"] },
    );
    // Read the mode field straight out of each 512-byte ustar header so
    // the assertion is about the bytes the registry serves, not about
    // what this platform's filesystem does with an execute bit.
    const tar = Bun.gunzipSync(bytes);
    const modes: Record<string, number> = {};
    for (let offset = 0; offset + 512 <= tar.length; offset += 512) {
      const header = tar.subarray(offset, offset + 512);
      const name = Buffer.from(header.subarray(0, 100)).toString().replace(/\0.*$/s, "");
      if (name.length === 0) break;
      modes[name] = parseInt(Buffer.from(header.subarray(100, 108)).toString().replace(/\0.*$/s, ""), 8);
      const size = parseInt(Buffer.from(header.subarray(124, 136)).toString().replace(/\0.*$/s, ""), 8);
      offset += Math.ceil(size / 512) * 512;
    }
    expect(modes).toEqual({
      "package/package.json": 0o644,
      "package/a.js": 0o755,
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
