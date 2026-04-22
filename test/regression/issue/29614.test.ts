// https://github.com/oven-sh/bun/issues/29614
//
// PR #29489 turned on the global virtual store by default for the
// isolated linker, moving materialized package files from inside the
// project (`<project>/node_modules/.bun/<pkg>/`) to a shared location
// (`~/.bun/install/cache/links/<pkg>-<hash>/`). Bundlers and tools that
// canonicalize symlinks before walking ancestors for `node_modules/`
// (rspack, webpack with the default resolver, many postinstall
// scripts) then failed to resolve optional peer / phantom / hoisted
// dependencies because the realpath no longer passed through the
// project's top-level `node_modules/`.
//
// The fix flips `install.globalStore` to `false` by default. The
// isolated linker now materializes inside the project by default
// (pnpm-compatible layout: canonical paths stay in-project); the
// shared store remains available as an explicit opt-in via
// `install.globalStore = true` in bunfig.toml or
// `BUN_INSTALL_GLOBAL_STORE=1`.
//
// The regression is triggered by any package eligible for the global
// store — `.npm`, `.git`, `.github`, `.local_tarball`, `.remote_tarball`.
// `.file` / `workspace:` / `link:` deps are always project-local
// regardless of the flag, so the test uses a local tarball, which
// exercises the eligibility path end-to-end without needing a network
// registry.
import { expect, test } from "bun:test";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { bunEnv, bunExe, tempDir } from "harness";

async function spawnInstall(cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=isolated"],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// `npm pack` would add a network/toolchain dep; build the tarball
// inline so the test is hermetic.
async function packFoo(): Promise<Uint8Array> {
  const pkgJson = Buffer.from(`{"name":"foo","version":"1.0.0","main":"index.js"}`);
  const indexJs = Buffer.from(`module.exports = 42;\n`);

  // Build a tar archive with two entries under `package/`. Each header is
  // 512 bytes; the payload of each file is padded to 512-byte blocks; the
  // archive ends with two zero blocks. Fields are space-padded ASCII.
  function tarEntry(name: string, body: Uint8Array): Uint8Array {
    const header = new Uint8Array(512);
    const write = (off: number, len: number, value: string) => {
      const bytes = Buffer.from(value, "utf8");
      header.set(bytes.subarray(0, Math.min(bytes.length, len)), off);
    };
    write(0, 100, name);
    write(100, 8, "0000644\0");
    write(108, 8, "0000000\0");
    write(116, 8, "0000000\0");
    write(124, 12, body.length.toString(8).padStart(11, "0") + "\0");
    // mtime: epoch
    write(136, 12, "00000000000\0");
    write(156, 1, "0"); // typeflag: regular file
    write(257, 6, "ustar ");
    write(263, 2, " \0");
    // Checksum: sum of header bytes with checksum field treated as spaces.
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    const checksum = sum.toString(8).padStart(6, "0") + "\0 ";
    header.set(Buffer.from(checksum, "ascii"), 148);

    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    const entry = new Uint8Array(header.length + padded.length);
    entry.set(header, 0);
    entry.set(padded, header.length);
    return entry;
  }

  const entries = [tarEntry("package/package.json", pkgJson), tarEntry("package/index.js", indexJs)];
  const footer = new Uint8Array(1024);
  const total = entries.reduce((n, e) => n + e.length, 0) + footer.length;
  const tar = new Uint8Array(total);
  let o = 0;
  for (const e of entries) {
    tar.set(e, o);
    o += e.length;
  }
  tar.set(footer, o);

  // npm tarballs are gzip-compressed. `Bun.gzipSync` keeps the test
  // self-contained.
  return Bun.gzipSync(tar);
}

test("canonical path of an isolated-linker dep stays inside the project by default (#29614)", async () => {
  const tarball = await packFoo();
  using dir = tempDir("issue-29614-default-layout", {
    "package.json": JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: { foo: "file:./foo-1.0.0.tgz" },
    }),
    "foo-1.0.0.tgz": tarball,
  });
  const cwd = String(dir);

  const { stderr, exitCode } = await spawnInstall(cwd, bunEnv);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // The entry under `node_modules/.bun/<storepath>/` is a real directory
  // (not a symlink into `<cache>/links/`). A symlink here would mean the
  // global virtual store regressed back on by default — the exact
  // pre-reporter behavior on 1.3.13.
  const entry = join(cwd, "node_modules", ".bun", "foo@.+foo-1.0.0.tgz");
  expect(lstatSync(entry).isSymbolicLink()).toBe(false);
  expect(lstatSync(entry).isDirectory()).toBe(true);

  // The canonical path of `node_modules/foo` — what bundlers resolve
  // against when walking ancestors for `node_modules/` — must stay
  // inside the project. Before the fix it escaped into
  // `~/.bun/install/cache/links/`, which broke rspack/webpack
  // resolution of optional peers and phantom deps.
  const canonical = realpathSync(join(cwd, "node_modules", "foo"));
  const projectRoot = realpathSync(cwd);
  expect(canonical.startsWith(projectRoot + sep) || canonical === projectRoot).toBe(true);
});

test("BUN_INSTALL_GLOBAL_STORE=1 still opts into the shared store (#29614)", async () => {
  const tarball = await packFoo();
  using dir = tempDir("issue-29614-env-optin", {
    "package.json": JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: { foo: "file:./foo-1.0.0.tgz" },
    }),
    "foo-1.0.0.tgz": tarball,
  });
  const cwd = String(dir);

  // Isolate this test's global store to the test dir so it doesn't
  // collide with the user's `~/.bun/install/cache` or other tests.
  const cache = join(cwd, ".bun-cache");
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache, BUN_INSTALL_GLOBAL_STORE: "1" };

  const { stderr, exitCode } = await spawnInstall(cwd, env);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const entry = join(cwd, "node_modules", ".bun", "foo@.+foo-1.0.0.tgz");
  expect(lstatSync(entry).isSymbolicLink()).toBe(true);
  // …and its target lives under `<cache>/links/`, not the project tree.
  expect(readlinkSync(entry)).toContain(`${sep}links${sep}`);
});
