import { Glob, type GlobScanOptions } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { chmodSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

type Case = { pattern: string; cwd: string; options?: GlobScanOptions };

// Prints one row per case: what scanSync() and scan() yield, sorted, or the error.
// Then what the Bun shell, which expands a glob with the same walker, makes of the first pattern.
const fixture = `
  import { $, Glob } from "bun";
  const cases = JSON.parse(process.env.GLOB_CASES);
  const rows = [];
  for (const { pattern, cwd, options } of cases) {
    const glob = new Glob(pattern);
    const row = { pattern, cwd, options };
    try {
      row.sync = [...glob.scanSync({ ...options, cwd })].sort();
    } catch (e) {
      row.sync = [e.code, e.syscall, e.path].join(" ");
    }
    try {
      row.async = (await Array.fromAsync(glob.scan({ ...options, cwd }))).sort();
    } catch (e) {
      row.async = [e.code, e.syscall, e.path].join(" ");
    }
    rows.push(row);
  }
  const echo = await $\`echo \${{ raw: cases[0].pattern }}\`.cwd(cases[0].cwd).nothrow().quiet();
  const shell = { exitCode: echo.exitCode, stderr: echo.stderr.toString(), words: echo.text().trim().split(" ").sort() };
  console.log(JSON.stringify({ rows, shell }));
`;

async function scanBoth(pattern: string, options: GlobScanOptions) {
  const sync = [...new Glob(pattern).scanSync(options)].sort();
  expect((await Array.fromAsync(new Glob(pattern).scan(options))).sort()).toEqual(sync);
  return sync;
}

// chmod on Windows cannot take the permission to list a directory away.
test.skipIf(isWindows)("a folder that the pattern names is entered, not listed", async () => {
  using dir = tempDir("glob-scan-literal", {
    site: {
      customers: {
        acme: { public: { "a.html": "a", "b.html": "b", "notes.txt": "n" } },
        zeta: { public: { "c.html": "c" }, drafts: { "d.html": "d" } },
      },
      open: { "readme.txt": "r" },
    },
    other: {
      listed: { in: { "x.html": "x" } },
      closed: { in: { "x.html": "x" } },
    },
  });
  const root = String(dir);
  const site = join(root, "site");
  const customers = join(site, "customers");
  const acme = join(customers, "acme");
  const other = join(root, "other");
  const listed = join(other, "listed");
  const closed = join(other, "closed");
  symlinkSync("customers", join(site, "link"));
  symlinkSync("closed", join(other, "to-closed"));

  const html = (...prefix: string[]) => ["a.html", "b.html"].map(name => [...prefix, name].join("/"));
  const cases: (Case & { expected: string[] | string })[] = [
    { pattern: "customers/acme/public/*.html", cwd: site, expected: html("customers/acme/public") },
    { pattern: "./customers/acme/public/*.html", cwd: site, expected: html("./customers/acme/public") },
    {
      pattern: "customers/acme/public/*.html",
      cwd: site,
      options: { absolute: true },
      expected: html(site, "customers/acme/public"),
    },
    {
      pattern: "customers/acme/public/*.html",
      cwd: site,
      options: { followSymlinks: true },
      expected: html("customers/acme/public"),
    },
    { pattern: "customers/acme/public/a.html", cwd: site, expected: ["customers/acme/public/a.html"] },
    { pattern: "customers/acme/public", cwd: site, options: { onlyFiles: false }, expected: ["customers/acme/public"] },
    { pattern: "*/acme/public/*.html", cwd: site, expected: html("customers/acme/public") },
    {
      pattern: "*/acme/public/*.html",
      cwd: site,
      options: { followSymlinks: true },
      expected: [...html("customers/acme/public"), ...html("link/acme/public")],
    },
    { pattern: "link/acme/public/*.html", cwd: site, expected: html("link/acme/public") },
    {
      pattern: "link/acme/public/*.html",
      cwd: site,
      options: { followSymlinks: true },
      expected: html("link/acme/public"),
    },
    // The cwd itself can be entered and cannot be listed.
    { pattern: "acme/public/*.html", cwd: customers, expected: html("acme/public") },
    { pattern: "acme/public/a.html", cwd: customers, expected: ["acme/public/a.html"] },
    { pattern: "../customers/acme/public/a.html", cwd: customers, expected: ["../customers/acme/public/a.html"] },
    // `zeta` can be listed.
    {
      pattern: "customers/zeta/*/*.html",
      cwd: site,
      expected: ["customers/zeta/drafts/d.html", "customers/zeta/public/c.html"],
    },
    {
      pattern: "customers/zeta/**/*.html",
      cwd: site,
      expected: ["customers/zeta/drafts/d.html", "customers/zeta/public/c.html"],
    },
    // A name that is not there, and a name that is a file.
    { pattern: "customers/missing/public/*.html", cwd: site, expected: [] },
    { pattern: "customers/acme/public/a.html/*.html", cwd: site, expected: [] },
    { pattern: "customers/acme/public/a.html/b.html", cwd: site, expected: [] },
    // A wildcard level has to list its folder.
    { pattern: "customers/*/public/*.html", cwd: site, expected: "EACCES open customers" },
    { pattern: "*/public/*.html", cwd: customers, expected: `EACCES open ${customers}` },
    // `listed` cannot be entered, so a lookup in it has no answer. Its listing has one.
    { pattern: "listed/missing/*.html", cwd: other, expected: [] },
    { pattern: "listed/in/*.html", cwd: other, expected: "EACCES open listed/in" },
    { pattern: "listed/in", cwd: other, options: { onlyFiles: false }, expected: "EACCES fstatat listed/in" },
    // `closed` cannot be listed and cannot be entered. A link to it is passed over, like a link to nothing.
    { pattern: "closed/in/x.html", cwd: other, expected: "EACCES open closed" },
    { pattern: "in/x.html", cwd: closed, expected: `EACCES open ${closed}` },
    { pattern: "to-closed/in/x.html", cwd: other, expected: [] },
    { pattern: "to-closed/in/*.html", cwd: other, expected: [] },
    {
      pattern: "to-closed/in/x.html",
      cwd: other,
      options: { throwErrorOnBrokenSymlink: true },
      expected: "EACCES open to-closed",
    },
    {
      pattern: "to-*",
      cwd: other,
      options: { followSymlinks: true, onlyFiles: false, throwErrorOnBrokenSymlink: true },
      expected: "EACCES open to-closed",
    },
  ];

  // Root ignores the mode bits, so a run as root scans as another user.
  using unprivileged = unprivilegedSpawnOptions(root);
  // Search permission without read permission: the folder can be entered, and it cannot be listed.
  chmodSync(acme, 0o111);
  chmodSync(customers, 0o111);
  chmodSync(listed, 0o444);
  chmodSync(closed, 0o000);
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, GLOB_CASES: JSON.stringify(cases.map(({ expected, ...rest }) => rest)) },
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      rows: cases.map(({ expected, ...rest }) => ({ ...rest, sync: expected, async: expected })),
      shell: { exitCode: 0, stderr: "", words: html("customers/acme/public") },
    });
    expect(exitCode).toBe(0);
  } finally {
    for (const folder of [customers, acme, listed, closed]) chmodSync(folder, 0o755);
  }
});

