/**
 * extractTarGz() (scripts/build/download.ts) must not require symlink
 * privilege for archive entries the build never reads. On Windows without
 * Developer Mode or elevation, bsdtar extracts every other entry of the
 * zstd dep archive and exits 1 on its two symlink test fixtures
 * (tests/cli-tests/bin/{unzstd,zstdcat} -> zstd), killing the build
 * (oven-sh/bun#39669). The fallback, opt-in via skipUnusedSymlinks (the
 * dep-archive fetch sets it, archives whose symlinks may matter do not):
 * after a failure, list the archive's symlink entries and retry with each
 * excluded; with none, or with a name that cannot be excluded literally
 * (--exclude is a glob), rethrow.
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

const realTar = Bun.which("tar");
// The fixtures are sh scripts and the fake tar intercepts a PATH lookup,
// which the absolute System32 tarExe on Windows ignores anyway.
const cannotRunFakeTar = isWindows || realTar === null;

/** A zstd-shaped .tar.gz: lib sources plus symlink test fixtures named by `symlinks`. */
function makeTarball(root: string, { symlinks, files = [] }: { symlinks: string[]; files?: string[] }): string {
  const top = join(root, "src", "zstd-abc123");
  mkdirSync(join(top, "lib"), { recursive: true });
  mkdirSync(join(top, "tests", "cli-tests", "bin"), { recursive: true });
  writeFileSync(join(top, "lib", "zstd.c"), "int zstd;\n");
  writeFileSync(join(top, "tests", "cli-tests", "bin", "zstd"), "#!/bin/sh\n");
  for (const name of symlinks) {
    symlinkSync("zstd", join(top, "tests", "cli-tests", "bin", name));
  }
  for (const name of files) {
    writeFileSync(join(top, "tests", "cli-tests", "bin", name), "");
  }
  // List the members explicitly: archiving the directory stores them in
  // readdir order, which varies by filesystem, and the tests assert on the
  // entry order the fallback reports.
  const members = [
    "zstd-abc123/lib/zstd.c",
    "zstd-abc123/tests/cli-tests/bin/zstd",
    ...symlinks.map(name => `zstd-abc123/tests/cli-tests/bin/${name}`),
    ...files.map(name => `zstd-abc123/tests/cli-tests/bin/${name}`),
  ];
  const tarball = join(root, "dep.tar.gz");
  const result = spawnSync(realTar!, ["-czf", tarball, "-C", join(root, "src"), ...members], { encoding: "utf8" });
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
# Plain extraction: extract everything, then fail the two known symlink
# fixtures the way bsdtar does without privilege (error per entry,
# delayed exit 1).
dest=.
prev=
for a in "$@"; do
  [ "$prev" = "-C" ] && dest=$a
  prev=$a
done
${realTar} "$@"
for link in "$dest/tests/cli-tests/bin/unzstd" "$dest/tests/cli-tests/bin/zstdcat"; do
  [ -L "$link" ] || continue
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

test.skipIf(cannotRunFakeTar)("with symlink support, symlink entries extract normally", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { symlinks: ["unzstd", "zstdcat"] });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { lines } = await withLogCaptured(() => extractTarGz(tarball, dest));

  expect(lstatSync(join(dest, "tests", "cli-tests", "bin", "unzstd")).isSymbolicLink()).toBe(true);
  expect(lines).toEqual([]);
});

test.skipIf(cannotRunFakeTar)(
  "without symlink privilege, extraction retries with the symlink entries excluded",
  async () => {
    using dir = tempDir("extract-symlink", {});
    const tarball = makeTarball(String(dir), { symlinks: ["unzstd", "zstdcat"] });
    const dest = join(String(dir), "out");
    mkdirSync(dest);

    const { lines } = await withFakeTar(String(dir), tarWithoutSymlinkPrivilege, () =>
      withLogCaptured(() => extractTarGz(tarball, dest, 1, { skipUnusedSymlinks: true })),
    );

    // Everything the build reads is there; only the two fixtures are skipped.
    expect(existsSync(join(dest, "lib", "zstd.c"))).toBe(true);
    expect(existsSync(join(dest, "tests", "cli-tests", "bin", "zstd"))).toBe(true);
    expect(existsSync(join(dest, "tests", "cli-tests", "bin", "unzstd"))).toBe(false);
    expect(lines).toEqual([
      "tar exited 1; retrying without 2 symlink entries: " +
        "zstd-abc123/tests/cli-tests/bin/unzstd, zstd-abc123/tests/cli-tests/bin/zstdcat",
    ]);
  },
);

test.skipIf(cannotRunFakeTar)("an archive with no symlinks rethrows the original error", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { symlinks: [] });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { result: err, lines } = await withFakeTar(String(dir), tarThatAlwaysFailsExtraction, () =>
    withLogCaptured(() => rejection(extractTarGz(tarball, dest, 1, { skipUnusedSymlinks: true }))),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toStartWith("tar extraction failed (exit 1):");
  expect((err as BuildError).message).toContain("boom: disk full");
  expect(lines).toEqual([]);
});

test.skipIf(cannotRunFakeTar)("a retry that still fails reports both attempts", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { symlinks: ["unzstd", "zstdcat"] });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { result: err, lines } = await withFakeTar(String(dir), tarThatAlwaysFailsExtraction, () =>
    withLogCaptured(() => rejection(extractTarGz(tarball, dest, 1, { skipUnusedSymlinks: true }))),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toStartWith("tar extraction failed even with symlink entries excluded:");
  expect((err as BuildError).message).toContain("first attempt (exit 1): boom: disk full");
  expect((err as BuildError).message).toContain("retry (exit 1): boom: disk full");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("tar exited 1; retrying without 2 symlink entries:");
});

test.skipIf(cannotRunFakeTar)("a symlink name with a glob metacharacter declines the fallback", async () => {
  using dir = tempDir("extract-symlink", {});
  // --exclude=un*zstd would also drop the regular member unXzstd, so the
  // fallback must rethrow the original error instead of retrying.
  const tarball = makeTarball(String(dir), { symlinks: ["un*zstd"], files: ["unXzstd"] });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  const { result: err, lines } = await withFakeTar(String(dir), tarThatAlwaysFailsExtraction, () =>
    withLogCaptured(() => rejection(extractTarGz(tarball, dest, 1, { skipUnusedSymlinks: true }))),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toStartWith("tar extraction failed (exit 1):");
  expect((err as BuildError).message).toContain("boom: disk full");
  expect(lines).toEqual([]);
});

test.skipIf(cannotRunFakeTar)("without the opt-in, a symlink failure is not retried", async () => {
  using dir = tempDir("extract-symlink", {});
  const tarball = makeTarball(String(dir), { symlinks: ["unzstd", "zstdcat"] });
  const dest = join(String(dir), "out");
  mkdirSync(dest);

  // Archives whose symlinks may matter (prebuilt WebKit, the xwin sysroot)
  // extract without skipUnusedSymlinks: a quiet success with entries missing
  // would be worse than the failure.
  const { result: err, lines } = await withFakeTar(String(dir), tarWithoutSymlinkPrivilege, () =>
    withLogCaptured(() => rejection(extractTarGz(tarball, dest))),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toStartWith("tar extraction failed (exit 1):");
  expect((err as BuildError).message).toContain("Cannot create");
  expect(lines).toEqual([]);
});
