/**
 * fetchDep() (scripts/build/fetch-cli.ts) brings vendor/<dep> to a new pinned
 * version by extracting the new tree beside the old one and syncing it in
 * place: a file whose bytes did not change keeps its inode and mtime, so ninja
 * keeps the objects compiled from it and a dependency bump recompiles only
 * what the bump actually touched. `planDep()` prepares that new tree ahead of
 * the sync and writes the ninja dyndep file declaring the tree's files as
 * outputs of the sync edge, which is how ninja learns, in the same run, which
 * headers the sync rewrote. These drive the real CLI logic against synthetic
 * release tarballs served from a local socket.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { basename, join, relative } from "node:path";

import { fetchDep, planDep } from "../../scripts/build/fetch-cli.ts";

/** A github-archive-shaped .tar.gz (one top-level directory) of `files`. */
function makeTarball(work: string, name: string, files: Record<string, string | { symlink: string }>): string {
  const root = join(work, `${name}-src`, `${name}-top`);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    if (typeof content === "string") writeFileSync(path, content);
    else symlinkSync(content.symlink, path);
  }
  const tarball = join(work, `${name}.tar.gz`);
  const tar = spawnSync("tar", ["-czf", tarball, "-C", join(work, `${name}-src`), `${name}-top`], { stdio: "inherit" });
  expect(tar.status).toBe(0);
  return tarball;
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Symlink entries for makeTarball — none on Windows, where creating one unprivileged may be refused. */
const symlinks = (links: Record<string, string>): Record<string, { symlink: string }> =>
  isWindows ? {} : Object.fromEntries(Object.entries(links).map(([k, v]) => [k, { symlink: v }]));

/** A path as fetch-cli spells it in the dyndep file (ninja syntax: forward slashes, `:` escaped). */
const dd = (path: string) => path.replaceAll("\\", "/").replaceAll(":", "$:");

