/**
 * fetchPrebuilt() and ensureMacosSdk() (scripts/build/) download and extract
 * into scratch named after the cache entry they are producing and delete it
 * in a `finally` that a build killed mid-fetch (ctrl-c, OOM killer, ENOSPC, a
 * container being stopped) never reaches. Nothing used to look at those names
 * again, so a machine-shared cache dir (~/.bun/build-cache) kept every
 * half-extracted WebKit tree, 0.5 to 2.5 GB apiece, until the disk was full.
 *
 * Every fetch now starts by removing the scratch that earlier fetches
 * abandoned in its cache dir. Abandonment is judged by the entry's age: the
 * cache dir is routinely one host directory shared by containers with
 * separate pid namespaces, so the pid in the name says nothing about whether
 * the owner is alive, whereas a live fetch touches its scratch far more often
 * than once an hour.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir, type DirectoryTree } from "harness";
import { chmodSync, existsSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";

import {
  fetchPrebuilt,
  removeAbandonedScratch,
  scratchAbandonedAfterMs,
  scratchSuffix,
} from "../../scripts/build/download.ts";
import { ensureMacosSdk, MACOS_SDK_VERSION, macosSdkCachePath } from "../../scripts/build/macos-sdk.ts";

const webkit = "webkit-0123456789abcdef-debug-asan";
const sdk = `MacOSX${MACOS_SDK_VERSION}.sdk`;

/** What one fetch of `entry` by this process leaves behind if killed at each stage it can be killed at. */
function scratchOf(entry: string): string[] {
  const suffix = scratchSuffix();
  return [
    `${entry}${suffix}.tar.gz.${process.pid}.partial`, // while downloading
    `${entry}${suffix}.tar.gz`, // while extracting, which leaves
    `${entry}${suffix}.staging`, // both the tarball and the extraction dir
    `${entry}${suffix}.prefetch`, // while copying a prefetched tree (CI images)
  ];
}

/** A directory for every name that denotes one, a small file for the rest. */
function treeOf(names: string[]): DirectoryTree {
  const tree: DirectoryTree = {};
  for (const name of names) {
    tree[name] = /\.(?:staging|prefetch)$/.test(name) ? { "bun-webkit": { "x.h": "" } } : "bytes";
  }
  return tree;
}

/** Make each path (the entry itself; its contents don't matter) look untouched for longer than the threshold. */
function abandon(...paths: string[]): void {
  const then = new Date(Date.now() - scratchAbandonedAfterMs - 60_000);
  for (const path of paths) utimesSync(path, then, then);
}

test.concurrent("every kind of abandoned scratch is removed; live scratch and the cache entries are not", async () => {
  const abandoned = [
    ...scratchOf(webkit),
    // Entries no fetch will run for again: a WebKit version that has since
    // been bumped, and the SDK extraction that macos-sdk.ts does.
    "webkit-fedcba9876543210-debug-asan.4242.lz5k3x1q.staging",
    `${sdk}.4243.lz5k3x1q.staging`,
  ];
  // Written moments ago: another build's fetch that is still running.
  const live = scratchOf("webkit-0123456789abcdef");
  // Not scratch, however old: published entries (dots in their names and
  // all), the dep tarball cache, and a name that merely looks versioned.
  const entries = [webkit, "nodejs-headers-26.3.0", sdk];
  const others = ["node-v22.1.0.tar.gz", "tarballs"];
  const tree = treeOf([...abandoned, ...live]);
  for (const name of entries) tree[name] = { ".identity": "x\n" };
  tree["node-v22.1.0.tar.gz"] = "bytes";
  tree["tarballs"] = { "zstd-e010993a24072468.tar.gz": "bytes" };
  using cache = tempDir("build-cache", tree);
  const at = (name: string) => join(String(cache), name);

  // An interrupted tryPrefetchExtracted() copy carries the prefetch tree's
  // read-only modes, which a plain rm -rf cannot get through as a normal user.
  chmodSync(join(at(abandoned.find(name => name.endsWith(".prefetch"))!), "bun-webkit"), 0o555);
  abandon(...[...abandoned, ...entries, ...others].map(at));

  await removeAbandonedScratch(String(cache));

  expect(readdirSync(String(cache)).sort()).toEqual([...live, ...entries, ...others].sort());
  expect(existsSync(at("tarballs/zstd-e010993a24072468.tar.gz"))).toBe(true);
});

