import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, readdirSorted, tempDir } from "harness";
import { basename, dirname, join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let urls: string[];
beforeEach(async () => {
  await dummyBeforeEach({ linker: "hoisted" });
  urls = [];
  setHandler(dummyRegistry(urls, { "0.1.0": {}, "0.0.2": {}, "0.0.3": {}, latest: "0.0.3" }));
});
afterEach(dummyAfterEach);

async function run(args: string[], cwd: string, cacheDir: string) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

function bunfig() {
  return Bun.TOML.stringify({ install: { registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" } });
}

// length-prefixed record, mirroring the pack format
function rec(kind: number, path: string, mode: number, data: string | Buffer) {
  const p = Buffer.from(path);
  const d = Buffer.from(data);
  const h = Buffer.alloc(1 + 4 + p.length + 4 + 8);
  h[0] = kind;
  h.writeUInt32LE(p.length, 1);
  p.copy(h, 5);
  h.writeUInt32LE(mode, 5 + p.length);
  h.writeBigUInt64LE(BigInt(d.length), 9 + p.length);
  return Buffer.concat([h, d]);
}
const MAGIC = Buffer.from("BUNCACHEPACK\0v1\n");

it("bun pm cache pack / unpack round-trips exactly the cache entries a lockfile needs", async () => {
  using cache1Dir = tempDir("cache-pack-a", {});
  using cache2Dir = tempDir("cache-pack-b", {});
  const cache1 = String(cache1Dir);
  const cache2 = String(cache2Dir);
  await writeFile(join(package_dir, "bunfig.toml"), bunfig());
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "@barn/moo": "0.1.0", bar: "0.0.2", baz: "0.0.3" },
    }),
  );

  let r = await run(["install"], package_dir, cache1);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);

  const pack = join(package_dir, "cache.pack");
  r = await run(["pm", "cache", "pack", pack], package_dir, cache1);
  expect(r.err).not.toContain("error:");
  expect(r.out).toContain("Packed 3 packages");
  expect(r.code).toBe(0);
  expect(existsSync(pack)).toBeTrue();

  // restore into an empty cache dir …
  r = await run(["pm", "cache", "unpack", pack], package_dir, cache2);
  expect(r.err).not.toContain("error:");
  expect(r.out).toContain("3 new");
  expect(r.code).toBe(0);
  const names = await readdirSorted(cache2);
  expect(names.some(n => n.startsWith("bar@0.0.2"))).toBeTrue();
  expect(existsSync(join(cache2, "@barn"))).toBeTrue();

  // … and install from it: no tarball is downloaded again
  await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
  const before = urls.filter(u => u.endsWith(".tgz")).length;
  r = await run(["install", "--frozen-lockfile"], package_dir, cache2);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(urls.filter(u => u.endsWith(".tgz")).length).toBe(before);
  expect(await Bun.file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toMatchObject({
    name: "@barn/moo",
  });
  expect(existsSync(join(package_dir, "node_modules", "bar", "package.json"))).toBeTrue();

  // idempotent
  r = await run(["pm", "cache", "unpack", pack], package_dir, cache2);
  expect(r.out).toContain("0 new, 3 already cached");
  expect(r.code).toBe(0);

  // a file name containing `:` (legal on POSIX) round-trips
  if (!isWindows) {
    const barDir = join(cache1, (await readdirSorted(cache1)).find(n => n.startsWith("bar@0.0.2"))!);
    await writeFile(join(barDir, "a:b.js"), "colon");
    using cache3Dir = tempDir("cache-pack-c", {});
    r = await run(["pm", "cache", "pack", join(package_dir, "colon.pack")], package_dir, cache1);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    r = await run(["pm", "cache", "unpack", join(package_dir, "colon.pack")], package_dir, String(cache3Dir));
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const bar3 = (await readdirSorted(String(cache3Dir))).find(n => n.startsWith("bar@0.0.2"))!;
    expect(readFileSync(join(String(cache3Dir), bar3, "a:b.js"), "utf8")).toBe("colon");
    rmSync(join(barDir, "a:b.js"));
  }

  // a cache entry containing a link that passes *through* another link cannot be
  // restored, so pack refuses it up front instead of producing a pack unpack rejects
  if (!isWindows) {
    const barDir = join(cache1, (await readdirSorted(cache1)).find(n => n.startsWith("bar@0.0.2"))!);
    mkdirSync(join(barDir, "real"), { recursive: true });
    symlinkSync("real", join(barDir, "lnk"));
    symlinkSync("lnk/inner", join(barDir, "through"));
    r = await run(["pm", "cache", "pack", join(package_dir, "bad.pack")], package_dir, cache1);
    expect(r.err).toContain("passes through another symlink");
    expect(r.code).not.toBe(0);
    expect(existsSync(join(package_dir, "bad.pack"))).toBeFalse();
    rmSync(join(barDir, "through"));
    rmSync(join(barDir, "lnk"));
  }

  // argument validation
  r = await run(["pm", "cache", "pack"], package_dir, cache2);
  expect(r.err).toContain("expected exactly one <file>");
  expect(r.code).toBe(1);
  r = await run(["pm", "cache", "unpack", pack, "extra"], package_dir, cache2);
  expect(r.err).toContain("expected exactly one <file>");
  expect(r.code).toBe(1);
  r = await run(["pm", "cache", "pack", ""], package_dir, cache2);
  expect(r.err).toContain("must not be empty");
  expect(r.code).toBe(1);
});