/** Serves the given files by basename; one connection per request. */
async function serve(files: string[]) {
  const byName = new Map(files.map(f => [basename(f), readFileSync(f)]));
  const server = createServer(socket => {
    socket.once("data", data => {
      const path = /^GET \/([^ ]+) /.exec(data.toString())?.[1] ?? "";
      const body = byName.get(path);
      if (body === undefined) socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      else {
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
        socket.end(body);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (file: string) => `http://127.0.0.1:${port}/${basename(file)}`,
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

test("a version bump keeps unchanged files (and their mtimes), replaces changed ones, adds and removes the rest", async () => {
  using dir = tempDir("dep-fetch-sync", {});
  const work = String(dir);
  const v1 = makeTarball(work, "v1", {
    "include/same.h": "#define SAME 1\n",
    "include/changed.h": "#define V 1\n",
    "src/removed.c": "int removed;\n",
    "src/deep/nested/same.c": "int nested;\n",
    "becomes-dir": "a file in v1\n",
    ...symlinks({ "link": "include/same.h", "relinked": "include/same.h" }),
  });
  const v2 = makeTarball(work, "v2", {
    "include/same.h": "#define SAME 1\n",
    "include/changed.h": "#define V 2 /* longer */\n",
    "src/added.c": "int added;\n",
    "src/deep/nested/same.c": "int nested;\n",
    "becomes-dir/inner.txt": "now a directory\n",
    ...symlinks({ "link": "include/same.h", "relinked": "include/changed.h" }),
  });
  await using server = await serve([v1, v2]);
  const dest = join(work, "vendor", "dep");
  const cache = join(work, "cache");

  await fetchDep("dep", server.url(v1), `sha256:${sha256(v1)}`, dest, cache, []);
  expect(readFileSync(join(dest, "include/changed.h"), "utf8")).toBe("#define V 1\n");
  // Age the v1 tree so "kept its mtime" is observable.
  const old = new Date("2020-01-01T00:00:00Z");
  for (const rel of ["include/same.h", "include/changed.h", "src/deep/nested/same.c"])
    utimesSync(join(dest, rel), old, old);
  const inodeBefore = statSync(join(dest, "include/same.h")).ino;

  await fetchDep("dep", server.url(v2), `sha256:${sha256(v2)}`, dest, cache, []);

  // Unchanged: same bytes, same mtime, same inode — objects built from it stay valid.
  expect(statSync(join(dest, "include/same.h")).mtime.getTime()).toBe(old.getTime());
  expect(statSync(join(dest, "include/same.h")).ino).toBe(inodeBefore);
  expect(statSync(join(dest, "src/deep/nested/same.c")).mtime.getTime()).toBe(old.getTime());
  // Changed: new bytes, fresh mtime.
  expect(readFileSync(join(dest, "include/changed.h"), "utf8")).toBe("#define V 2 /* longer */\n");
  expect(statSync(join(dest, "include/changed.h")).mtime.getTime()).toBeGreaterThan(old.getTime());
  // Added / removed / kind changes / symlinks.
  expect(readFileSync(join(dest, "src/added.c"), "utf8")).toBe("int added;\n");
  expect(existsSync(join(dest, "src/removed.c"))).toBe(false);
  expect(readFileSync(join(dest, "becomes-dir/inner.txt"), "utf8")).toBe("now a directory\n");
  if (!isWindows) {
    expect(readFileSync(join(dest, "relinked"), "utf8")).toBe("#define V 2 /* longer */\n");
    expect(readFileSync(join(dest, "link"), "utf8")).toBe("#define SAME 1\n");
  }
  // The stamp names the new identity and nothing is left beside the tree.
  expect(readFileSync(join(dest, ".ref"), "utf8").trim()).toHaveLength(16);
  expect(existsSync(`${dest}.staging`)).toBe(false);
});

test("an identical re-fetch is a no-op that leaves the stamp untouched", async () => {
  using dir = tempDir("dep-fetch-noop", {});
  const work = String(dir);
  const v1 = makeTarball(work, "v1", { "a.h": "a\n" });
  await using server = await serve([v1]);
  const dest = join(work, "vendor", "dep");
  await fetchDep("dep", server.url(v1), `sha256:${sha256(v1)}`, dest, join(work, "cache"), []);
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(join(dest, ".ref"), old, old);
  await fetchDep("dep", server.url(v1), `sha256:${sha256(v1)}`, dest, join(work, "cache"), []);
  expect(statSync(join(dest, ".ref")).mtime.getTime()).toBe(old.getTime());
});

test("a tree without a stamp (interrupted sync) is repaired in place rather than trusted", async () => {
  using dir = tempDir("dep-fetch-repair", {});
  const work = String(dir);
  const v1 = makeTarball(work, "v1", { "a.h": "right\n", "b.h": "b\n" });
  await using server = await serve([v1]);
  const dest = join(work, "vendor", "dep");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "a.h"), "wrong\n");
  writeFileSync(join(dest, "stray.h"), "left over\n");
  await fetchDep("dep", server.url(v1), `sha256:${sha256(v1)}`, dest, join(work, "cache"), []);
  expect(readFileSync(join(dest, "a.h"), "utf8")).toBe("right\n");
  expect(readFileSync(join(dest, "b.h"), "utf8")).toBe("b\n");
  expect(existsSync(join(dest, "stray.h"))).toBe(false);
  expect(existsSync(join(dest, ".ref"))).toBe(true);
});

test("plan prepares the new tree, writes the dyndep file (both spellings, static outputs left out), and dep reuses it", async () => {
  using dir = tempDir("dep-fetch-plan", {});
  const work = String(dir);
  const v1 = makeTarball(work, "v1", {
    "include/a.h": "a1\n",
    "src/lib.c": "int lib;\n",
    ...symlinks({ "include/alias.h": "a.h", "bin/dangling": "not-built-yet" }),
  });
  const v2 = makeTarball(work, "v2", { "include/a.h": "a2\n", "include/b.h": "b\n", "src/lib.c": "int lib;\n" });
  await using server = await serve([v1, v2]);
  const dest = join(work, "vendor", "dep");
  const cache = join(work, "cache");
  const buildDir = join(work, "build", "debug");
  const ddFile = join(buildDir, "deps", "dep", "sources.dd");
  const staticOutputs = join(buildDir, "deps", "static-outputs.txt");
  mkdirSync(join(buildDir, "deps", "dep"), { recursive: true });
  writeFileSync(staticOutputs, join(dest, "src/lib.c") + "\n"); // compiled by some edge: declared in build.ninja
  const ref1 = `sha256:${sha256(v1)}`;
  const ref2 = `sha256:${sha256(v2)}`;

  // Fresh: plan extracts v1 beside the (absent) tree and lists it; dep moves it into place.
  await planDep("dep", server.url(v1), ref1, dest, cache, ddFile, staticOutputs, buildDir, []);
  expect(existsSync(join(`${dest}.staging`, "include/a.h"))).toBe(true);
  const both = (p: string) => `${dd(relative(buildDir, join(dest, p)))} ${dd(join(dest, p))}`;
  // A symlink to a file in the tree is declared (compilers record the link's own path in depfiles);
  // a dangling one is not (ninja would stat a missing output forever). No symlinks on Windows.
  const listed = isWindows ? both("include/a.h") : `${both("include/a.h")} ${both("include/alias.h")}`;
  expect(readFileSync(ddFile, "utf8")).toBe(
    `ninja_dyndep_version = 1\nbuild ${dd(join(dest, ".ref"))} | ${listed}: dyndep\n`,
  );
  await fetchDep("dep", server.url(v1), ref1, dest, cache, []);
  expect(readFileSync(join(dest, "include/a.h"), "utf8")).toBe("a1\n");
  expect(existsSync(`${dest}.staging`)).toBe(false);

  // Current: plan lists the live tree and prepares nothing; an unchanged list leaves the dyndep file's mtime alone.
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(ddFile, old, old);
  await planDep("dep", server.url(v1), ref1, dest, cache, ddFile, staticOutputs, buildDir, []);
  expect(existsSync(`${dest}.staging`)).toBe(false);
  expect(statSync(ddFile).mtime.getTime()).toBe(old.getTime());

  // Bump: plan prepares v2 and lists ITS files; dep syncs from that staging without extracting again.
  await planDep("dep", server.url(v2), ref2, dest, cache, ddFile, staticOutputs, buildDir, []);
  expect(readFileSync(ddFile, "utf8")).toContain(both("include/b.h"));
  expect(readFileSync(ddFile, "utf8")).not.toContain("lib.c");
  expect(readFileSync(join(dest, "include/a.h"), "utf8")).toBe("a1\n"); // plan never touches the live tree
  const stagedInode = statSync(join(`${dest}.staging`, "include/b.h")).ino;
  await fetchDep("dep", server.url(v2), ref2, dest, cache, []);
  expect(readFileSync(join(dest, "include/a.h"), "utf8")).toBe("a2\n");
  expect(statSync(join(dest, "include/b.h")).ino).toBe(stagedInode); // moved in from plan's staging
  expect(existsSync(`${dest}.staging`)).toBe(false);
});
