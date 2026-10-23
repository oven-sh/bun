import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isWindows, tempDir, type DirectoryTree } from "harness";
import { join, sep } from "path";
import { TestRegistry, toml } from "registry";

const registry = new TestRegistry();
beforeAll(() => registry.start());
afterAll(() => registry.stop());

// ───────────────────────────── running bun ─────────────────────────────

/** `project`, `cache`, `tmp` (bun's temporary directory) and `victim` are siblings, so `../victim` is a way out of each. */
function sandbox(tree: { project?: DirectoryTree; cache?: DirectoryTree } = {}) {
  const root = tempDir("cache-pack", {
    project: { "package.json": "{}", ...tree.project },
    cache: tree.cache ?? {},
    tmp: {},
    victim: { "keep.txt": "untouched" },
  });
  const at = (name: string) => join(String(root), name);
  return {
    project: at("project"),
    cache: at("cache"),
    tmp: at("tmp"),
    victim: at("victim"),
    at,
    [Symbol.dispose]: () => root[Symbol.dispose](),
  };
}
type Sandbox = ReturnType<typeof sandbox>;

async function bun(box: Sandbox, args: string[], options: { cache?: string; cwd?: string } = {}) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd: options.cwd ?? box.project,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: options.cache ?? box.cache, BUN_TMPDIR: box.tmp },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

/**
 * One line per file, directory and link below `dir`. With `identity`, also the inode and the modification time:
 * two equal snapshots then mean that nothing was replaced, rewritten, added or removed.
 */
function snapshot(dir: string, identity: boolean): string[] {
  const lines: string[] = [];
  (function walk(abs: string, rel: string) {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      const stat = lstatSync(path, { bigint: true });
      const id = identity ? ` ino=${stat.ino} mtime=${stat.mtimeNs}` : "";
      if (stat.isSymbolicLink()) {
        lines.push(`${rel}${name} -> ${readlinkSync(path)}${id}`);
      } else if (stat.isDirectory()) {
        lines.push(`${rel}${name}/${id}`);
        walk(path, `${rel}${name}/`);
      } else {
        const executable = !isWindows && (stat.mode & 0o111n) !== 0n ? " +x" : "";
        lines.push(`${rel}${name}${executable} ${Bun.SHA1.hash(readFileSync(path), "hex")}${id}`);
      }
    }
  })(dir, "");
  return lines;
}

/** The names of the entries in a cache directory: not the manifests, not the index directories. */
function entryNames(cache: string): string[] {
  const names: string[] = [];
  for (const name of readdirSync(cache)) {
    if (name.indexOf("@", 1) !== -1) names.push(name);
    else if (name.startsWith("@"))
      for (const scoped of readdirSync(join(cache, name))) if (scoped.includes("@")) names.push(`${name}/${scoped}`);
  }
  return names.sort();
}

const entries = (cache: string) =>
  Object.fromEntries(entryNames(cache).map(name => [name, snapshot(join(cache, name), false)]));

// ───────────────────────────── writing packs ─────────────────────────────

const MAGIC = Buffer.from("BUNCACHEPACK\0v1\n");
const END = 0;
const PACKAGE = 1;
const FILE = 2;
const SYMLINK = 3;
const DIRECTORY = 4;
const CHECKSUM = 5;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

type Bytes = string | Buffer;

/** `u8 kind | u32 path_len | path | u32 mode | u64 size | bytes`. `lie` replaces a length by one that is not true. */
function record(kind: number, path: Bytes, mode = 0, data: Bytes = "", lie: { pathLen?: number; size?: bigint } = {}) {
  const p = Buffer.from(path);
  const d = Buffer.from(data);
  const header = Buffer.alloc(1 + 4 + p.length + 4 + 8);
  header[0] = kind;
  header.writeUInt32LE(lie.pathLen ?? p.length, 1);
  p.copy(header, 5);
  header.writeUInt32LE(mode, 5 + p.length);
  header.writeBigUInt64LE(lie.size ?? BigInt(d.length), 9 + p.length);
  return Buffer.concat([header, d]);
}
const file = (path: Bytes, data: Bytes = "", mode = 0o644) => record(FILE, path, mode, data);
const dir = (path: Bytes) => record(DIRECTORY, path, 0o755);
const link = (path: Bytes, target: Bytes) => record(SYMLINK, path, 0o777, target);
const end = () => record(END, "");
const packageJson = file("package.json", "{}");

function u64(value: bigint) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

/** The records of a package, closed by the checksum that `name` and they have. */
function body(name: Bytes, records: Buffer[]) {
  const hashed = Buffer.concat([...records, record(CHECKSUM, "", 0, "", { size: 8n })]);
  return Buffer.concat([hashed, u64(Bun.hash.wyhash(Buffer.concat([Buffer.from(name), hashed]), 0n))]);
}
const pkg = (name: Bytes, records: Buffer[] = [packageJson]) => record(PACKAGE, name, 0, body(name, records));
const packOf = (...packages: Buffer[]) => Buffer.concat([MAGIC, ...packages, end()]);

// ───────────────────────────── hostile packs ─────────────────────────────

const sha = "0123456789abcdef0123456789abcdef01234567";

/** One entry of each kind, and the other things that live in a cache directory. */
const populatedCache: DirectoryTree = {
  "present@1.0.0@@@1": { "package.json": `{"name":"present","version":"1.0.0"}`, "index.js": "original" },
  "@scope": { "present@1.0.0@@@1": { "package.json": "{}" } },
  "@T@85f77fa09e18a07f@@@1": { "package.json": "{}" },
  [`@G@${sha}`]: { ".bun-tag": sha, "package.json": "{}" },
  "@GH@owner-repo-0123456@@@1": { ".bun-tag": "owner-repo-0123456", "package.json": "{}" },
  present: {},
  links: { "keep.txt": "" },
  "0123456789abcdef.git": { config: "[core]\n\tbare = true\n", HEAD: "ref: refs/heads/main\n" },
  "0123456789abcdef-0123456789abcdef.npm": "manifest",
};

type Hostile = {
  title: string;
  /** What follows a well-formed package that the cache does not have, which must not be unpacked either. */
  packages?: Buffer[] | ((box: Sandbox) => Buffer[]);
  /** The whole file, where that is the point. */
  pack?: Buffer;
  error: string | RegExp;
};

const badName = (name: Bytes, title = JSON.stringify(name.toString())): Hostile => ({
  title: `entry name ${title}`,
  packages: [pkg(name)],
  error: "invalid cache entry name",
});