it("bun pm cache unpack refuses hostile packs", async () => {
  using cacheDir = tempDir("cache-pack-c", {});
  using victimDir = tempDir("cache-pack-v", {});
  using dirDir = tempDir("cache-pack-d", { "package.json": "{}" });
  const cache = String(cacheDir);
  const victim = String(victimDir);
  const dir = String(dirDir);

  // a folder name that tries to escape the cache dir
  await writeFile(join(dir, "traversal.pack"), Buffer.concat([MAGIC, rec(1, "../xx", 0, ""), rec(0, "", 0, "")]));
  let r = await run(["pm", "cache", "unpack", join(dir, "traversal.pack")], dir, cache);
  expect(r.err).toContain("unsafe");
  expect(r.code).not.toBe(0);

  // absolute folder name / absolute entry path
  const abs = isWindows ? "C:\\evil" : "/tmp/evil";
  await writeFile(join(dir, "absdir.pack"), Buffer.concat([MAGIC, rec(1, abs, 0, ""), rec(0, "", 0, "")]));
  r = await run(["pm", "cache", "unpack", join(dir, "absdir.pack")], dir, cache);
  expect(r.err).toContain("unsafe");
  expect(r.code).not.toBe(0);
  await writeFile(
    join(dir, "absentry.pack"),
    Buffer.concat([MAGIC, rec(1, "abs@1.0.0", 0, ""), rec(2, join(victim, "x"), 0o644, "x"), rec(0, "", 0, "")]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "absentry.pack")], dir, cache);
  expect(r.err).toContain("unsafe");
  expect(r.code).not.toBe(0);
  expect(existsSync(join(victim, "x"))).toBeFalse();
  expect((await readdirSorted(cache)).filter(n => !n.startsWith("."))).toEqual([]);

  // a symlink out of the package followed by a file written through it (victim and the
  // cache dir are siblings under the same temp root; the escape path relies on that)
  expect(dirname(victim)).toBe(dirname(cache));
  const cacheViaVictim = join(victim, "..", basename(cache));
  const rel = "./../../" + basename(victim);
  await writeFile(
    join(dir, "escape.pack"),
    Buffer.concat([
      MAGIC,
      rec(1, "evil@1.0.0", 0, ""),
      rec(3, "esc", 0o777, rel),
      rec(2, "esc/pwned", 0o644, "owned"),
      rec(0, "", 0, ""),
    ]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "escape.pack")], dir, cacheViaVictim);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/unsafe|traverses/);
  expect(existsSync(join(victim, "pwned"))).toBeFalse();
  // no staging directory is left behind after a failed unpack
  expect((await readdirSorted(cache)).filter(n => n.startsWith(".unpack-"))).toEqual([]);

  // a file written *through* a symlink created earlier in the same package: the link
  // itself is legal (points inside the package), the write through it is not
  await writeFile(
    join(dir, "through.pack"),
    Buffer.concat([
      MAGIC,
      rec(1, "through@1.0.0", 0, ""),
      rec(4, "real", 0o755, ""),
      rec(3, "esc", 0o777, "real"),
      rec(2, "esc/pwned", 0o644, "owned"),
      rec(0, "", 0, ""),
    ]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "through.pack")], dir, cache);
  expect(r.err).toContain("traverses");
  expect(r.code).not.toBe(0);
  // intra-package relative links are fine (bin/cli -> ../lib/cli.js), climbing out is not.
  // (symlink records are validated everywhere but only materialised on POSIX, matching
  // tarball extraction, so the scenarios that read through created links are POSIX-only)
  if (!isWindows) {
    await writeFile(
      join(dir, "links.pack"),
      Buffer.concat([
        MAGIC,
        rec(1, "links@1.0.0", 0, ""),
        rec(2, "lib/cli.js", 0o644, "x"),
        rec(3, "bin/cli", 0o777, "../lib/cli.js"),
        rec(0, "", 0, ""),
      ]),
    );
    r = await run(["pm", "cache", "unpack", join(dir, "links.pack")], dir, cache);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const linkEntry = (await readdirSorted(cache)).find(n => n.startsWith("links@1.0.0"))!;
    expect(lstatSync(join(cache, linkEntry, "bin", "cli")).isSymbolicLink()).toBeTrue();
    expect(readFileSync(join(cache, linkEntry, "bin", "cli"), "utf8")).toBe("x");
  }
  await writeFile(
    join(dir, "climb.pack"),
    Buffer.concat([MAGIC, rec(1, "climb@1.0.0", 0, ""), rec(3, "bin/cli", 0o777, "../../victim"), rec(0, "", 0, "")]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "climb.pack")], dir, cache);
  expect(r.err).toContain("unsafe symlink target");
  expect(r.code).not.toBe(0);

  // a target that only escapes by passing *through* another (self-referential) link:
  // lexically inside, physically outside — must be refused
  await writeFile(
    join(dir, "chain.pack"),
    Buffer.concat([
      MAGIC,
      rec(1, "chain@1.0.0", 0, ""),
      rec(3, "same", 0o777, "."),
      rec(3, "x", 0o777, "same/same/../../" + basename(victim)),
      rec(0, "", 0, ""),
    ]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "chain.pack")], dir, cacheViaVictim);
  expect(r.err).toContain("passes through another symlink");
  expect(r.code).not.toBe(0);
  expect((await readdirSorted(cache)).filter(n => n.startsWith("chain"))).toEqual([]);

  // same attack with the records in the opposite order (the escaping link first)
  await writeFile(
    join(dir, "chain2.pack"),
    Buffer.concat([
      MAGIC,
      rec(1, "chain2@1.0.0", 0, ""),
      rec(4, "a", 0o755, ""),
      rec(3, "out", 0o777, "a/up/../.."),
      rec(3, "a/up", 0o777, ".."),
      rec(0, "", 0, ""),
    ]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "chain2.pack")], dir, cacheViaVictim);
  expect(r.err).toContain("passes through another symlink");
  expect(r.code).not.toBe(0);
  expect((await readdirSorted(cache)).filter(n => n.startsWith("chain2"))).toEqual([]);

  // …and with the second link spelled in a different case (same entry on
  // case-insensitive filesystems)
  await writeFile(
    join(dir, "chain3.pack"),
    Buffer.concat([
      MAGIC,
      rec(1, "chain3@1.0.0", 0, ""),
      rec(4, "a", 0o755, ""),
      rec(3, "a/up", 0o777, ".."),
      rec(3, "A/UP/A/UP/out", 0o777, "../../../.."),
      rec(0, "", 0, ""),
    ]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "chain3.pack")], dir, cacheViaVictim);
  expect(r.err).toContain("passes through another symlink");
  expect(r.code).not.toBe(0);

  if (!isWindows) {
    // a link that points *at* another link (not through it) is fine: bin/cli -> ../index.js -> ./lib/impl.js
    await writeFile(
      join(dir, "links2.pack"),
      Buffer.concat([
        MAGIC,
        rec(1, "links2@1.0.0", 0, ""),
        rec(2, "lib/impl.js", 0o644, "y"),
        rec(3, "index.js", 0o777, "./lib/impl.js"),
        rec(3, "bin/cli", 0o777, "../index.js"),
        rec(0, "", 0, ""),
      ]),
    );
    r = await run(["pm", "cache", "unpack", join(dir, "links2.pack")], dir, cache);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const links2 = (await readdirSorted(cache)).find(n => n.startsWith("links2@1.0.0"))!;
    expect(readFileSync(join(cache, links2, "bin", "cli"), "utf8")).toBe("y");
  }
  // a non-ASCII pair that only a case-insensitive/normalising filesystem equates: the
  // lexical check cannot see it, the physical walks must. Only meaningful where the
  // filesystem actually folds `ä`/`Ä` (default APFS; not ext4 or case-sensitive APFS).
  await writeFile(join(dir, "ä-probe"), "");
  const folds = !isWindows && existsSync(join(dir, "Ä-probe"));
  if (folds) {
    await writeFile(
      join(dir, "chain4.pack"),
      Buffer.concat([
        MAGIC,
        rec(1, "chain4@1.0.0", 0, ""),
        rec(4, "ä", 0o755, ""),
        rec(3, "ä/up", 0o777, ".."),
        rec(3, "Ä/UP/Ä/UP/out", 0o777, "../../../.."),
        rec(0, "", 0, ""),
      ]),
    );
    r = await run(["pm", "cache", "unpack", join(dir, "chain4.pack")], dir, cacheViaVictim);
    expect(r.err).toContain("passes through another symlink");
    expect(r.code).not.toBe(0);
    expect((await readdirSorted(cache)).filter(n => n.startsWith("chain4"))).toEqual([]);

    // and a single-component link whose *target* routes through the differently-cased
    // link: only the post-creation target walk can see this one
    await writeFile(
      join(dir, "chain5.pack"),
      Buffer.concat([
        MAGIC,
        rec(1, "chain5@1.0.0", 0, ""),
        rec(4, "ä", 0o755, ""),
        rec(3, "ä/up", 0o777, ".."),
        rec(3, "x", 0o777, "Ä/up/Ä/up/../victim"),
        rec(0, "", 0, ""),
      ]),
    );
    r = await run(["pm", "cache", "unpack", join(dir, "chain5.pack")], dir, cacheViaVictim);
    expect(r.err).toContain("passes through another symlink");
    expect(r.code).not.toBe(0);
    expect((await readdirSorted(cache)).filter(n => n.startsWith("chain5"))).toEqual([]);
  }

  // an absurd symlink target length
  await writeFile(
    join(dir, "long.pack"),
    Buffer.concat([MAGIC, rec(1, "x@1.0.0", 0, ""), rec(3, "l", 0o777, Buffer.alloc(10_000, "a")), rec(0, "", 0, "")]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "long.pack")], dir, cache);
  expect(r.err).toContain("symlink target too long");
  expect(r.code).not.toBe(0);

  // not a pack at all
  await writeFile(join(dir, "junk.pack"), "hello");
  r = await run(["pm", "cache", "unpack", join(dir, "junk.pack")], dir, cache);
  expect(r.err).toContain("not a bun cache pack");
  expect(r.code).not.toBe(0);
});
