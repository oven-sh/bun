import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

// Drives downloadWithRetry/tryPrefetchExtracted via fetch-cli.ts (the same
// entry ninja uses), with BUN_BUILD_PREFETCH_DIR pointed at a synthetic cache
// and an unroutable URL — if the prefetch lookup is ever bypassed, fetch()
// errors and the test fails. 192.0.2.0/24 is TEST-NET-1 (RFC 5737); guaranteed
// not to route.

test("downloadWithRetry: by-url/ hit copies, never touches network", async () => {
  using dir = tempDir("prefetch-by-url", {});
  const prefetch = join(String(dir), "prefetch");
  const cache = join(String(dir), "cache");
  const dest = join(String(dir), "vendor", "fake");
  mkdirSync(join(prefetch, "by-url"), { recursive: true });
  mkdirSync(cache, { recursive: true });

  // The URL must match what fetchDep computes:
  // https://github.com/<repo>/archive/<commit>.tar.gz — but we want it
  // unroutable, so use a repo on a TEST-NET host. fetchDep builds the URL
  // from repo+commit verbatim, so any string works.
  const repo = "192.0.2.1/never";
  const commit = "deadbeef";
  const url = `https://github.com/${repo}/archive/${commit}.tar.gz`;
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);

  // A real gzipped tarball with one top-level dir (github-archive layout) so
  // fetchDep's extractTarGz --strip-components=1 succeeds.
  const tgz = await makeTarGz("repo-deadbeef/hello.txt", "hi\n");
  writeFileSync(join(prefetch, "by-url", key), tgz);

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(repoRoot, "scripts", "build", "fetch-cli.ts"), "dep", "fake", repo, commit, dest, cache],
    env: { ...bunEnv, BUN_BUILD_PREFETCH_DIR: prefetch },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("using prefetch cache");
  expect(await Bun.file(join(dest, "hello.txt")).text()).toBe("hi\n");
  expect(exitCode).toBe(0);
});

test("fetchPrebuilt: extracted/ hit with matching .identity copies tree", async () => {
  using dir = tempDir("prefetch-extracted", {});
  const prefetch = join(String(dir), "prefetch");
  const dest = join(String(dir), "out", "thing-v1");
  mkdirSync(join(prefetch, "extracted", "thing-v1"), { recursive: true });
  writeFileSync(join(prefetch, "extracted", "thing-v1", ".identity"), "v1\n");
  writeFileSync(join(prefetch, "extracted", "thing-v1", "lib.a"), "payload");

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(repoRoot, "scripts", "build", "fetch-cli.ts"),
      "prebuilt",
      "thing",
      "http://192.0.2.1/thing-v1.tar.gz",
      dest,
      "v1",
    ],
    env: { ...bunEnv, BUN_BUILD_PREFETCH_DIR: prefetch },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("using prefetch cache");
  expect(await Bun.file(join(dest, "lib.a")).text()).toBe("payload");
  expect(await Bun.file(join(dest, ".identity")).text()).toBe("v1\n");
  expect(exitCode).toBe(0);
});

test.skipIf(process.platform === "win32")(
  "fetchPrebuilt: read-only prefetch source produces a writable dest",
  async () => {
    using dir = tempDir("prefetch-ro", {});
    const prefetch = join(String(dir), "prefetch");
    const src = join(prefetch, "extracted", "thing-ro");
    const dest = join(String(dir), "out", "thing-ro");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, ".identity"), "v1\n");
    writeFileSync(join(src, "lib.a"), "x");
    // Mirror bootstrap.sh's `chmod -R a-w` — cp would otherwise propagate 555
    // dirs to dest and a future version-bump rm would EACCES.
    chmodSync(join(src, ".identity"), 0o444);
    chmodSync(join(src, "lib.a"), 0o444);
    chmodSync(src, 0o555);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(repoRoot, "scripts", "build", "fetch-cli.ts"),
        "prebuilt",
        "thing",
        "http://192.0.2.1/thing-ro.tar.gz",
        dest,
        "v1",
      ],
      env: { ...bunEnv, BUN_BUILD_PREFETCH_DIR: prefetch },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);

    // The published tree must be removable by the next fetch (version bump).
    expect(() => rmSync(dest, { recursive: true })).not.toThrow();

    // Let tempDir's own cleanup succeed.
    chmodSync(src, 0o755);
  },
);

test("fetchPrebuilt: stale extracted/ identity falls through to by-url/", async () => {
  using dir = tempDir("prefetch-miss", {});
  const prefetch = join(String(dir), "prefetch");
  const dest = join(String(dir), "out", "thing-v2");

  // extracted/ has a tree stamped v1 (stale); by-url/ has the v2 tarball.
  // tryPrefetchExtracted must reject the v1 tree, then downloadWithRetry must
  // hit by-url/ — proving the version-bump → selective-miss path works
  // end-to-end without ever touching the network.
  mkdirSync(join(prefetch, "extracted", "thing-v2"), { recursive: true });
  writeFileSync(join(prefetch, "extracted", "thing-v2", ".identity"), "v1\n");
  writeFileSync(join(prefetch, "extracted", "thing-v2", "stale.a"), "old");

  const url = "http://192.0.2.1/thing-v2.tar.gz";
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
  mkdirSync(join(prefetch, "by-url"), { recursive: true });
  writeFileSync(join(prefetch, "by-url", key), await makeTarGz("thing-v2/fresh.a", "new"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(repoRoot, "scripts", "build", "fetch-cli.ts"), "prebuilt", "thing", url, dest, "v2"],
    env: { ...bunEnv, BUN_BUILD_PREFETCH_DIR: prefetch },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).not.toContain(`extracted${sep}thing-v2`);
  expect(stdout).toContain(`by-url${sep}`);
  expect(await Bun.file(join(dest, "fresh.a")).text()).toBe("new");
  expect(await Bun.file(join(dest, ".identity")).text()).toBe("v2\n");
  expect(await Bun.file(join(dest, "stale.a")).exists()).toBe(false);
  expect(exitCode).toBe(0);
});

async function makeTarGz(entryPath: string, contents: string): Promise<Uint8Array> {
  // Minimal ustar with a single file under one top-level dir, gzipped.
  // tar header is 512 bytes; file body padded to 512.
  const body = new TextEncoder().encode(contents);
  const header = new Uint8Array(512);
  const put = (off: number, s: string) => header.set(new TextEncoder().encode(s), off);
  put(0, entryPath);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, body.length.toString(8).padStart(11, "0") + "\0");
  put(136, "00000000000\0");
  put(156, "0");
  put(257, "ustar\0");
  put(263, "00");
  // checksum: sum of header bytes with chksum field as spaces
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of header) sum += b;
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
  padded.set(body);
  const tar = new Uint8Array(header.length + padded.length + 1024); // two zero blocks at end
  tar.set(header);
  tar.set(padded, 512);
  return new Uint8Array(
    await new Response(new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"))).bytes(),
  );
}
