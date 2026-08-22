/**
 * Local builds share one cache dir (~/.bun/build-cache) across every checkout
 * on the machine, so when several of them cold-start at once, each one fetches
 * the prebuilt WebKit and publishes it into the same path. fetchPrebuilt(),
 * tryPrefetchExtracted() and ensureMacosSdk() (scripts/build/) used to publish
 * with `rm -rf dest; rename(staging, dest)`, so every build that finished
 * after the first deleted the tree the first one had published while the
 * other builds were already compiling and linking against it, and then put an
 * identical tree with fresh mtimes in its place. These tests stand in for the
 * build that finishes second: by the time it publishes, another build has
 * published the same thing, and that tree must be left exactly as it is
 * (rationale: "Publishing into a shared cache" in scripts/build/download.ts).
 */
import { expect, mock, spyOn, test } from "bun:test";
import { bunRun, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fetchPrebuilt, publishTree } from "../../scripts/build/download.ts";
import { ensureMacosSdk, MACOS_SDK_VERSION, macosSdkCachePath } from "../../scripts/build/macos-sdk.ts";

const downloadTs = resolve(import.meta.dir, "../../scripts/build/download.ts");

const entry = "webkit-0123456789abcdef-debug-asan";
const identity = "0123456789abcdef0123456789abcdef01234567-debug-asan";

/** The tree another build publishes. Its lib content tells it apart from what the tarballs below extract to. */
const published = { ".identity": `${identity}\n`, lib: { "libJavaScriptCore.a": "published by another build" } };

const layouts = {
  // What release tarballs look like: one top-level dir that fetchPrebuilt hoists out of its staging dir.
  "single top-level dir": { "bun-webkit/lib/libJavaScriptCore.a": "ours", "bun-webkit/include/unicode/uchar.h": "" },
  // Several top-level entries: the staging dir itself is what gets published.
  "several top-level entries": { "lib/libJavaScriptCore.a": "ours", "include/unicode/uchar.h": "" },
};

