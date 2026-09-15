import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, githubTarball, tempDir, textLockfile } from "harness";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

// GHSA-pfwx-36v6-832x: bun.lock records the sha512 of a GitHub dependency's tarball next
// to its resolved commit, and an install that downloads the tarball again rejects
// different bytes.
//
// `owner/repo#ref` is fetched from `${GITHUB_API_URL}/repos/owner/repo/tarball/ref`, so
// each test serves the tarball built below from its own local server; nothing in this
// file talks to api.github.com.

const name = "gh-dep";
const owner = "gh-owner";
const repo = "gh-repo";
const ref = "0badc0d";
const spec = `${owner}/${repo}#${ref}`;
// GitHub's tarballs unpack into `<owner>-<repo>-<short sha>`; bun records that directory
// name in the lockfile as the resolved commit.
const resolved = `${owner}-${repo}-${ref}`;
const tarballPath = `/repos/${owner}/${repo}/tarball/${ref}`;

// Pseudo-random bytes (xorshift32) so gzip cannot shrink them.
function incompressible(bytes: number): Uint8Array {
  const words = new Uint32Array(bytes / 4);
  let x = 0x2545f491;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x;
  }
  return new Uint8Array(words.buffer);
}

const tarball = await githubTarball(resolved, {
  "package.json": JSON.stringify({ name, version: "1.0.0" }),
  "index.js": "module.exports = 1;\n",
  // The HTTP client reads at most 512 KiB (LIBUS_RECV_BUFFER_LENGTH) per socket read, so a
  // larger tarball always arrives in several chunks. That is what lets the streaming variant
  // below commit to streaming extraction on every run instead of falling back to buffering
  // when the whole body happens to arrive at once.
  "filler.bin": incompressible(600 * 1024),
});
expect(tarball.length).toBeGreaterThan(512 * 1024);

const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
const wrongIntegrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
const lockedPackage = `${name}@github:${spec}`;

function project(files: Record<string, string> = {}) {
  return tempDir("github-integrity", {
    "package.json": JSON.stringify({ name: "app", dependencies: { [name]: spec } }),
    ...files,
  });
}

function lockfileWith(entry: unknown[]) {
  return textLockfile(1, {
    workspaces: { "": { name: "app", dependencies: { [name]: spec } } },
    packages: { [name]: entry },
  });
}

async function lockedEntry(dir: string) {
  const { packages } = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
    packages: Record<string, unknown[]>;
  };
  return packages[name];
}

// Tarballs smaller than BUN_INSTALL_STREAMING_MIN_SIZE (2 MiB by default) are extracted
// once the whole body has been buffered; larger ones are streamed into libarchive while
// they download. The two extractors hash and verify the tarball independently, so every
// test runs against both. `--verbose` output names the extractor that ran.
const variants = [
  { variant: "buffered", variantEnv: {}, extracted: `[${name}] Extract ` },
  { variant: "streaming", variantEnv: { BUN_INSTALL_STREAMING_MIN_SIZE: "1" }, extracted: `[${name}] Streamed ` },
];

describe.each(variants)("GitHub tarball integrity ($variant extraction)", ({ variantEnv, extracted }) => {
  function serveTarball(dir: string) {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        return pathname === tarballPath ? new Response(tarball) : new Response("Not Found", { status: 404 });
      },
    });
    return {
      requests,
      async install() {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--verbose"],
          cwd: dir,
          env: {
            ...bunEnv,
            ...variantEnv,
            GITHUB_API_URL: server.url.origin,
            BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"),
          },
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      },
      [Symbol.asyncDispose]: () => server.stop(),
    };
  }

  test.concurrent("stores the tarball's integrity in the lockfile", async () => {
    using dir = project();
    await using github = serveTarball(String(dir));

    const { stderr, exitCode } = await github.install();
    expect(stderr).toContain(extracted);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });

  test.concurrent("re-downloading a tarball that matches the locked integrity succeeds", async () => {
    using dir = project();
    await using github = serveTarball(String(dir));

    const first = await github.install();
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);

    await rm(join(String(dir), ".bun-cache"), { recursive: true, force: true });
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });

    const second = await github.install();
    expect(second.stderr).toContain(extracted);
    expect(second.stderr).not.toContain("error:");
    expect(second.exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath, tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });

  test.concurrent("rejects a tarball that does not match the locked integrity", async () => {
    using dir = project({ "bun.lock": lockfileWith([lockedPackage, {}, resolved, wrongIntegrity]) });
    await using github = serveTarball(String(dir));

    // Both extractors report the mismatch before they log which one ran, so unlike the
    // other tests this one cannot check `extracted`; the download is shaped exactly like
    // theirs, so it goes through the same extractor they prove is in use.
    const { stderr, exitCode } = await github.install();
    expect(stderr).toContain(`Integrity check failed for tarball: ${name}`);
    expect(exitCode).not.toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(existsSync(join(String(dir), "node_modules", name))).toBeFalse();
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, wrongIntegrity]);
  });

  test.concurrent("adds the integrity to a lockfile written before it was recorded", async () => {
    using dir = project({ "bun.lock": lockfileWith([lockedPackage, {}, resolved]) });
    await using github = serveTarball(String(dir));

    const { stderr, exitCode } = await github.install();
    expect(stderr).toContain(extracted);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });

  test.concurrent("installs from the cache without downloading when the lockfile has no integrity", async () => {
    using dir = project();
    await using github = serveTarball(String(dir));

    const first = await github.install();
    expect(first.stderr).toContain(extracted);
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);

    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    const lockfile = join(String(dir), "bun.lock");
    await Bun.write(lockfile, (await Bun.file(lockfile).text()).replace(`, "${integrity}"`, ""));
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved]);

    const second = await github.install();
    expect(second.stderr).not.toContain(extracted);
    expect(second.stderr).not.toContain("error:");
    expect(second.exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });
});
