/**
 * extractTarGz() (scripts/build/download.ts) must not require symlink
 * privilege for archive entries the build never reads. On Windows without
 * Developer Mode or elevation, bsdtar extracts every other entry of the
 * zstd dep archive and exits 1 on its two symlink test fixtures
 * (tests/cli-tests/bin/{unzstd,zstdcat} -> zstd), killing the build
 * (oven-sh/bun#39669). The fallback: after a failure, list the archive's
 * symlink entries and retry with each excluded; with none, rethrow.
 *
 * The privilege failure can't be reproduced on a POSIX host (and on Windows
 * tarExe is an absolute System32 path), so these tests put a fake `tar` on
 * PATH that simulates bsdtar without symlink privilege: it extracts, then
 * deletes the symlinks it created and exits 1 the way bsdtar does, but
 * delegates listings and `--exclude` retries to the real tar.
 */
import { expect, spyOn, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractTarGz } from "../../scripts/build/download.ts";
import { BuildError } from "../../scripts/build/error.ts";

const realTar = Bun.which("tar")!;

/** A zstd-shaped .tar.gz: lib sources plus, optionally, the two symlink test fixtures. */
function makeTarball(root: string, { withSymlinks }: { withSymlinks: boolean }): string {
  const top = join(root, "src", "zstd-abc123");
  mkdirSync(join(top, "lib"), { recursive: true });
  mkdirSync(join(top, "tests", "cli-tests", "bin"), { recursive: true });
  writeFileSync(join(top, "lib", "zstd.c"), "int zstd;\n");
  writeFileSync(join(top, "tests", "cli-tests", "bin", "zstd"), "#!/bin/sh\n");
  if (withSymlinks) {
    symlinkSync("zstd", join(top, "tests", "cli-tests", "bin", "unzstd"));
    symlinkSync("zstd", join(top, "tests", "cli-tests", "bin", "zstdcat"));
  }
  const tarball = join(root, "dep.tar.gz");
  const result = spawnSync(realTar, ["-czf", tarball, "-C", join(root, "src"), "zstd-abc123"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return tarball;
}

/** Install a fake `tar` script first on PATH for the duration of fn. */
async function withFakeTar<T>(root: string, script: string, fn: () => Promise<T>): Promise<T> {
  const bin = join(root, "fake-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "tar"), script);
  chmodSync(join(bin, "tar"), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = oldPath;
  }
}

/** Simulates bsdtar on Windows without symlink privilege. */
const tarWithoutSymlinkPrivilege = `#!/bin/sh
# --exclude retries and listings (-t...) behave like the real tar.
case " $* " in
  *" --exclude="*) exec ${realTar} "$@" ;;
esac
case "$1" in
  -t*) exec ${realTar} "$@" ;;
esac
# Plain extraction: extract everything, then fail the symlink entries the
# way bsdtar does without privilege (error per entry, delayed exit 1).
dest=.
prev=
for a in "$@"; do
  [ "$prev" = "-C" ] && dest=$a
  prev=$a
done
${realTar} "$@"
find "$dest" -type l | while read -r link; do
  echo "$link: Cannot create: Invalid argument" >&2
  rm -f "$link"
done
echo "tar: Error exit delayed from previous errors." >&2
exit 1
`;

/** Fails every extraction, whatever the flags. Listings still work. */
const tarThatAlwaysFailsExtraction = `#!/bin/sh
case "$1" in
  -t*) exec ${realTar} "$@" ;;
esac
echo "boom: disk full" >&2
exit 1
`;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the extraction to fail");
}

/** The fallback narrates through console.log; collect the lines instead of printing them. */
async function withLogCaptured<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  try {
    return { result: await fn(), lines };
  } finally {
    log.mockRestore();
  }
}

test.skipIf(isWindows)("with symlink support, symlink entries extract normally", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { withSymlinks: true });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { lines } = await withLogCaptured(() => extractTarGz(tarball, dest));

  expect(lstatSync(join(dest, "tests", "cli-tests", "bin", "unzstd")).isSymbolicLink()).toBe(true);
  expect(lines).toEqual([]);
});

test.skipIf(isWindows)("without symlink privilege, extraction retries with the symlink entries excluded", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { withSymlinks: true });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { lines } = await withFakeTar(String(dir), tarWithoutSymlinkPrivilege, () =>
    withLogCaptured(() => extractTarGz(tarball, dest)),
  );

  // Everything the build reads is there; only the two fixtures are skipped.
  expect(existsSync(join(dest, "lib", "zstd.c"))).toBe(true);
  expect(existsSync(join(dest, "tests", "cli-tests", "bin", "zstd"))).toBe(true);
  expect(existsSync(join(dest, "tests", "cli-tests", "bin", "unzstd"))).toBe(false);
  expect(lines).toEqual([
    "tar exited 1; retrying without 2 symlink entries: " +
      "zstd-abc123/tests/cli-tests/bin/unzstd, zstd-abc123/tests/cli-tests/bin/zstdcat",
  ]);
});

test.skipIf(isWindows)("an archive with no symlinks rethrows the original error", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { withSymlinks: false });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { result: err, lines } = await withFakeTar(String(dir), tarThatAlwaysFailsExtraction, () =>
    withLogCaptured(() => rejection(extractTarGz(tarball, dest))),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toStartWith("tar extraction failed (exit 1):");
  expect((err as BuildError).message).toContain("boom: disk full");
  expect(lines).toEqual([]);
});

test.skipIf(isWindows)("a retry that still fails reports both attempts", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { withSymlinks: true });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { result: err, lines } = await withFakeTar(String(dir), tarThatAlwaysFailsExtraction, () =>
    withLogCaptured(() => rejection(extractTarGz(tarball, dest))),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toStartWith("tar extraction failed even with symlink entries excluded:");
  expect((err as BuildError).message).toContain("first attempt (exit 1): boom: disk full");
  expect((err as BuildError).message).toContain("retry (exit 1): boom: disk full");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("tar exited 1; retrying without 2 symlink entries:");
});