test.concurrent("a cache dir that does not exist yet has nothing to remove", async () => {
  using dir = tempDir("build-cache", {});
  await removeAbandonedScratch(join(String(dir), "build-cache"));
  expect(readdirSync(String(dir))).toEqual([]);
});

test.concurrent(
  "fetchPrebuilt removes what a killed fetch left, leaves a concurrent one alone, and leaves nothing itself",
  async () => {
    const killed = scratchOf(webkit);
    // Another checkout fetching the same WebKit right now, mid-extraction.
    const concurrent = [`${webkit}.4242.lz5k3x1q.tar.gz`, `${webkit}.4242.lz5k3x1q.staging`];
    using cache = tempDir("build-cache", treeOf([...killed, ...concurrent]));
    abandon(...killed.map(name => join(String(cache), name)));

    const tarball = await new Bun.Archive(
      { "bun-webkit/lib/libJavaScriptCore.a": "prebuilt", "bun-webkit/include/JavaScriptCore/JSBase.h": "" },
      { compress: "gzip" },
    ).bytes();
    await using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(tarball) });

    const dest = join(String(cache), webkit);
    await fetchPrebuilt(
      "WebKit",
      `http://127.0.0.1:${server.port}/bun-webkit.tar.gz`,
      dest,
      "0123456789abcdef-debug-asan",
    );

    expect(readFileSync(join(dest, ".identity"), "utf8")).toBe("0123456789abcdef-debug-asan\n");
    expect(readFileSync(join(dest, "lib", "libJavaScriptCore.a"), "utf8")).toBe("prebuilt");
    expect(readdirSync(String(cache)).sort()).toEqual([...concurrent, webkit].sort());
  },
);

test.concurrent("fetchPrebuilt removes abandoned scratch even when its own entry is up to date", async () => {
  const entry = "nodejs-headers-26.3.0";
  const killed = scratchOf(entry);
  const tree = treeOf(killed);
  tree[entry] = { ".identity": "26.3.0\n", include: { node: { "node.h": "" } } };
  using cache = tempDir("build-cache", tree);
  abandon(...killed.map(name => join(String(cache), name)));

  // Nothing listens on port 1: with the stamp matching, no download may be attempted.
  await fetchPrebuilt("nodejs-headers", "http://127.0.0.1:1/node-headers.tar.gz", join(String(cache), entry), "26.3.0");

  expect(readdirSync(String(cache))).toEqual([entry]);
  expect(existsSync(join(String(cache), entry, "include", "node", "node.h"))).toBe(true);
});

// Stands in for `bun xmac.mjs splat ... --output <staging> ...` (ensureMacosSdk
// execs cfg.bun with those arguments): lays out the one directory it looks
// for under --output. A shell script, hence no Windows.
const fakeXmac = `#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "--output" ]; then out="$2"; fi
  shift
done
sdk="$out/SDKs/${sdk}/usr/include/sys"
mkdir -p "$sdk" && : > "$sdk/syscall.h"
`;

test.concurrent.skipIf(isWindows)(
  "ensureMacosSdk removes what a killed configure left, leaves a concurrent one alone, and leaves nothing itself",
  async () => {
    const [, , killed] = scratchOf(sdk);
    const concurrent = `${sdk}.4242.lz5k3x1q.staging`;
    using dir = tempDir("macos-sdk", { xmac: fakeXmac, cache: treeOf([killed!, concurrent]) });
    chmodSync(join(String(dir), "xmac"), 0o755);
    const cacheDir = join(String(dir), "cache");
    abandon(join(cacheDir, killed!));

    await ensureMacosSdk({
      osxSysroot: macosSdkCachePath(cacheDir),
      cacheDir,
      darwin: true,
      bun: join(String(dir), "xmac"),
      host: { os: "linux" },
    });

    expect(existsSync(join(cacheDir, sdk, "usr", "include", "sys", "syscall.h"))).toBe(true);
    expect(readdirSync(cacheDir).sort()).toEqual([concurrent, sdk].sort());
  },
);