const inPackage = (
  title: string,
  records: Buffer[] | ((box: Sandbox) => Buffer[]),
  error: string | RegExp,
): Hostile => ({
  title,
  packages: box => [pkg("evil@1.0.0@@@1", [packageJson, ...(typeof records === "function" ? records(box) : records)])],
  error,
});

const badPath = (path: Bytes, title = JSON.stringify(path.toString())): Hostile[] => [
  inPackage(`file path ${title}`, [file(path, "pwned")], "unsafe path"),
  inPackage(`directory path ${title}`, [dir(path)], "unsafe path"),
  inPackage(`symlink path ${title}`, [link(path, "package.json")], "unsafe path"),
];

/** Windows refuses every symlink record, whatever is wrong with it. */
const badLink = (title: string, records: Buffer[] | ((box: Sandbox) => Buffer[]), error: string | RegExp): Hostile =>
  inPackage(title, records, isWindows ? /symlinks cannot be unpacked|ENOENT|unsafe path/ : error);

const evil = "evil@1.0.0@@@1";
const evilBody = body(evil, [packageJson]);

const hostile: Hostile[] = [
  // Names that are not entries, or lead somewhere else.
  ...[
    "",
    ".",
    "..",
    "../x@1.0.0@@@1",
    "../victim",
    "/x@1.0.0@@@1",
    "a/../x@1.0.0@@@1",
    "x@1.0.0@@@1/",
    "x@1.0.0@@@1/.",
  ].map(name => badName(name)),
  ...["@scope//x@1.0.0@@@1", "a/x@1.0.0@@@1", "@scope/a/x@1.0.0@@@1", "@scope@1.0.0@@@1", "@/x@1.0.0@@@1"].map(name =>
    badName(name),
  ),
  ...["x\\y@1.0.0@@@1", "C:\\x@1.0.0@@@1", "C:x@1.0.0@@@1", "x\0y@1.0.0@@@1", "x\ny@1.0.0@@@1", "x y@1.0.0@@@1"].map(
    name => badName(name),
  ),
  badName(Buffer.from([0x78, 0xff, ...Buffer.from("@1.0.0@@@1")]), "that is not UTF-8"),
  badName(Buffer.alloc(256, "x").toString() + "@1.0.0@@@1", "longer than a file name"),
  // Other inhabitants of the cache directory.
  ...["links", ".tmp", ".tmp@1.0.0@@@1", "@scope/.x@1.0.0@@@1", "present", "lodash", "0123456789abcdef.git"].map(name =>
    badName(name),
  ),
  badName("0123456789abcdef-0123456789abcdef.npm"),
  // Into an entry that exists.
  ...[
    "@T@85f77fa09e18a07f@@@1/x",
    "@T@85f77fa09e18a07f@@@1/x@1.0.0@@@1",
    "@t@85f77fa09e18a07f@@@1/x@1.0.0@@@1",
    `@G@${sha}/node_modules`,
    `@G@${sha}/x@1.0.0@@@1`,
    "@GH@owner-repo-0123456@@@1/x@1.0.0@@@1",
    "present@1.0.0@@@1/x@1.0.0@@@1",
    "@scope/present@1.0.0@@@1/x@1.0.0@@@1",
  ].map(name => badName(name)),
  // Nearly the shape of an entry.
  ...[
    "@T@@@@1",
    "@T@abc",
    "@T@../x@@@1",
    "@T@a b@@@1",
    "@GH@-rf@@@1",
    "@GH@owner-repo-0123456",
    "@G@",
    `@G@${sha}@@@1`,
  ].map(name => badName(name)),
  ...["x@", "x@1.0.0", "x@1.0@@@1", "x@1.0.0.0@@@1", "x@latest@@@1", "x@1.0.0@@@", "x@1.0.0@@@x", "x@1.0.0@@@1x"].map(
    name => badName(name),
  ),
  ...[
    "x@1.0.0-beta@@@1",
    "x@1.0.0-0123456789ABCDEF@@@1",
    "x@1.0.0+0123456789abcdef@@@1",
    "x@1.0.0-0123456789abcde@@@1",
  ].map(name => badName(name)),
  ...["x@1.0.0@@@@1", "x@1.0.0@@@@@1", "x@1.0.0@@a/b@@@1", "x@1.0.0@@a@b@@@1", "x@1.0.0@@@1_patch_hash=abc"].map(name =>
    badName(name),
  ),

  // Paths that lead out of the package.
  ...[
    "",
    ".",
    "..",
    "../x",
    "../../victim/pwned",
    "/x",
    "a/../x",
    "a/../../x",
    "./x",
    "a/./x",
    "a//x",
    "x/",
    "a\\x",
  ].flatMap(path => badPath(path)),
  ...badPath("a\0b"),
  inPackage("absolute file path", box => [file(join(box.victim, "pwned"), "pwned")], "unsafe path"),
  inPackage(
    "path longer than any path",
    [file(Buffer.alloc(5000, "a/").toString() + "a", "pwned")],
    "path is too long",
  ),

  // Overwriting, and records that contradict each other.
  inPackage("the same file twice", [file("a", "1"), file("a", "2")], "EEXIST"),
  inPackage("package.json twice", [file("package.json", "{}")], "EEXIST"),
  inPackage("the same directory twice", [dir("a"), dir("a")], "EEXIST"),
  inPackage("a directory over a file", [file("a"), dir("a")], "EEXIST"),
  inPackage("a file over a directory", [dir("a"), file("a")], /EEXIST|EISDIR/),
  inPackage("a file below a file", [file("a"), file("a/b")], /ENOTDIR|ENOENT/),
  inPackage("a file before its directory", [file("a/b"), dir("a")], "ENOENT"),
  inPackage("a directory before its parent", [dir("a/b"), dir("a")], "ENOENT"),
  // macOS has no such file names.
  inPackage(
    "the same file twice, its name in Latin-1",
    [file(Buffer.from("caf\xe9", "latin1"), "1"), file(Buffer.from("caf\xe9", "latin1"), "2")],
    /EEXIST|EILSEQ/,
  ),
  inPackage("a file without its directory, its name in Latin-1", [file(Buffer.from("a/caf\xe9", "latin1"))], "ENOENT"),
  inPackage(
    "a file without its directory, that name in Latin-1",
    [file(Buffer.from("a\xafb/c", "latin1"))],
    /ENOENT|EILSEQ/,
  ),
  { title: "the same package twice", packages: [pkg(evil), pkg(evil)], error: "packages out of order" },
  {
    title: "packages out of order",
    packages: [pkg("b@1.0.0@@@1"), pkg("a@1.0.0@@@1")],
    error: "packages out of order",
  },

  // Records in the wrong place.
  {
    title: "a file outside of a package",
    packages: [packageJson],
    error: /record outside of a package|malformed record/,
  },
  {
    title: "a directory outside of a package",
    packages: [record(DIRECTORY, "a")],
    error: "record outside of a package",
  },
  {
    title: "a checksum outside of a package",
    packages: [record(CHECKSUM, "", 0, u64(0n))],
    error: "outside of a package",
  },
  inPackage("a package inside a package", [pkg("inner@1.0.0@@@1")], "unknown kind of record"),
  inPackage("the end inside a package", [end()], "unsafe path"),
  inPackage("an unknown kind of record", [record(6, "a")], "unknown kind of record"),
  inPackage("kind 255", [record(255, "a")], "unknown kind of record"),
  inPackage("a directory with contents", [record(DIRECTORY, "a", 0o755, "x")], "directory record with contents"),
  { title: "a package record with a mode", packages: [record(PACKAGE, evil, 1, evilBody)], error: "malformed record" },

  // Checksums.
  {
    title: "a package without a checksum",
    packages: [record(PACKAGE, evil, 0, packageJson)],
    error: "record runs past end of package",
  },
  {
    title: "a wrong checksum",
    packages: [record(PACKAGE, evil, 0, Buffer.concat([evilBody.subarray(0, -8), u64(0n)]))],
    error: "checksum mismatch",
  },
  {
    title: "the checksum of the same files under another name",
    packages: [record(PACKAGE, evil, 0, body("good@1.0.0@@@1", [packageJson]))],
    error: "checksum mismatch",
  },
  {
    title: "records after the checksum",
    packages: [record(PACKAGE, evil, 0, Buffer.concat([evilBody, file("late", "pwned")]))],
    error: "malformed checksum record",
  },
  {
    title: "a short checksum",
    packages: [record(PACKAGE, evil, 0, Buffer.concat([packageJson, record(CHECKSUM, "", 0, "1234")]))],
    error: "malformed checksum record",
  },
  {
    title: "a checksum with a path",
    packages: [record(PACKAGE, evil, 0, Buffer.concat([packageJson, record(CHECKSUM, "a", 0, u64(0n))]))],
    error: "malformed checksum record",
  },
  {
    title: "an npm package without package.json",
    packages: [pkg(evil, [file("index.js")])],
    error: "package is incomplete",
  },
  { title: "an empty npm package", packages: [pkg(evil, [])], error: "package is incomplete" },
  { title: "a git package without .bun-tag", packages: [pkg("@G@abcdef")], error: "package is incomplete" },

  // Lengths that are not true.
  {
    title: "a package one byte shorter than its records",
    packages: [record(PACKAGE, evil, 0, evilBody, { size: BigInt(evilBody.length - 1) })],
    error: /malformed checksum record|runs past end/,
  },
  {
    title: "a package one byte longer than its records",
    packages: [record(PACKAGE, evil, 0, evilBody, { size: BigInt(evilBody.length + 1) })],
    error: "malformed checksum record",
  },
  {
    title: "a package of 2^64-1 bytes",
    packages: [record(PACKAGE, evil, 0, evilBody, { size: U64_MAX })],
    error: "truncated",
  },
  {
    title: "a package of 2^63 bytes",
    packages: [record(PACKAGE, evil, 0, evilBody, { size: 1n << 63n })],
    error: "truncated",
  },
  inPackage("a file of 2^64-1 bytes", [record(FILE, "a", 0o644, "x", { size: U64_MAX })], "truncated"),
  inPackage("a file of 2^63 bytes", [record(FILE, "a", 0o644, "x", { size: 1n << 63n })], "truncated"),
  inPackage("a file of 1 TB", [record(FILE, "a", 0o644, "x", { size: 1n << 40n })], "truncated"),
  inPackage("a file that swallows the checksum", [record(FILE, "a", 0o644, "x", { size: 30n })], "runs past end"),
  inPackage("a path of 2^32-1 bytes", [record(FILE, "a", 0o644, "x", { pathLen: 0xffff_ffff })], "path is too long"),
  inPackage(
    "a path that swallows the rest",
    [record(FILE, "a", 0o644, "x", { pathLen: 60 })],
    /truncated|unsafe path|past end/,
  ),
  inPackage("a symlink target of 10 000 bytes", [link("l", Buffer.alloc(10_000, "a"))], "symlink target is too long"),
  inPackage("a symlink target of 2^64-1 bytes", [record(SYMLINK, "l", 0o777, "a", { size: U64_MAX })], "truncated"),

  // The file as a whole.
  { title: "an empty file", pack: Buffer.alloc(0), error: "not a bun cache pack" },
  { title: "something else", pack: Buffer.from("hello"), error: "not a bun cache pack" },
  {
    title: "a gzip header",
    pack: Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0]), Buffer.alloc(64)]),
    error: "not a bun cache pack",
  },
  {
    title: "another version",
    pack: Buffer.concat([Buffer.from("BUNCACHEPACK\0v2\n"), end()]),
    error: "not a bun cache pack",
  },
  { title: "the magic alone", pack: MAGIC, error: "truncated" },
  { title: "no end record", pack: Buffer.concat([MAGIC, pkg(evil)]), error: "truncated" },
  {
    title: "a byte after the end",
    pack: Buffer.concat([packOf(pkg(evil)), Buffer.from([0])]),
    error: "trailing bytes after pack",
  },
  {
    title: "a package after the end",
    pack: Buffer.concat([packOf(), pkg(evil), end()]),
    error: "trailing bytes after pack",
  },
  {
    title: "an end record with a path",
    pack: Buffer.concat([MAGIC, pkg(evil), record(END, "a")]),
    error: "trailing bytes after pack",
  },
  {
    title: "an end record with contents",
    pack: Buffer.concat([MAGIC, pkg(evil), record(END, "", 0, "a")]),
    error: "trailing bytes after pack",
  },
  {
    title: "an end record with a mode",
    pack: Buffer.concat([MAGIC, pkg(evil), record(END, "", 1)]),
    error: "malformed record",
  },

  // Symlinks.
  badLink("absolute symlink target", box => [link("l", box.victim)], "unsafe symlink target"),
  badLink("symlink to /", [link("l", "/")], "unsafe symlink target"),
  badLink("empty symlink target", [link("l", "")], "unsafe symlink target"),
  badLink("symlink target with a NUL", [link("l", "a\0/../../victim")], "unsafe symlink target"),
  badLink("symlink to the cache directory", [link("l", "..")], "unsafe symlink target"),
  badLink("symlink to another entry", [link("l", "../present@1.0.0@@@1")], "unsafe symlink target"),
  badLink("symlink out of the cache", [link("l", "../../victim")], "unsafe symlink target"),
  badLink("symlink out of a subdirectory", [link("bin/cli", "../../victim")], "unsafe symlink target"),
  badLink("symlink that leaves and comes back", [link("l", "../evil@1.0.0@@@1/package.json")], "unsafe symlink target"),
  badLink("`..` after a name", [dir("a"), link("l", "a/../package.json")], "unsafe symlink target"),
  badLink(
    "a file through a symlink that leads out",
    [link("esc", "./../../victim"), file("esc/pwned", "pwned")],
    "unsafe symlink target",
  ),
  badLink(
    "a file through a symlink that stays inside",
    [dir("real"), link("esc", "real"), file("esc/pwned", "pwned")],
    "ENOENT",
  ),
  badLink(
    "the file first, then the symlink",
    [dir("esc"), file("esc/pwned"), link("esc", "../../victim")],
    "unsafe symlink",
  ),
  badLink("a symlink over a directory", [dir("a"), link("a", "package.json")], "symlink collides"),
  badLink("a symlink over a file", [file("a"), link("a", "package.json")], "symlink collides"),
  badLink("a symlink over package.json", [link("package.json", "index.js")], "symlink collides"),
  badLink("the same symlink twice", [link("l", "package.json"), link("l", "index.js")], "symlink collides"),
  badLink(
    "a symlink below a symlink",
    [dir("real"), link("l", "real"), link("l/x", "../package.json")],
    "symlink collides",
  ),
  badLink(
    "a symlink below a later symlink",
    [dir("real"), link("l/x", "../package.json"), link("l", "real")],
    "collides",
  ),
  badLink(
    "out through a link to `.`",
    [link("same", "."), link("x", "same/same/../../victim")],
    "unsafe symlink target",
  ),
  badLink(
    "out through a link to `..`",
    [dir("a"), link("out", "a/up/../.."), link("a/up", "..")],
    "unsafe symlink target",
  ),
];