// Windows lists the folder for every name.
test.skipIf(isWindows)("a name that cannot be looked up matches what the listing has", async () => {
  using dir = tempDir("glob-scan-literal-long", { "a/b.html": "" });
  const cwd = String(dir);
  // 256 bytes is more than a name can have. 100,000 bytes is more than a path can have.
  for (const name of [Buffer.alloc(256, "x").toString(), Buffer.alloc(100_000, "x").toString()]) {
    for (const pattern of [`${name}/*.html`, `${name}/b.html`, `a/${name}/*.html`, `a/${name}/b.html`]) {
      expect(await scanBoth(pattern, { cwd })).toEqual([]);
    }
  }
  // A lookup stops at a NUL, and an empty name is the folder itself.
  expect(await scanBoth("a\0z/*.html", { cwd })).toEqual([]);
  expect(await scanBoth("a\0/b.html", { cwd })).toEqual([]);
  expect(await scanBoth("a//", { cwd, onlyFiles: false })).toEqual([]);
});

// A symlink on Windows needs a privilege.
test.skipIf(isWindows)("a link that the pattern names is followed", async () => {
  using dir = tempDir("glob-scan-literal-link", { "real/sub/a.html": "", "file.txt": "" });
  const cwd = String(dir);
  symlinkSync("real", join(cwd, "to-dir"));
  symlinkSync("file.txt", join(cwd, "to-file"));
  symlinkSync("nowhere", join(cwd, "dangling"));

  expect(await scanBoth("to-dir/sub/*.html", { cwd })).toEqual(["to-dir/sub/a.html"]);
  expect(await scanBoth("to-dir/sub/a.html", { cwd })).toEqual(["to-dir/sub/a.html"]);
  expect(await scanBoth("to-dir/sub", { cwd, onlyFiles: false })).toEqual(["to-dir/sub"]);
  expect(await scanBoth("*/sub/a.html", { cwd, followSymlinks: true })).toEqual([
    "real/sub/a.html",
    "to-dir/sub/a.html",
  ]);
  expect(await scanBoth("to-file/sub/*.html", { cwd })).toEqual([]);
  expect(await scanBoth("dangling/sub/*.html", { cwd })).toEqual([]);
  expect(() => [...new Glob("dangling/sub/*.html").scanSync({ cwd, throwErrorOnBrokenSymlink: true })]).toThrow(
    expect.objectContaining({ code: "ENOENT", syscall: "open", path: "dangling" }),
  );
});

// Windows lists the folder and compares each name byte for byte.
test.skipIf(isWindows)("a folder that the pattern names in another letter case", async () => {
  using dir = tempDir("glob-scan-literal-case", { "Site/pages/a.html": "" });
  const cwd = String(dir);
  // True on the default file system of macOS. The path then has the spelling of the pattern,
  // as it has for a pattern that is only a name.
  const caseInsensitive = existsSync(join(cwd, "SITE"));
  expect(await scanBoth("SITE/pages/*.html", { cwd })).toEqual(caseInsensitive ? ["SITE/pages/a.html"] : []);
  expect(await scanBoth("SITE/PAGES/a.html", { cwd })).toEqual(caseInsensitive ? ["SITE/PAGES/a.html"] : []);
});
