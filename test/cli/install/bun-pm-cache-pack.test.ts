import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { existsSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, readdirSorted, tempDir } from "harness";
import { basename, join } from "path";
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

  // argument validation
  r = await run(["pm", "cache", "pack"], package_dir, cache2);
  expect(r.err).toContain("expected exactly one <file>");
  expect(r.code).toBe(1);
  r = await run(["pm", "cache", "unpack", pack, "extra"], package_dir, cache2);
  expect(r.err).toContain("expected exactly one <file>");
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

  // a symlink out of the package followed by a file written through it
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
  r = await run(["pm", "cache", "unpack", join(dir, "escape.pack")], dir, join(victim, "..", basename(cache)));
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/unsafe|traverses/);
  expect(existsSync(join(victim, "pwned"))).toBeFalse();
  // no staging directory is left behind after a failed unpack
  expect((await readdirSorted(cache)).filter(n => n.startsWith(".unpack-"))).toEqual([]);

  // an absurd symlink target length
  await writeFile(
    join(dir, "long.pack"),
    Buffer.concat([MAGIC, rec(1, "x@1.0.0", 0, ""), rec(3, "l", 0o777, Buffer.alloc(10_000, "a")), rec(0, "", 0, "")]),
  );
  r = await run(["pm", "cache", "unpack", join(dir, "long.pack")], dir, cache);
  expect(r.code).not.toBe(0);

  // not a pack at all
  await writeFile(join(dir, "junk.pack"), "hello");
  r = await run(["pm", "cache", "unpack", join(dir, "junk.pack")], dir, cache);
  expect(r.code).not.toBe(0);
});