/** Legal names on POSIX. On Windows: devices, streams, drives, and names that Win32 reads as other names. */
const windowsOnly = [
  ...["C:x", "C:/x", "a:b", "a.js:stream", "a::$DATA", "a/b:c"],
  ...[
    "NUL",
    "nul",
    "nul.txt",
    "NUL.tar.gz",
    "aux.js",
    "CON",
    "con.ts",
    "PRN",
    "COM1",
    "com9.log",
    "COM0",
    "LPT1",
    "lpt9.x",
  ],
  ...["CONIN$", "conout$", "NUL .txt", "COM¹", "lpt².txt", "a/NUL", "NUL/a"],
  ...["x.", "x..", "x ", "x. ", "...", ".. ", ". ", "a./b", "a /b"],
  ...["a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "a\x01b", "a\x1fb", "a\x7fb"],
];

const dryRuns = [
  { title: "--dry-run", flags: ["--dry-run"], config: {} },
  { title: "dryRun = true in bunfig.toml", flags: [], config: { dryRun: true } },
];

describe("bun pm cache unpack", () => {
  describe("refuses, and leaves the cache as it was:", () => {
    const rows = isWindows ? [...hostile, ...windowsOnly.flatMap(path => badPath(path))] : hostile;

    test.concurrent.each(rows.map(row => [row.title, row] as const))("%s", async (_, row) => {
      using box = sandbox({ cache: populatedCache });
      const packages = typeof row.packages === "function" ? row.packages(box) : row.packages;
      writeFileSync(box.at("hostile.pack"), row.pack ?? packOf(pkg("0first@1.0.0@@@1"), ...packages!));
      const before = snapshot(box.cache, true);

      const { out, err, code } = await bun(box, ["pm", "cache", "unpack", box.at("hostile.pack")]);

      expect(err).toContain("error: bun pm cache unpack failed: ");
      expect(err).toMatch(row.error);
      expect(out).toBe("");
      expect(snapshot(box.cache, true)).toEqual(before);
      expect(snapshot(box.victim, false)).toEqual([`keep.txt ${Bun.SHA1.hash("untouched", "hex")}`]);
      expect(readdirSync(box.tmp)).toEqual([]);
      expect(code).toBe(1);
    });
  });

  test.concurrent("refuses a directory, and a file that does not exist", async () => {
    using box = sandbox({ cache: populatedCache });
    const before = snapshot(box.cache, true);
    let r = await bun(box, ["pm", "cache", "unpack", box.victim]);
    expect(r.err).toContain("error: bun pm cache unpack failed: ");
    expect(r.code).toBe(1);
    r = await bun(box, ["pm", "cache", "unpack", box.at("nothing.pack")]);
    expect(r.err).toContain("ENOENT");
    expect(r.code).toBe(1);
    expect(snapshot(box.cache, true)).toEqual(before);
    expect(readdirSync(box.tmp)).toEqual([]);
  });

  // The pack the next three tests damage. It has every kind of record, and two packages.
  const sound = packOf(
    pkg("@scope/b@1.0.0@@@1", [packageJson, dir("lib"), file("lib/index.js", "module.exports = 1;")]),
    pkg("a@1.0.0@@@1", [
      packageJson,
      dir("bin"),
      file("bin/a.js", "#!/usr/bin/env bun", 0o755),
      ...(isWindows ? [] : [link("a", "bin/a.js")]),
    ]),
  );

  /** Every damaged pack is refused, so they can all be thrown at the same empty cache at once. */
  async function expectAllRefused(box: Sandbox, packs: Buffer[]) {
    const results: { i: number; failed: boolean; code: number }[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (let i = next++; i < packs.length; i = next++) {
          writeFileSync(box.at(`${i}.pack`), packs[i]);
          const { err, code } = await bun(box, ["pm", "cache", "unpack", box.at(`${i}.pack`)]);
          results[i] = { i, failed: err.includes("error: bun pm cache unpack failed: "), code };
        }
      }),
    );
    expect(results).toEqual(packs.map((_, i) => ({ i, failed: true, code: 1 })));
    expect(readdirSync(box.cache)).toEqual([]);
    expect(readdirSync(box.tmp)).toEqual([]);
  }

  test.concurrent("the valid pack is valid", async () => {
    using box = sandbox();
    writeFileSync(box.at("sound.pack"), sound);
    const { out, err, code } = await bun(box, ["pm", "cache", "unpack", box.at("sound.pack")]);
    expect(err).toBe("");
    expect(out).toContain("Unpacked 2 packages (2 new, 0 already cached, ");
    expect(entryNames(box.cache)).toEqual(["@scope/b@1.0.0@@@1", "a@1.0.0@@@1"]);
    expect(code).toBe(0);
  });

  test.concurrent.each(dryRuns)("$title checks the pack and leaves the cache as it was", async ({ flags, config }) => {
    using box = sandbox({ cache: populatedCache, project: { "bunfig.toml": toml({ install: config }) } });
    writeFileSync(box.at("sound.pack"), sound);
    writeFileSync(box.at("cut.pack"), sound.subarray(0, sound.length - 1));
    const before = snapshot(box.cache, true);

    let r = await bun(box, ["pm", "cache", "unpack", box.at("sound.pack"), ...flags]);
    expect(r.err).toBe("");
    expect(r.out).toContain("Would unpack 2 packages (2 new, 0 already cached, ");
    expect(r.code).toBe(0);

    r = await bun(box, ["pm", "cache", "unpack", box.at("cut.pack"), ...flags]);
    expect(r.err).toContain("error: bun pm cache unpack failed: ");
    expect(r.code).toBe(1);

    expect(snapshot(box.cache, true)).toEqual(before);
    expect(readdirSync(box.tmp)).toEqual([]);
  });

  test.concurrent("refuses a pack that is cut at, before or after any record boundary", async () => {
    using box = sandbox();
    // Walk the records, descending into packages, to find where each one starts.
    const boundaries = new Set<number>();
    for (let at = MAGIC.length; at < sound.length;) {
      boundaries.add(at);
      const pathLen = sound.readUInt32LE(at + 1);
      const header = 1 + 4 + pathLen + 4 + 8;
      at += header + (sound[at] === PACKAGE ? 0 : Number(sound.readBigUInt64LE(at + header - 8)));
    }
    const cuts = new Set<number>([0, 1, MAGIC.length - 1]);
    for (const at of boundaries) for (const cut of [at - 1, at, at + 1, at + 5]) if (cut < sound.length) cuts.add(cut);
    expect(boundaries.size).toBe(isWindows ? 11 : 12);
    await expectAllRefused(
      box,
      [...cuts].map(cut => sound.subarray(0, cut)),
    );
  });

  test.concurrent("refuses a pack in which any one byte has changed", async () => {
    using box = sandbox();
    // A fixed sample. BUN_CACHE_PACK_FUZZ=all tries every byte, BUN_CACHE_PACK_FUZZ=<n> tries n of them.
    const wanted = process.env.BUN_CACHE_PACK_FUZZ;
    const count = wanted === "all" ? sound.length : Math.min(Number(wanted) || 24, sound.length);
    const stride = sound.length / count;
    const packs: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const at = Math.floor(i * stride);
      const damaged = Buffer.from(sound);
      damaged[at] ^= 1 << (i % 8);
      packs.push(damaged);
    }
    await expectAllRefused(box, packs);
  });

  test.concurrent.skipIf(isWindows)(
    "keeps every symlink inside its package, whatever the file system folds",
    async () => {
      // Refused where `A/UP` is `a/up`, harmless where it is not.
      const packs = {
        ascii: [dir("a"), link("a/up", ".."), link("A/UP/A/UP/out", "../../../..")],
        unicode: [dir("ä"), link("ä/up", ".."), link("Ä/UP/Ä/UP/out", "../../../..")],
        target: [dir("ä"), link("ä/up", ".."), link("x", "Ä/up/Ä/up/victim")],
      };
      for (const [name, records] of Object.entries(packs)) {
        using box = sandbox();
        writeFileSync(box.at("fold.pack"), packOf(pkg(evil, [packageJson, ...records])));
        const { err, code } = await bun(box, ["pm", "cache", "unpack", box.at("fold.pack")]);
        if (code === 0) {
          const root = realpathSync(join(box.cache, evil));
          for (const line of snapshot(root, false)) {
            const [path, target] = line.split(" -> ");
            if (target === undefined || !existsSync(join(root, path))) continue;
            expect({ name, path, inside: (realpathSync(join(root, path)) + sep).startsWith(root + sep) }).toEqual({
              name,
              path,
              inside: true,
            });
          }
        } else {
          expect(err).toContain("symlink collides");
          expect(readdirSync(box.cache)).toEqual([]);
        }
        expect(readdirSync(box.tmp)).toEqual([]);
      }
    },
  );

  test.concurrent.skipIf(isWindows)(
    "restores symlinks that stay inside, modes without setuid, and names only Windows minds",
    async () => {
      using box = sandbox();
      const names = windowsOnly.filter(name => !name.includes("/"));
      writeFileSync(
        box.at("fine.pack"),
        packOf(
          pkg("fine@1.0.0@@@1", [
            packageJson,
            dir("lib"),
            file("lib/cli.js", "cli"),
            dir("real"),
            file("real/inner", "inner"),
            link("bin/cli", "../lib/cli.js"),
            link("to-link", "./bin/cli"),
            link("lnk", "real"),
            link("through", "lnk/inner"),
            link("dangling", "lib/nothing"),
            file("setuid", "", 0o6777),
            file("unreadable", "", 0),
            dir("odd"),
            // A directory each: `nul` is `NUL` where the file system folds case.
            ...names.flatMap((name, i) => [dir(`odd/${i}`), file(`odd/${i}/${name}`, name)]),
          ]),
        ),
      );
      const { err, code } = await bun(box, ["pm", "cache", "unpack", box.at("fine.pack")]);
      expect(err).toBe("");
      const root = join(box.cache, "fine@1.0.0@@@1");
      expect(readlinkSync(join(root, "bin", "cli"))).toBe("../lib/cli.js");
      expect(readFileSync(join(root, "to-link"), "utf8")).toBe("cli");
      expect(readFileSync(join(root, "through"), "utf8")).toBe("inner");
      expect(readlinkSync(join(root, "dangling"))).toBe("lib/nothing");
      // The umask may take more away.
      expect(lstatSync(join(root, "setuid")).mode & 0o7022).toBe(0);
      expect(lstatSync(join(root, "setuid")).mode & 0o700).toBe(0o700);
      expect(lstatSync(join(root, "unreadable")).mode & 0o777).toBe(0o600);
      expect(names.map((_, i) => readdirSync(join(root, "odd", `${i}`)))).toEqual(names.map(name => [name]));
      expect(code).toBe(0);
    },
  );

  test.concurrent("doesn't touch existing cache entries, complete or not", async () => {
    using box = sandbox({
      cache: {
        ...populatedCache,
        // No package.json: the installer would download this one again.
        "partial@1.0.0@@@1": { "index.js": "half" },
        "not-a-directory@1.0.0@@@1": "a file",
      },
    });
    writeFileSync(
      box.at("some.pack"),
      packOf(
        pkg(`@G@${sha}`, [file(".bun-tag", "other"), file("pwned")]),
        pkg("@GH@owner-repo-0123456@@@1", [file("package.json", "other"), file("pwned")]),
        pkg("@T@85f77fa09e18a07f@@@1", [file("package.json", "other"), file("pwned")]),
        pkg("@scope/new@1.0.0@@@1"),
        pkg("@scope/present@1.0.0@@@1", [file("package.json", "other"), file("pwned")]),
        pkg("new@1.0.0@@@1"),
        pkg("not-a-directory@1.0.0@@@1"),
        pkg("partial@1.0.0@@@1"),
        pkg("present@1.0.0@@@1", [file("package.json", "other"), file("index.js", "replaced"), file("pwned")]),
      ),
    );
    // `@scope/` itself gains two children.
    const untouched = (lines: string[]) => lines.filter(line => !/^(@scope\/|@scope\/new|new)( |@|\/)/.test(line));
    const before = untouched(snapshot(box.cache, true));

    const { out, err, code } = await bun(box, ["pm", "cache", "unpack", box.at("some.pack")]);

    expect(err).toContain("warn: ignoring 2 incomplete cache entries");
    expect(err).not.toContain("error:");
    expect(out).toContain("Unpacked 9 packages (2 new, 5 already cached, ");
    expect(untouched(snapshot(box.cache, true))).toEqual(before);
    expect(snapshot(join(box.cache, "@scope", "present@1.0.0@@@1"), false)).toEqual(
      snapshot(join(box.cache, "@scope", "new@1.0.0@@@1"), false),
    );
    expect(readFileSync(join(box.cache, "present@1.0.0@@@1", "index.js"), "utf8")).toBe("original");
    expect(existsSync(join(box.cache, "new@1.0.0@@@1", "package.json"))).toBeTrue();
    expect(readdirSync(box.tmp)).toEqual([]);
    expect(code).toBe(0);
  });

  test.concurrent("doesn't read the packages that are already in the cache", async () => {
    using box = sandbox({ cache: populatedCache });
    // Garbage where the records of a cached package would be; a sound package after it.
    const garbage = Buffer.alloc(3 << 20, 0xff);
    writeFileSync(box.at("skip.pack"), packOf(record(PACKAGE, "present@1.0.0@@@1", 0, garbage), pkg("z@1.0.0@@@1")));
    const { out, err, code } = await bun(box, ["pm", "cache", "unpack", box.at("skip.pack")]);
    expect(err).toBe("");
    expect(out).toContain("Unpacked 2 packages (1 new, 1 already cached, ");
    expect(code).toBe(0);
  });

  test.concurrent("several at the same time: every entry is created once, by one of them", async () => {
    using box = sandbox();
    const names = Array.from(
      { length: 40 },
      (_, i) => `${i % 2 ? "@scope/" : ""}p${String(i).padStart(2, "0")}@1.0.0@@@1`,
    );
    names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    writeFileSync(
      box.at("many.pack"),
      packOf(
        ...names.map(name =>
          pkg(name, [file("package.json", JSON.stringify({ name })), dir("lib"), file("lib/a.js", name)]),
        ),
      ),
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () => bun(box, ["pm", "cache", "unpack", box.at("many.pack")])),
    );
    let created = 0;
    for (const { out, err, code } of results) {
      expect(err).toBe("");
      const counts = /Unpacked 40 packages \((\d+) new, (\d+) already cached, /.exec(out)!;
      expect(Number(counts[1]) + Number(counts[2])).toBe(40);
      created += Number(counts[1]);
      expect(code).toBe(0);
    }
    expect(created).toBe(40);
    expect(entryNames(box.cache)).toEqual([...names].sort());
    for (const name of names) {
      expect(snapshot(join(box.cache, name), false)).toHaveLength(3);
      expect(readFileSync(join(box.cache, name, "lib", "a.js"), "utf8")).toBe(name);
    }
    expect(readdirSync(box.tmp)).toEqual([]);
  });
});