/** Serves `files` as a .tar.gz, running `onRequest` (the other build, in the tests below) before answering. */
async function tarballServer(files: Record<string, string>, onRequest: () => void = () => {}) {
  const tarball = await new Bun.Archive(files, { compress: "gzip" }).bytes();
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      requests++;
      onRequest();
      return new Response(tarball);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/${entry}.tar.gz`,
    get requests() {
      return requests;
    },
    [Symbol.asyncDispose]: () => server.stop(true),
  };
}

// The functions under test narrate through console.log; the tests assert on
// those lines, which is why this file runs its tests serially.
async function withLogCaptured(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  try {
    await fn();
  } finally {
    log.mockRestore();
  }
  return lines;
}

test.each(Object.entries(layouts))(
  "fetchPrebuilt leaves the tree another build published while it was downloading alone (%s)",
  async (_, files) => {
    using cache = tempDir("build-cache", { "published.tmp": published });
    const dest = join(String(cache), entry);
    let publishedStampMtime = 0;
    await using server = await tarballServer(files, () => {
      renameSync(join(String(cache), "published.tmp"), dest);
      publishedStampMtime = statSync(join(dest, ".identity")).mtimeMs;
    });

    const lines = await withLogCaptured(() => fetchPrebuilt("WebKit", server.url, dest, identity, ["include/unicode"]));

    expect(readFileSync(join(dest, "lib", "libJavaScriptCore.a"), "utf8")).toBe("published by another build");
    expect(statSync(join(dest, ".identity")).mtimeMs).toBe(publishedStampMtime);
    // Its own extraction, tarball and staging dir are gone; the published tree is all that is left.
    expect(readdirSync(String(cache))).toEqual([entry]);
    expect(lines).toEqual([`fetching ${server.url}`, "up to date (concurrent fetch won)"]);
  },
);

test.each(Object.entries(layouts))("fetchPrebuilt publishes when nothing is there yet (%s)", async (_, files) => {
  using cache = tempDir("build-cache", {});
  const dest = join(String(cache), entry);
  await using server = await tarballServer(files);

  const lines = await withLogCaptured(() => fetchPrebuilt("WebKit", server.url, dest, identity, ["include/unicode"]));

  expect(lines).toEqual([`fetching ${server.url}`, `extracted to ${dest}`]);
  expect(readFileSync(join(dest, ".identity"), "utf8")).toBe(`${identity}\n`);
  expect(readFileSync(join(dest, "lib", "libJavaScriptCore.a"), "utf8")).toBe("ours");
  expect(existsSync(join(dest, "include", "unicode"))).toBe(false);
  expect(readdirSync(String(cache))).toEqual([entry]);
});

test("fetchPrebuilt does not download over a tree that is already at this identity", async () => {
  using cache = tempDir("build-cache", { [entry]: published });
  const dest = join(String(cache), entry);
  await using server = await tarballServer(layouts["single top-level dir"]);

  const lines = await withLogCaptured(() => fetchPrebuilt("WebKit", server.url, dest, identity));

  expect(lines).toEqual(["up to date"]);
  expect(server.requests).toBe(0);
  expect(readFileSync(join(dest, "lib", "libJavaScriptCore.a"), "utf8")).toBe("published by another build");
});

test("fetchPrebuilt replaces a tree at another identity", async () => {
  using cache = tempDir("build-cache", {
    [entry]: { ".identity": "fedcba9876543210fedcba9876543210fedcba98-debug-asan\n", lib: { "libWTF.a": "stale" } },
  });
  const dest = join(String(cache), entry);
  await using server = await tarballServer(layouts["single top-level dir"]);

  const lines = await withLogCaptured(() => fetchPrebuilt("WebKit", server.url, dest, identity));

  expect(lines).toEqual([
    "identity changed (was fedcba9876543210, now 0123456789abcdef), re-fetching",
    `fetching ${server.url}`,
    `extracted to ${dest}`,
  ]);
  expect(readFileSync(join(dest, ".identity"), "utf8")).toBe(`${identity}\n`);
  expect(readdirSync(join(dest, "lib"))).toEqual(["libJavaScriptCore.a"]);
  expect(readdirSync(String(cache))).toEqual([entry]);
});

test("fetchPrebuilt replaces a plain file at the destination path", async () => {
  using cache = tempDir("build-cache", { [entry]: "not a directory" });
  const dest = join(String(cache), entry);
  await using server = await tarballServer(layouts["single top-level dir"]);

  const lines = await withLogCaptured(() => fetchPrebuilt("WebKit", server.url, dest, identity));

  expect(lines).toEqual([`fetching ${server.url}`, `extracted to ${dest}`]);
  expect(readFileSync(join(dest, ".identity"), "utf8")).toBe(`${identity}\n`);
  expect(readdirSync(String(cache))).toEqual([entry]);
});

// tryPrefetchExtracted() reads the prefetch dir from the environment when
// download.ts is first imported, so it is driven from a child process. It
// never looks at dest before copying, so a tree published before it is called
// is the same situation as one published during its copy.
test("tryPrefetchExtracted leaves the tree another build published alone", async () => {
  using dir = tempDir("build-prefetch", {
    prefetch: {
      extracted: { [entry]: { ".identity": `${identity}\n`, lib: { "libJavaScriptCore.a": "prefetched" } } },
    },
    cache: { [entry]: published },
    "fixture.ts": ({ root }) => `
      import { tryPrefetchExtracted } from ${JSON.stringify(pathToFileURL(downloadTs).href)};
      const dest = ${JSON.stringify(join(root, "cache", entry))};
      console.log(await tryPrefetchExtracted(dest, ".identity", ${JSON.stringify(identity)}));
    `,
  });
  const prefetchDir = join(String(dir), "prefetch");
  const dest = join(String(dir), "cache", entry);
  const publishedStampMtime = statSync(join(dest, ".identity")).mtimeMs;

  const result = await bunRun(join(String(dir), "fixture.ts"), { BUN_BUILD_PREFETCH_DIR: prefetchDir });

  expect(result).toSpawn(`using prefetch cache: ${resolve(prefetchDir, "extracted", entry)}\ntrue`);
  expect(readFileSync(join(dest, "lib", "libJavaScriptCore.a"), "utf8")).toBe("published by another build");
  expect(statSync(join(dest, ".identity")).mtimeMs).toBe(publishedStampMtime);
  expect(readdirSync(join(String(dir), "cache"))).toEqual([entry]);
});

const sdk = `MacOSX${MACOS_SDK_VERSION}.sdk`;
const sdkTree = (marker: string) => ({ usr: { include: { sys: { "syscall.h": "" } } }, [marker]: "" });

/**
 * Stands in for `bun xmac.mjs splat ... --output <staging> ...`, which is how
 * ensureMacosSdk() runs cfg.bun: lays out an SDK under --output and, when
 * `concurrent` is given, publishes that tree into the cache first, the way
 * another configure finishing during this extraction does. A shell script,
 * hence no Windows; the code under test only runs on non-darwin hosts
 * building for macOS.
 */
function fakeXmac(root: string, concurrent?: string): string {
  const publish =
    concurrent === undefined
      ? ""
      : `mv "${join(root, "cache", concurrent)}" "${macosSdkCachePath(join(root, "cache"))}"`;
  return `#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "--output" ]; then out="$2"; fi
  shift
done
mkdir -p "$out/SDKs/${sdk}/usr/include/sys" && : > "$out/SDKs/${sdk}/usr/include/sys/syscall.h" && : > "$out/SDKs/${sdk}/ours"
${publish}
`;
}

async function runEnsureMacosSdk(dir: string): Promise<{ cacheDir: string; lines: string[] }> {
  chmodSync(join(dir, "xmac"), 0o755);
  const cacheDir = join(dir, "cache");
  const lines = await withLogCaptured(() =>
    ensureMacosSdk({
      osxSysroot: macosSdkCachePath(cacheDir),
      cacheDir,
      darwin: true,
      bun: join(dir, "xmac"),
      host: { os: "linux" },
    }),
  );
  return { cacheDir, lines };
}

test.skipIf(isWindows)(
  "ensureMacosSdk leaves the SDK another configure published while it was extracting alone",
  async () => {
    using dir = tempDir("macos-sdk", {
      cache: { "published.tmp": sdkTree("published-by-another-configure") },
      xmac: ({ root }) => fakeXmac(root, "published.tmp"),
    });

    const { cacheDir, lines } = await runEnsureMacosSdk(String(dir));

    expect(readdirSync(join(cacheDir, sdk)).sort()).toEqual(["published-by-another-configure", "usr"]);
    expect(readdirSync(cacheDir)).toEqual([sdk]);
    expect(lines.at(-1)).toBe(`[macos-sdk] ${join(cacheDir, sdk)} was extracted by a concurrent build`);
  },
);

test.skipIf(isWindows)("ensureMacosSdk publishes when nothing is there yet", async () => {
  using dir = tempDir("macos-sdk", { cache: {}, xmac: ({ root }) => fakeXmac(root) });

  const { cacheDir, lines } = await runEnsureMacosSdk(String(dir));

  expect(lines.at(-1)).toBe(`[macos-sdk] extracted to ${join(cacheDir, sdk)}`);
  expect(readdirSync(join(cacheDir, sdk)).sort()).toEqual(["ours", "usr"]);
  expect(readdirSync(cacheDir)).toEqual([sdk]);
});

// The interleaving the tests above cannot produce: what was at dest was some
// other tree, publishTree removed it, and another build published in between
// that and the rename. `from` is missing so that the rename fails the way it
// does when that happens.
test("publishTree asks again when the rename after replacing another tree fails", async () => {
  using cache = tempDir("build-cache", { [entry]: { ".identity": "stale\n" } });
  const isPublished = mock(() => true).mockReturnValueOnce(false);

  await expect(publishTree(join(String(cache), "missing"), join(String(cache), entry), isPublished)).resolves.toBe(
    false,
  );
  expect(isPublished).toHaveBeenCalledTimes(2);
});

test("publishTree throws a rename failure that no other build explains", async () => {
  using cache = tempDir("build-cache", { [entry]: { ".identity": "stale\n" } });
  const isPublished = mock(() => false);

  await expect(
    publishTree(join(String(cache), "missing"), join(String(cache), entry), isPublished),
  ).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(isPublished).toHaveBeenCalledTimes(2);
});