// ───────────────────────────── pack, and the way back ─────────────────────────────

/** A project with one dependency of each kind that needs no network but the registry's, installed into `box.cache`. */
async function installedProject(box: Sandbox, extra: Record<string, unknown> = {}) {
  copyFileSync(join(registry.packagesPath, "no-deps", "no-deps-2.0.0.tgz"), join(box.project, "vendored.tgz"));
  writeFileSync(
    join(box.project, "package.json"),
    JSON.stringify({
      name: "app",
      dependencies: {
        "no-deps": "1.0.0",
        "@types/is-number": "1.0.0",
        "what-bin": "1.0.0",
        "build-metadata-1": "1.1.0-rc.1+build.20240101",
        "bundled-1": "1.0.0",
        "from-url": `${registry.registryUrl()}no-deps/-/no-deps-1.0.1.tgz`,
        "from-file": "file:./vendored.tgz",
      },
      ...extra,
    }),
  );
  writeFileSync(
    join(box.project, "bunfig.toml"),
    toml({ install: { registry: registry.registryUrl(), linker: "hoisted" } }),
  );
  const { err, code } = await bun(box, ["install"]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);
}
const installedCount = 7;

describe("bun pm cache pack", () => {
  describe.each(["hoisted", "isolated"] as const)("then unpack, then an offline install (%s linker)", linker => {
    test.concurrent("needs nothing but the pack", async () => {
      using box = sandbox();
      await installedProject(box);
      const online = snapshot(join(box.project, "node_modules", "no-deps"), false);
      if (!isWindows) {
        const entry = join(
          box.cache,
          entryNames(box.cache).find(name => name.startsWith("no-deps@"))!,
        );
        writeFileSync(join(entry, "a:b.js"), "colon");
        mkdirSync(join(entry, "empty", "nested"), { recursive: true });
        symlinkSync("../index.js", join(entry, "empty", "link"));
      }

      let r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
      expect(r.err).toBe("");
      expect(r.out).toContain(`Packed ${installedCount} packages (`);
      expect(r.out).toContain(" into cache.pack ");
      expect(r.code).toBe(0);
      expect(
        readdirSync(box.project)
          .filter(name => name.includes("pack"))
          .sort(),
      ).toEqual(["cache.pack", "package.json"]);

      const restored = box.at("restored");
      r = await bun(box, ["pm", "cache", "unpack", "cache.pack"], { cache: restored });
      expect(r.err).toBe("");
      expect(r.out).toContain(`Unpacked ${installedCount} packages (${installedCount} new, 0 already cached, `);
      expect(r.code).toBe(0);
      expect(entries(restored)).toEqual(entries(box.cache));
      expect(readdirSync(box.tmp)).toEqual([]);
      // Tarballs by the integrity in bun.lock, and a registry that is one of several its host can have.
      expect(entryNames(restored)).toEqual([
        expect.stringMatching(/^@T@sha512-[0-9a-f]{32}@@@1$/),
        expect.stringMatching(/^@T@sha512-[0-9a-f]{32}@@@1$/),
        ...Array.from({ length: installedCount - 2 }, () => expect.stringMatching(/@@localhost__[0-9a-f]{16}@@@1$/)),
      ]);

      // The index the extractor leaves next to each npm entry.
      for (const name of entryNames(restored).filter(name => !name.startsWith("@T@"))) {
        const at = name.indexOf("@", 1);
        const indexLink = join(restored, name.slice(0, at), name.slice(at + 1));
        expect(readdirSync(join(restored, name.slice(0, at)))).toEqual(readdirSync(join(box.cache, name.slice(0, at))));
        expect(realpathSync(indexLink)).toBe(realpathSync(join(restored, name)));
      }

      const before = snapshot(restored, true);
      r = await bun(box, ["pm", "cache", "unpack", "cache.pack"], { cache: restored });
      expect(r.err).toBe("");
      expect(r.out).toContain(`Unpacked ${installedCount} packages (0 new, ${installedCount} already cached, `);
      expect(r.code).toBe(0);
      expect(snapshot(restored, true)).toEqual(before);

      rmSync(join(box.project, "node_modules"), { recursive: true, force: true });
      writeFileSync(join(box.project, "bunfig.toml"), toml({ install: { registry: registry.registryUrl(), linker } }));
      r = await bun(box, ["install", "--offline", "--frozen-lockfile"], { cache: restored });
      expect(r.err).not.toContain("error:");
      expect(r.out).toContain(`${installedCount} packages installed`);
      expect(r.code).toBe(0);
      const installed = snapshot(realpathSync(join(box.project, "node_modules", "no-deps")), false);
      expect(installed.filter(line => online.includes(line))).toEqual(online);
      for (const name of ["@types/is-number", "what-bin", "build-metadata-1", "bundled-1", "from-url", "from-file"]) {
        expect(existsSync(join(box.project, "node_modules", name, "package.json"))).toBeTrue();
      }
    });

    test.concurrent("also with a patched dependency", async () => {
      using box = sandbox({
        project: {
          patches: {
            "no-deps@1.0.0.patch": [
              "diff --git a/patched.js b/patched.js",
              "new file mode 100644",
              "index 0000000..1234567",
              "--- /dev/null",
              "+++ b/patched.js",
              "@@ -0,0 +1 @@",
              "+patched",
              "",
            ].join("\n"),
          },
        },
      });
      await installedProject(box, { patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" } });

      let r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      const restored = box.at("restored");
      r = await bun(box, ["pm", "cache", "unpack", "cache.pack"], { cache: restored });
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(entryNames(restored).filter(name => name.includes("_patch_hash="))).toEqual([]);

      rmSync(join(box.project, "node_modules"), { recursive: true, force: true });
      writeFileSync(join(box.project, "bunfig.toml"), toml({ install: { registry: registry.registryUrl(), linker } }));
      r = await bun(box, ["install", "--offline", "--frozen-lockfile"], { cache: restored });
      expect(r.err).not.toContain("error:");
      expect(readFileSync(join(box.project, "node_modules", "no-deps", "patched.js"), "utf8")).toBe("patched\n");
      expect(r.code).toBe(0);
    });
  });

  test.concurrent("auto-install finds an unpacked package without downloading it", async () => {
    // Its own registry: the requests of the other tests must not be counted.
    const own = new TestRegistry({ recordRequests: true });
    await own.start();
    try {
      using box = sandbox({
        project: { "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0" } }) },
      });
      writeFileSync(join(box.project, "bunfig.toml"), toml({ install: { registry: own.registryUrl() } }));
      let r = await bun(box, ["install"]);
      expect(r.code).toBe(0);
      r = await bun(box, ["pm", "cache", "pack", box.at("cache.pack")]);
      expect(r.code).toBe(0);
      const restored = box.at("restored");
      r = await bun(box, ["pm", "cache", "unpack", box.at("cache.pack")], { cache: restored });
      expect(r.code).toBe(0);

      const script = box.at("script");
      mkdirSync(script);
      writeFileSync(join(script, "bunfig.toml"), toml({ install: { registry: own.registryUrl() } }));
      writeFileSync(
        join(script, "index.ts"),
        `import { version } from "no-deps@1.0.0";\nconsole.log("loaded", version);`,
      );
      own.requests.length = 0;
      r = await bun(box, ["--install=force", "index.ts"], { cache: restored, cwd: script });
      expect(r.err).toBe("");
      expect(r.out).toBe("loaded 1.0.0\n");
      expect(own.requests.map(request => request.path).filter(path => path.endsWith(".tgz"))).toEqual([]);
      expect(r.code).toBe(0);
    } finally {
      await own.stop();
    }
  });

  test.concurrent("skips and reports entries that the cache doesn't have or only has in part", async () => {
    using box = sandbox();
    await installedProject(box);
    const [gone, partial] = entryNames(box.cache).filter(name => /^(no-deps|what-bin)@/.test(name));
    rmSync(join(box.cache, gone), { recursive: true });
    rmSync(join(box.cache, partial, "package.json"));

    let r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
    expect(r.err).toContain("warn: skipping 2 packages not in cache");
    expect(r.out).toContain(`Packed ${installedCount - 2} packages (`);
    expect(r.code).toBe(0);

    const restored = box.at("restored");
    r = await bun(box, ["pm", "cache", "unpack", "cache.pack"], { cache: restored });
    expect(r.err).toBe("");
    expect(entryNames(restored)).toEqual(entryNames(box.cache).filter(name => name !== partial));
    expect(r.code).toBe(0);
  });

  test.concurrent(
    "doesn't report packages that no install here downloads: bundled, or for another platform",
    async () => {
      using box = sandbox({
        project: {
          "package.json": JSON.stringify({
            name: "app",
            // Bundles no-deps@1.0.0.
            dependencies: { "bundled-1": "1.0.0" },
            // "os": ["foo"]
            optionalDependencies: { "native-foo-x64": "1.0.0" },
          }),
        },
      });
      writeFileSync(join(box.project, "bunfig.toml"), toml({ install: { registry: registry.registryUrl() } }));
      let r = await bun(box, ["install"]);
      expect(r.err).not.toContain("error:");
      expect(r.code).toBe(0);
      const lockfile = readFileSync(join(box.project, "bun.lock"), "utf8");
      expect(lockfile).toContain("no-deps@1.0.0");
      expect(lockfile).toContain("native-foo-x64@1.0.0");

      r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
      expect(r.err).toBe("");
      expect(r.out).toContain("Packed 1 package (");
      expect(r.code).toBe(0);
    },
  );

  test.concurrent.skipIf(isWindows)(
    "refuses an entry that unpack would refuse, and leaves no file behind",
    async () => {
      using box = sandbox();
      await installedProject(box);
      const entry = join(
        box.cache,
        entryNames(box.cache).find(name => name.startsWith("no-deps@"))!,
      );
      writeFileSync(join(box.project, "cache.pack"), "the previous pack");

      for (const [path, target] of [
        ["out", "../../victim"],
        ["absolute", box.victim],
        ["back", "lib/../../../victim"],
      ]) {
        symlinkSync(target, join(entry, path));
        const r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
        expect(r.err).toContain("error: bun pm cache pack failed: cache entry has symlink that may point outside it: ");
        expect(r.err).toContain(`/${path}"`);
        expect(r.out).toBe("");
        expect(r.code).toBe(1);
        rmSync(join(entry, path));
      }

      writeFileSync(join(entry, "back\\slash"), "");
      const r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
      expect(r.err).toContain("cache entry path cannot be packed");
      expect(r.code).toBe(1);

      expect(readFileSync(join(box.project, "cache.pack"), "utf8")).toBe("the previous pack");
      expect(
        readdirSync(box.project)
          .filter(name => name.includes("pack"))
          .sort(),
      ).toEqual(["cache.pack", "package.json"]);
    },
  );

  test.concurrent(
    "replaces the previous pack, makes the directory, and takes <file> relative to where it was typed",
    async () => {
      using box = sandbox({ project: { packages: { a: { "package.json": JSON.stringify({ name: "a" }) } } } });
      await installedProject(box, { workspaces: ["packages/*"] });
      const workspace = join(box.project, "packages", "a");
      writeFileSync(join(workspace, "cache.pack"), "the previous pack");

      let r = await bun(box, ["pm", "cache", "pack", "cache.pack"], { cwd: workspace });
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(readFileSync(join(workspace, "cache.pack")).subarray(0, MAGIC.length)).toEqual(MAGIC);
      expect(existsSync(join(box.project, "cache.pack"))).toBeFalse();

      r = await bun(box, ["pm", "cache", "pack", join(".ci", "deep", "cache.pack")], { cwd: workspace });
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(readFileSync(join(workspace, ".ci", "deep", "cache.pack"))).toEqual(
        readFileSync(join(workspace, "cache.pack")),
      );

      r = await bun(box, ["pm", "cache", "unpack", "cache.pack"], { cwd: workspace, cache: box.at("restored") });
      expect(r.err).toBe("");
      expect(r.out).toContain(`(${installedCount} new, `);
      expect(r.code).toBe(0);
    },
  );

  test.concurrent.each(dryRuns)("$title reads the cache and writes nothing", async ({ flags, config }) => {
    using box = sandbox();
    await installedProject(box);
    writeFileSync(
      join(box.project, "bunfig.toml"),
      toml({ install: { registry: registry.registryUrl(), linker: "hoisted", ...config } }),
    );
    writeFileSync(join(box.project, "old.pack"), "stays");
    const before = [snapshot(box.project, true), snapshot(box.cache, true)];

    for (const destination of ["old.pack", join("new", "cache.pack")]) {
      const r = await bun(box, ["pm", "cache", "pack", destination, ...flags]);
      expect(r.err).toBe("");
      expect(r.out).toContain(`Would pack ${installedCount} packages (`);
      expect(r.out).toContain(` into ${destination} `);
      expect(r.code).toBe(0);
    }

    expect([snapshot(box.project, true), snapshot(box.cache, true)]).toEqual(before);
    expect(readdirSync(box.tmp)).toEqual([]);
  });

  test.concurrent("checks its arguments", async () => {
    using box = sandbox();
    await installedProject(box);
    for (const verb of ["pack", "unpack"]) {
      for (const args of [[], ["a.pack", "b.pack"], [""]]) {
        const r = await bun(box, ["pm", "cache", verb, ...args]);
        expect(r.err).toContain("error: expected exactly one <file>");
        expect(r.err).toContain(`usage: bun pm cache ${verb} <file>`);
        expect(r.out).toBe("");
        expect(r.code).toBe(1);
      }
    }
    expect(readdirSync(box.project).filter(name => name.endsWith(".pack"))).toEqual([]);
  });

  test.concurrent("needs a lockfile", async () => {
    using box = sandbox({ project: { "package.json": JSON.stringify({ dependencies: { "no-deps": "1.0.0" } }) } });
    const r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
    expect(r.err).toContain("error: missing lockfile, nothing to pack");
    expect(existsSync(join(box.project, "cache.pack"))).toBeFalse();
    expect(r.code).toBe(1);
  });

  // `bun install` saves no lockfile for a project without dependencies, so the pack has no package in it.
  test.concurrent("packs nothing for a project without dependencies, which has no lockfile", async () => {
    using box = sandbox();
    const r = await bun(box, ["pm", "cache", "pack", "cache.pack"]);
    expect(r.err).toBe("");
    expect(r.out).toContain("Packed 0 packages (0 files, 0 KB) into cache.pack ");
    expect(r.code).toBe(0);

    const unpacked = await bun(box, ["pm", "cache", "unpack", "cache.pack"]);
    expect(unpacked.err).toBe("");
    expect(unpacked.code).toBe(0);
    expect(entryNames(box.cache)).toEqual([]);
  });

  test.concurrent("needs a lockfile outside a project too", async () => {
    using box = sandbox();
    const r = await bun(box, ["pm", "cache", "pack", "cache.pack"], { cwd: box.victim });
    expect(r.err).toContain("error: missing lockfile, nothing to pack\nnote: run 'bun install' first\n");
    expect(readdirSync(box.victim)).toEqual(["keep.txt"]);
    expect(r.code).toBe(1);
  });
});
