import { file, gunzipSync, spawn, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
} from "fs";
import { chmod, exists, lstat, readdir, rm, symlink, truncate, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  DirectoryTree,
  isASAN,
  isDebug,
  isLinux,
  isRoot,
  isWindows,
  MAX_PATH_BYTES,
  normalizeBunSnapshot,
  pack,
  runBunInstall,
  substDrive,
  tempDir,
  unprivilegedSpawnOptions,
  writeBinCommand,
} from "harness";
import { mkfifo } from "mkfifo";
import { constants } from "os";
import { join } from "path";

// Runs `bun pm pack` for the package in `dir`, from `cwd`.
// `out` and `err` are normalized for inline snapshots. The shasum, the integrity
// and the packed size depend on the compressor, so `out` masks them.
async function runPack(dir: string, args: string[] = [], cwd: string = dir) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "pack", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout,
    stderr,
    out: normalizeBunSnapshot(stdout, dir)
      .replace(/^Shasum: \S+$/m, "Shasum: <shasum>")
      .replace(/^Integrity: \S+$/m, "Integrity: <integrity>")
      .replace(/^Packed size: \S+$/m, "Packed size: <packed size>"),
    err: normalizeBunSnapshot(stderr, dir),
    exitCode,
  };
}

// The counterpart of harness's `pack` for a pack that has to fail. `out` and `err` are the raw output.
async function packExpectError(cwd: string, ...args: string[]) {
  const { stdout: out, stderr: err, exitCode } = await runPack(cwd, args);
  expect(exitCode).toBeGreaterThan(0);
  return { out, err };
}

function entryNames(tarball: { entries: { pathname: string }[] }): string[] {
  return tarball.entries.map(entry => entry.pathname);
}

function tarballEntries(tarballPath: string): string[] {
  return entryNames(readTarball(tarballPath));
}

async function sortedNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

const indexJs = "console.log('hello ./index.js')";

test.concurrent("basic", async () => {
  using dir = tempDir("pack-basic", {
    "package.json": JSON.stringify({ name: "pack-basic", version: "1.2.3" }),
    "index.js": indexJs,
  });

  const { out, err, exitCode } = await runPack(dir);
  expect(err).toBe("");
  expect(out).toMatchInlineSnapshot(`
    "bun pack <version> (<revision>)

    packed 48B package.json
    packed 31B index.js

    pack-basic-1.2.3.tgz

    Total files: 2
    Shasum: <shasum>
    Integrity: <integrity>
    Unpacked size: 79B
    Packed size: <packed size>"
  `);
  expect(exitCode).toBe(0);

  expect(tarballEntries(join(dir, "pack-basic-1.2.3.tgz"))).toEqual(["package/package.json", "package/index.js"]);
});

// The archive ends right after the two end-of-archive blocks. libarchive's default for a custom
// output sink would pad it to a full 10 KiB record instead, which would change the size and shasum
// of every tarball bun produces.
test.concurrent("the archive is not padded to a full tar record", async () => {
  using dir = tempDir("pack-unpadded", {
    "package.json": JSON.stringify({ name: "pack-unpadded", version: "1.0.0" }),
    "index.js": "module.exports = 1;",
  });

  await pack(dir, bunEnv);

  const tar = gunzipSync(await file(join(dir, "pack-unpadded-1.0.0.tgz")).bytes());
  // header + data for each of the two entries, then the two end-of-archive blocks
  expect(tar.byteLength).toBe(6 * 512);
});

// pack only reads package.json, so a file that is readable but not writable (a read-only
// checkout, a file owned by another user) must not stop it.
test.concurrent.skipIf(isWindows)("read-only package.json", async () => {
  using dir = tempDir("pack-read-only", {
    "package.json": JSON.stringify({ name: "pack-read-only", version: "1.2.3" }),
    "index.js": "console.log('hello ./index.js')",
  });
  await chmod(join(String(dir), "package.json"), 0o444);
  using unprivileged = unprivilegedSpawnOptions(String(dir));

  await using proc = spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    ...unprivileged,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).toBe("");
  expect(out).toContain("pack-read-only-1.2.3.tgz");
  expect(exitCode).toBe(0);

  const tarball = readTarball(join(String(dir), "pack-read-only-1.2.3.tgz"));
  expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/index.js" }]);
});

test.concurrent("package.json integers stay plain digits", async () => {
  // The packed package.json is re-printed. Integers must not come out as 1e4.
  using dir = tempDir("pack-integers", {
    "package.json": JSON.stringify(
      { name: "pack-integers", version: "1.0.0", config: { port: 10000, size: 160000, max: 1000000000 } },
      null,
      2,
    ),
    "index.js": indexJs,
  });

  const { err, exitCode } = await runPack(dir);
  expect(err).toBe("");
  expect(exitCode).toBe(0);

  const tarball = readTarball(join(dir, "pack-integers-1.0.0.tgz"));
  expect(entryNames(tarball)).toEqual(["package/package.json", "package/index.js"]);
  const packageJson = tarball.entries[0].contents;
  expect(packageJson).toContain('"port": 10000');
  expect(packageJson).toContain('"size": 160000');
  expect(packageJson).toContain('"max": 1000000000');
  expect(packageJson).not.toMatch(/\d[eE][-+]?\d/);
});

test.concurrent("in subdirectory", async () => {
  using dir = tempDir("pack-from-subdir", {
    "package.json": JSON.stringify({ name: "pack-from-subdir", version: "7.7.7" }),
    "root.js": "console.log(`hello ./root.js`);",
    "subdir1/subdir2/index.js": "console.log(`hello ./subdir1/subdir2/index.js`);",
  });

  const first = await runPack(dir, [], join(dir, "subdir1", "subdir2"));
  expect(first.err).toBe("");
  expect(first.out).toMatchInlineSnapshot(`
    "bun pack <version> (<revision>)

    packed 54B package.json
    packed 31B root.js
    packed 48B subdir1/subdir2/index.js

    pack-from-subdir-7.7.7.tgz

    Total files: 3
    Shasum: <shasum>
    Integrity: <integrity>
    Unpacked size: 133B
    Packed size: <packed size>"
  `);
  expect(first.exitCode).toBe(0);

  const firstTarball = readTarball(join(dir, "pack-from-subdir-7.7.7.tgz"));
  expect(entryNames(firstTarball)).toEqual([
    "package/package.json",
    "package/root.js",
    "package/subdir1/subdir2/index.js",
  ]);

  await rm(join(dir, "pack-from-subdir-7.7.7.tgz"));

  const second = await runPack(dir, [], join(dir, "subdir1"));
  expect(second).toEqual(first);
  expect(readTarball(join(dir, "pack-from-subdir-7.7.7.tgz"))).toEqual(firstTarball);
});

// https://github.com/oven-sh/bun/issues/29273
// `C:` is the current directory of drive C, it is not the root `C:\`.
test.concurrent.skipIf(!isWindows)("in the root of a drive", async () => {
  using dir = tempDir("pack-drive-root", {
    "package.json": JSON.stringify({
      name: "pack-drive-root",
      version: "1.2.3",
      scripts: { prepack: "touch prepack.txt" },
    }),
    "index.js": indexJs,
  });
  using drive = substDrive(dir);

  // The script runs in the root, and the root is the directory that is packed.
  const { err, exitCode } = await runPack(drive.root);
  expect(err).toBe("$ touch prepack.txt");
  expect(tarballEntries(join(drive.root, "pack-drive-root-1.2.3.tgz"))).toEqual([
    "package/package.json",
    "package/index.js",
    "package/prepack.txt",
  ]);
  expect(exitCode).toBe(0);
});

describe.concurrent("package.json names and versions", () => {
  test("rejects name and version containing parent directory components", async () => {
    using dir = tempDir("pack-traversal", {
      "nested/project/package.json": JSON.stringify({ name: "../../outside-pkg", version: "1.0.0" }),
      "nested/project/index.js": indexJs,
    });
    const projectDir = join(dir, "nested", "project");

    const nameResult = await runPack(dir, [], projectDir);
    expect(nameResult.err).toMatchInlineSnapshot(
      `"error: package.json \`name\` and \`version\` fields must be non-empty strings"`,
    );
    expect(nameResult.out).toMatchInlineSnapshot(`"bun pack <version> (<revision>)"`);
    expect(nameResult.exitCode).toBe(1);

    // a version with ".." segments is rejected the same way
    await write(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "pack-traversal-check", version: "../1.0.0" }),
    );
    const versionResult = await runPack(dir, [], projectDir);
    expect(versionResult).toEqual(nameResult);

    // no tarball was created at the location the ".." segments resolve to, nor inside the project
    expect(await sortedNames(dir)).toEqual(["nested"]);
    expect(await sortedNames(join(dir, "nested"))).toEqual(["project"]);
    expect(await sortedNames(projectDir)).toEqual(["index.js", "package.json"]);

    // a normal name and version still packs into the project directory
    await write(join(projectDir, "package.json"), JSON.stringify({ name: "pack-traversal-check", version: "1.0.0" }));
    const { out, err, exitCode } = await runPack(dir, [], projectDir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 58B package.json
      packed 31B index.js

      pack-traversal-check-1.0.0.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 89B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(projectDir, "pack-traversal-check-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
  });

  const invalidPackageJsons = [
    {
      desc: "missing name",
      expectedError: "package.json must have `name` and `version` fields",
      packageJson: { version: "1.1.1" },
    },
    {
      desc: "missing version",
      expectedError: "package.json must have `name` and `version` fields",
      packageJson: { name: "pack-invalid" },
    },
    {
      desc: "missing name and version",
      expectedError: "package.json must have `name` and `version` fields",
      packageJson: { description: "ooops" },
    },
    {
      desc: "empty name",
      expectedError: "package.json `name` and `version` fields must be non-empty strings",
      packageJson: { name: "", version: "1.1.1" },
    },
    {
      desc: "empty version",
      expectedError: "package.json `name` and `version` fields must be non-empty strings",
      packageJson: { name: "pack-invalid", version: "" },
    },
    {
      desc: "empty name and version",
      expectedError: "package.json `name` and `version` fields must be non-empty strings",
      packageJson: { name: "", version: "" },
    },
  ];

  test.each(invalidPackageJsons)("$desc", async ({ expectedError, packageJson }) => {
    using dir = tempDir("pack-invalid", {
      "package.json": JSON.stringify(packageJson),
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe(`error: ${expectedError}`);
    expect(out).toMatchInlineSnapshot(`"bun pack <version> (<revision>)"`);
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  test("missing", async () => {
    using dir = tempDir("pack-missing", {
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toMatchInlineSnapshot(`
      "error: No package.json was found for directory "<dir>"
      note: Run "bun init" to initialize a project"
    `);
    expect(out).toMatchInlineSnapshot(`""`);
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js"]);
  });

  // `tarball` is the file the pack writes. `printed` is the name the summary shows when it
  // differs from the file. `error` means the name cannot be packed at all.
  const scopedNames: ({ input: string; tarball: string; printed?: string } | { input: string; error: string })[] = [
    { input: "@scoped/pkg", tarball: "scoped-pkg-1.1.1.tgz" },
    { input: "@", tarball: "-1.1.1.tgz" },
    { input: "@/", tarball: "--1.1.1.tgz" },
    { input: "//", tarball: "-1.1.1.tgz", printed: "//-1.1.1.tgz" },
    {
      input: "@//",
      error: 'ENOENT: No such file or directory: failed to open tarball file destination: "<dir>/-/-1.1.1.tgz" (open)',
    },
    { input: "@/s", tarball: "-s-1.1.1.tgz" },
    { input: "@s", tarball: "s-1.1.1.tgz" },
  ];

  test.each(scopedNames)("scoped name: $input", async scopedName => {
    using dir = tempDir("pack-scoped-name", {
      "package.json": JSON.stringify({ name: scopedName.input, version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir);
    if ("error" in scopedName) {
      expect(err).toBe(scopedName.error);
      expect(out).toBe("bun pack <version> (<revision>)");
      expect(exitCode).toBe(1);
      expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
      return;
    }

    const { tarball, printed } = scopedName;
    expect(err).toBe("");
    expect(out.split("\n")).toEqual([
      "bun pack <version> (<revision>)",
      "",
      expect.stringMatching(/^packed \d+B package\.json$/),
      "packed 31B index.js",
      "",
      printed ?? tarball,
      "",
      "Total files: 2",
      "Shasum: <shasum>",
      "Integrity: <integrity>",
      expect.stringMatching(/^Unpacked size: \d+B$/),
      "Packed size: <packed size>",
    ]);
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(dir, tarball))).toEqual(["package/package.json", "package/index.js"]);
  });

  // Same as `JSON.parse`, which is how every other tool reads the package.json in the tarball.
  test("the last of two equal keys wins", async () => {
    using dir = tempDir("pack-equal-keys", {
      "package.json": `{
  "name": "first-name",
  "version": "1.0.0",
  "files": ["a.js"],
  "scripts": { "prepack": "exit 1", "prepack": "exit 0" },
  "name": "pack-equal-keys",
  "version": "2.0.0",
  "files": ["b.js"]
}`,
      "a.js": indexJs,
      "b.js": indexJs,
    });

    const { err, exitCode } = await runPack(dir, ["--quiet"]);
    expect(err).not.toContain("error:");
    expect(await sortedNames(dir)).toEqual(["a.js", "b.js", "pack-equal-keys-2.0.0.tgz", "package.json"]);
    const tarball = readTarball(join(dir, "pack-equal-keys-2.0.0.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", "package/b.js"]);
    expect(tarball.entries[0].contents).toBe(`{
  "scripts": {
    "prepack": "exit 0"
  },
  "name": "pack-equal-keys",
  "version": "2.0.0",
  "files": ["b.js"]
}`);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("flags", () => {
  test("--dry-run", async () => {
    using dir = tempDir("pack-dry-run", {
      "package.json": JSON.stringify({ name: "pack-dry-run", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir, ["--dry-run"]);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 41B package.json
      packed 31B index.js

      pack-dry-run-1.1.1.tgz

      Total files: 2
      Unpacked size: 72B"
    `);
    expect(exitCode).toBe(0);

    // --dry-run never writes the tarball.
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  const gzipPackageJson = JSON.stringify({ name: "pack-gzip-test", version: "111111.1.11111111111111" });

  test.each(["-1", "10", "kjefj"])("--gzip-level=%s is rejected", async level => {
    using dir = tempDir("pack-gzip-level", {
      "package.json": gzipPackageJson,
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir, [`--gzip-level=${level}`]);
    expect(err).toBe(`error: compression level must be between 0 and 9, received ${level}`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  test("--gzip-level", async () => {
    using dir = tempDir("pack-gzip", {
      "package.json": gzipPackageJson,
      "index.js": indexJs,
    });
    const tarballPath = join(dir, "pack-gzip-test-111111.1.11111111111111.tgz");

    const stored = await runPack(dir, ["--gzip-level=0"]);
    expect(stored.err).toBe("");
    expect(stored.out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 70B package.json
      packed 31B index.js

      pack-gzip-test-111111.1.11111111111111.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 101B
      Packed size: <packed size>"
    `);
    expect(stored.exitCode).toBe(0);
    const storedTarball = readTarball(tarballPath);
    expect(entryNames(storedTarball)).toEqual(["package/package.json", "package/index.js"]);

    await rm(tarballPath);

    const compressed = await runPack(dir, ["--gzip-level=9"]);
    expect(compressed.err).toBe("");
    expect(compressed.out).toBe(stored.out);
    expect(compressed.exitCode).toBe(0);
    const compressedTarball = readTarball(tarballPath);
    expect(compressedTarball.entries).toEqual(storedTarball.entries);

    expect(compressedTarball.size).toBeLessThan(storedTarball.size);
  });

  const destinationTests = [
    { path: "", tarball: "<dir>/pack-dest-test-1.1.1.tgz" },
    { path: "dest-dir", tarball: "<dir>/dest-dir/pack-dest-test-1.1.1.tgz" },
    { path: "more/dir", tarball: "<dir>/more/dir/pack-dest-test-1.1.1.tgz" },
  ];

  test.each(destinationTests)('--destination="$path"', async ({ path, tarball }) => {
    using dir = tempDir("pack-destination", {
      "package.json": JSON.stringify({ name: "pack-dest-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const dest = join(dir, path);
    const { out, err, exitCode } = await runPack(dir, [`--destination=${dest}`]);
    expect(err).toBe("");
    expect(out.split("\n")).toEqual([
      "bun pack <version> (<revision>)",
      "",
      "packed 52B package.json",
      "packed 31B index.js",
      "",
      tarball,
      "",
      "Total files: 2",
      "Shasum: <shasum>",
      "Integrity: <integrity>",
      "Unpacked size: 83B",
      "Packed size: <packed size>",
    ]);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dest, "pack-dest-test-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
  });

  // The destination directory ends `headroom` bytes short of the path buffer, so it still fits,
  // but the longer "/<name>-<version>.tgz" appended to it does not. Windows command lines cannot
  // carry an argument anywhere near its path buffer size.
  test.skipIf(isWindows)("--destination with no room left for the tarball name", async () => {
    const pathMax = isLinux ? 4096 : 1024;
    const headroom = 100;
    const name = `pack-dest-too-long-${Buffer.alloc(2 * headroom, "n").toString()}`;
    using dir = tempDir("pack-dest-too-long", {
      "package.json": JSON.stringify({ name, version: "1.0.0" }),
      "index.js": indexJs,
    });

    // dir + "/" + filler is `headroom` bytes short of the buffer
    const filler = Buffer.alloc(pathMax - headroom - Buffer.byteLength(String(dir)) - 1, "d").toString();
    const dest = join(dir, filler);
    const { out, stderr, exitCode } = await runPack(dir, [`--destination=${dest}`]);
    expect(stderr).toBe(`error: archive destination name too long: "${dest}/${name}-1.0.0.tgz"\n`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  test.each(["test.tgz", "no-extension", "no-extension.tar", "out/foo.tar"])('--filename="%s"', async filename => {
    using dir = tempDir("pack-filename", {
      "package.json": JSON.stringify({ name: "pack-dest-test", version: "1.1.1" }),
      "index.js": indexJs,
      out: {},
    });

    const { out, err, exitCode } = await runPack(dir, [`--filename=${filename}`]);
    expect(err).toBe("");
    expect(out.split("\n")).toEqual([
      "bun pack <version> (<revision>)",
      "",
      "packed 52B package.json",
      "packed 31B index.js",
      "",
      `<dir>/${filename}`,
      "",
      "Total files: 2",
      "Shasum: <shasum>",
      "Integrity: <integrity>",
      "Unpacked size: 83B",
      "Packed size: <packed size>",
    ]);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, filename))).toEqual(["package/package.json", "package/index.js"]);
  });

  test("--filename into a directory that does not exist", async () => {
    using dir = tempDir("pack-filename-missing-dir", {
      "package.json": JSON.stringify({ name: "pack-dest-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir, ["--filename=out/foo.tgz"]);
    expect(err).toMatchInlineSnapshot(
      `"ENOENT: No such file or directory: failed to open tarball file destination: "<dir>/out/foo.tgz" (open)"`,
    );
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  // The destination used to be opened a second time to hash it, which on a FIFO waits for another writer forever.
  // This end is open before pack starts and the tarball fits the pipe's buffer, so nothing here can block;
  // a pack that does is killed by `timeout`.
  test.skipIf(isWindows)("--filename can be a FIFO", async () => {
    using dir = tempDir("pack-fifo", {
      "package.json": JSON.stringify({ name: "pack-fifo", version: "1.1.1" }),
      "index.js": indexJs,
    });
    const fifo = join(dir, "out.fifo");
    mkfifo(fifo);
    const reader = openSync(fifo, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "pm", "pack", "--quiet", "--filename=out.fifo"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: bunEnv,
        timeout: 30_000,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toBe("");
      expect(out).toBe(`${fifo}\n`);
      expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });

      const packed = Buffer.alloc(16 * 1024);
      await write(join(dir, "out.tgz"), packed.subarray(0, readSync(reader, packed)));
      expect(tarballEntries(join(dir, "out.tgz"))).toEqual(["package/package.json", "package/index.js"]);
      expect((await lstat(fifo)).isFIFO()).toBe(true);
    } finally {
      closeSync(reader);
    }
  });

  // Every write(2) to /dev/full fails with ENOSPC, the same as a tarball destination on a full disk.
  // "an entry": enough incompressible data that libarchive flushes a block while it writes index.js.
  // "the end of the archive": small enough that the only write(2) happens when the archive is closed.
  test.skipIf(!isLinux).each([
    ["an entry", () => `// ${randomBytes(128 * 1024).toString("base64")}`],
    ["the end of the archive", () => indexJs],
  ] as const)("reports ENOSPC when the disk fills up while writing %s", async (_, indexJsContents) => {
    using dir = tempDir("pack-enospc", {
      "package.json": JSON.stringify({ name: "pack-enospc", version: "1.1.1" }),
      "index.js": indexJsContents(),
    });

    const { out, err, exitCode } = await runPack(dir, ["--filename=/dev/full"]);
    expect(err).toBe(`ENOSPC: No space left on device: failed to write tarball "/dev/full" (write)`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
  });

  test("--filename and --destination", async () => {
    using dir = tempDir("pack-filename-and-destination", {
      "package.json": JSON.stringify({ name: "pack-dest-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { out, err, exitCode } = await runPack(dir, ["--filename=test.tgz", "--destination=packed"]);
    expect(err).toMatchInlineSnapshot(
      `"error: cannot use both filename and destination at the same time with tarball: filename "test.tgz" and destination "packed""`,
    );
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  // On Windows the path buffer is larger than any command line, so the overflow cannot be reached there.
  describe.skipIf(isWindows)("--destination longer than the path buffer", () => {
    const longName = Buffer.alloc(MAX_PATH_BYTES + 1, "d").toString();
    const packageJson = JSON.stringify({ name: "pack-long-dest", version: "1.0.0" });
    const expectedError = `error: archive destination name too long: "${longName}"\n`;

    async function packWithDestination(dir: string, destination: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), "pm", "pack", ...args, `--destination=${destination}`],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: bunEnv,
      });
      return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    }

    test.concurrent("is reported as an error", async () => {
      await using dir = tempDir("pack-long-destination", { "package.json": packageJson });

      const [out, err, exitCode] = await packWithDestination(dir, longName);

      expect(err).toContain(expectedError);
      expect(out).not.toContain(".tgz");
      expect(exitCode).toBe(1);
      expect(await exists(join(dir, "pack-long-dest-1.0.0.tgz"))).toBeFalse();
    });

    test.concurrent("is reported as an error with --dry-run", async () => {
      await using dir = tempDir("pack-long-destination-dry-run", { "package.json": packageJson });

      const [out, err, exitCode] = await packWithDestination(dir, `${longName}/`, "--dry-run");

      expect(err).toContain(expectedError);
      expect(out).not.toContain(".tgz");
      expect(exitCode).toBe(1);
    });

    test.concurrent("packs when the path normalizes to one that fits", async () => {
      await using dir = tempDir("pack-long-destination-normalized", { "package.json": packageJson });

      // `<over-long name>/..` resolves back to the package directory.
      const { out } = await pack(dir, bunEnv, `--destination=${longName}/..`);

      expect(out).toContain(join(dir, "pack-long-dest-1.0.0.tgz"));
      expect(readTarball(join(dir, "pack-long-dest-1.0.0.tgz")).entries).toMatchObject([
        { "pathname": "package/package.json" },
      ]);
    });
  });

  test("--ignore-scripts", async () => {
    using dir = tempDir("pack-ignore-scripts", {
      "package.json": JSON.stringify({
        name: "pack-ignore-scripts",
        version: "1.1.1",
        scripts: {
          prepack: "touch prepack.txt",
          postpack: "touch postpack.txt",
          preprepare: "touch preprepare.txt",
          prepare: "touch prepare.txt",
          postprepare: "touch postprepare.txt",
        },
      }),
      "index.js": indexJs,
    });

    const ignored = await runPack(dir, ["--ignore-scripts"]);
    expect(ignored.err).toBe("");
    expect(ignored.out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 272B package.json
      packed 31B index.js

      pack-ignore-scripts-1.1.1.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 303B
      Packed size: <packed size>"
    `);
    expect(ignored.exitCode).toBe(0);
    expect(await sortedNames(dir)).toEqual(["index.js", "pack-ignore-scripts-1.1.1.tgz", "package.json"]);

    await rm(join(dir, "pack-ignore-scripts-1.1.1.tgz"));

    // prepack, prepare and postpack run in that order; preprepare and postprepare never run
    const { out, err, exitCode } = await runPack(dir);
    expect(err).toMatchInlineSnapshot(`
      "$ touch prepack.txt
      $ touch prepare.txt
      $ touch postpack.txt"
    `);
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 272B package.json
      packed 31B index.js
      packed 0KB prepack.txt
      packed 0KB prepare.txt

      pack-ignore-scripts-1.1.1.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 303B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);
    expect(await sortedNames(dir)).toEqual([
      "index.js",
      "pack-ignore-scripts-1.1.1.tgz",
      "package.json",
      "postpack.txt",
      "prepack.txt",
      "prepare.txt",
    ]);
    expect(tarballEntries(join(dir, "pack-ignore-scripts-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
      "package/prepack.txt",
      "package/prepare.txt",
    ]);
  });

  test("--quiet", async () => {
    using dir = tempDir("pack-quiet", {
      "package.json": JSON.stringify({ name: "pack-quiet-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { stdout, err, exitCode } = await runPack(dir, ["--quiet"]);
    expect(err).toBe("");
    // Exactly the tarball name with no leading newline, so `$(bun pm pack --quiet)` works.
    expect(stdout).toBe("pack-quiet-test-1.1.1.tgz\n");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-quiet-test-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
  });

  test("--silent", async () => {
    using dir = tempDir("pack-silent", {
      "package.json": JSON.stringify({ name: "pack-silent-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { stdout, err, exitCode } = await runPack(dir, ["--silent"]);
    expect(err).toBe("");
    expect(stdout).toBe("pack-silent-test-1.1.1.tgz\n");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-silent-test-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
  });

  test("--quiet with --destination", async () => {
    using dir = tempDir("pack-quiet-destination", {
      "package.json": JSON.stringify({ name: "pack-quiet-dest-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const dest = join(dir, "out");
    const { stdout, err, exitCode } = await runPack(dir, ["--quiet", `--destination=${dest}`]);
    expect(err).toBe("");
    const tarballPath = join(dest, "pack-quiet-dest-test-1.1.1.tgz");
    expect(stdout).toBe(`${tarballPath}\n`);
    expect(exitCode).toBe(0);

    expect(tarballEntries(tarballPath)).toEqual(["package/package.json", "package/index.js"]);
  });

  test("--quiet with --dry-run", async () => {
    using dir = tempDir("pack-quiet-dry-run", {
      "package.json": JSON.stringify({ name: "pack-quiet-dry-test", version: "1.1.1" }),
      "index.js": indexJs,
    });

    const { stdout, err, exitCode } = await runPack(dir, ["--quiet", "--dry-run"]);
    expect(err).toBe("");
    expect(stdout).toBe("pack-quiet-dry-test-1.1.1.tgz\n");
    expect(exitCode).toBe(0);

    const dest = join(dir, "out");
    const withDestination = await runPack(dir, ["--quiet", "--dry-run", `--destination=${dest}`]);
    expect(withDestination.err).toBe("");
    expect(withDestination.stdout).toBe(`${join(dest, "pack-quiet-dry-test-1.1.1.tgz")}\n`);
    expect(withDestination.exitCode).toBe(0);

    // --dry-run never writes the tarball.
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
  });

  describe("relative --destination and --filename resolve against the cwd", () => {
    // `bun pm pack` chdirs to the package root, or to the workspace root above it, before packing.
    // The flags were typed relative to the directory the command was run from, so that is what
    // they must resolve against: not the directory bun chdir'd to, and not the packed package's directory.
    const packageJsonEntry = { pathname: "package/package.json" };

    test.concurrent("--filename from a workspace package", async () => {
      using dir = tempDir("pack-cwd-filename-workspace", {
        "package.json": JSON.stringify({ name: "pack-cwd-root", version: "0.0.0", workspaces: ["packages/*"] }),
        "packages/pkg/package.json": JSON.stringify({ name: "pack-cwd-pkg", version: "1.2.3" }),
      });
      const pkgDir = join(String(dir), "packages", "pkg");

      const { out } = await pack(pkgDir, bunEnv, "--quiet", "--filename=./pkg.tgz");

      expect(out).toBe(`${join(pkgDir, "pkg.tgz")}\n`);
      expect(await exists(join(String(dir), "pkg.tgz"))).toBeFalse();
      expect(readTarball(join(pkgDir, "pkg.tgz")).entries).toMatchObject([packageJsonEntry]);
    });

    test.concurrent("--destination from a workspace package", async () => {
      using dir = tempDir("pack-cwd-destination-workspace", {
        "package.json": JSON.stringify({ name: "pack-cwd-root", version: "0.0.0", workspaces: ["packages/*"] }),
        "packages/pkg/package.json": JSON.stringify({ name: "pack-cwd-pkg", version: "1.2.3" }),
      });
      const pkgDir = join(String(dir), "packages", "pkg");

      const { out } = await pack(pkgDir, bunEnv, "--quiet", "--destination=./out");

      const tarballPath = join(pkgDir, "out", "pack-cwd-pkg-1.2.3.tgz");
      expect(out).toBe(`${tarballPath}\n`);
      expect(await exists(join(String(dir), "out"))).toBeFalse();
      expect(readTarball(tarballPath).entries).toMatchObject([packageJsonEntry]);
    });

    test.concurrent("--destination from a subdirectory of a workspace package", async () => {
      using dir = tempDir("pack-cwd-destination-workspace-subdir", {
        "package.json": JSON.stringify({ name: "pack-cwd-root", version: "0.0.0", workspaces: ["packages/*"] }),
        "packages/pkg/package.json": JSON.stringify({ name: "pack-cwd-pkg", version: "1.2.3" }),
        "packages/pkg/src": {},
      });
      const pkgDir = join(String(dir), "packages", "pkg");

      // cwd is packages/pkg/src, the packed package is packages/pkg, and bun chdir'd to the workspace root
      const { out } = await pack(join(pkgDir, "src"), bunEnv, "--quiet", "--destination=../dist");

      const tarballPath = join(pkgDir, "dist", "pack-cwd-pkg-1.2.3.tgz");
      expect(out).toBe(`${tarballPath}\n`);
      expect(await exists(join(String(dir), "packages", "dist"))).toBeFalse();
      expect(await exists(join(String(dir), "dist"))).toBeFalse();
      expect(readTarball(tarballPath).entries).toMatchObject([packageJsonEntry]);
    });

    test.concurrent("--destination from a subdirectory of the package", async () => {
      using dir = tempDir("pack-cwd-destination-subdir", {
        "package.json": JSON.stringify({ name: "pack-cwd-subdir", version: "1.0.0" }),
        "sub": {},
      });
      const subDir = join(String(dir), "sub");

      const { out } = await pack(subDir, bunEnv, "--quiet", "--destination=./out");

      const tarballPath = join(subDir, "out", "pack-cwd-subdir-1.0.0.tgz");
      expect(out).toBe(`${tarballPath}\n`);
      expect(await exists(join(String(dir), "out"))).toBeFalse();
      expect(readTarball(tarballPath).entries).toMatchObject([packageJsonEntry]);
    });

    test.concurrent("--filename from a subdirectory of the package", async () => {
      using dir = tempDir("pack-cwd-filename-subdir", {
        "package.json": JSON.stringify({ name: "pack-cwd-subdir", version: "1.0.0" }),
        // --filename does not create directories, so both candidate locations exist up front
        "sub/out": {},
        "out": {},
      });
      const subDir = join(String(dir), "sub");

      const { out } = await pack(subDir, bunEnv, "--quiet", "--filename=out/pkg.tgz");

      expect(out).toBe(`${join(subDir, "out", "pkg.tgz")}\n`);
      expect(await exists(join(String(dir), "out", "pkg.tgz"))).toBeFalse();
      expect(readTarball(join(subDir, "out", "pkg.tgz")).entries).toMatchObject([packageJsonEntry]);
    });

    test.concurrent("--dry-run prints the path the tarball would be written to", async () => {
      using dir = tempDir("pack-cwd-dry-run", {
        "package.json": JSON.stringify({ name: "pack-cwd-dry-run", version: "1.0.0" }),
        "sub": {},
      });
      const subDir = join(String(dir), "sub");

      const [{ out: destinationOut }, { out: filenameOut }] = await Promise.all([
        pack(subDir, bunEnv, "--quiet", "--dry-run", "--destination=./out"),
        pack(subDir, bunEnv, "--quiet", "--dry-run", "--filename=./pkg.tgz"),
      ]);

      expect(destinationOut).toBe(`${join(subDir, "out", "pack-cwd-dry-run-1.0.0.tgz")}\n`);
      expect(filenameOut).toBe(`${join(subDir, "pkg.tgz")}\n`);
      expect(await exists(join(subDir, "out"))).toBeFalse();
      expect(await exists(join(String(dir), "out"))).toBeFalse();
      expect(await exists(join(subDir, "pkg.tgz"))).toBeFalse();
      expect(await exists(join(String(dir), "pkg.tgz"))).toBeFalse();
    });

    test.concurrent("absolute paths are used as given", async () => {
      using dir = tempDir("pack-cwd-absolute", {
        "package.json": JSON.stringify({ name: "pack-cwd-root", version: "0.0.0", workspaces: ["packages/*"] }),
        "packages/pkg/package.json": JSON.stringify({ name: "pack-cwd-pkg", version: "1.2.3" }),
        "elsewhere": {},
      });
      const pkgDir = join(String(dir), "packages", "pkg");
      const elsewhere = join(String(dir), "elsewhere");

      const [{ out: filenameOut }, { out: destinationOut }] = await Promise.all([
        pack(pkgDir, bunEnv, "--quiet", `--filename=${join(elsewhere, "named.tgz")}`),
        pack(pkgDir, bunEnv, "--quiet", `--destination=${join(elsewhere, "out")}`),
      ]);

      expect(filenameOut).toBe(`${join(elsewhere, "named.tgz")}\n`);
      expect(destinationOut).toBe(`${join(elsewhere, "out", "pack-cwd-pkg-1.2.3.tgz")}\n`);
      expect(readTarball(join(elsewhere, "named.tgz")).entries).toMatchObject([packageJsonEntry]);
      expect(readTarball(join(elsewhere, "out", "pack-cwd-pkg-1.2.3.tgz")).entries).toMatchObject([packageJsonEntry]);
    });

    test.concurrent("the default location is still the packed package's directory", async () => {
      using dir = tempDir("pack-cwd-default", {
        "package.json": JSON.stringify({ name: "pack-cwd-root", version: "0.0.0", workspaces: ["packages/*"] }),
        "packages/pkg/package.json": JSON.stringify({ name: "pack-cwd-pkg", version: "1.2.3" }),
        "packages/pkg/src": {},
      });
      const pkgDir = join(String(dir), "packages", "pkg");

      const { out } = await pack(join(pkgDir, "src"), bunEnv, "--quiet");

      expect(out).toBe("pack-cwd-pkg-1.2.3.tgz\n");
      expect(await exists(join(pkgDir, "src", "pack-cwd-pkg-1.2.3.tgz"))).toBeFalse();
      expect(await exists(join(String(dir), "pack-cwd-pkg-1.2.3.tgz"))).toBeFalse();
      expect(readTarball(join(pkgDir, "pack-cwd-pkg-1.2.3.tgz")).entries).toMatchObject([packageJsonEntry]);
    });

    // PATH_MAX is 4096 on Linux and 1024 on macOS. Windows' path buffer is larger than any command line.
    describe.skipIf(isWindows)("--filename longer than PATH_MAX", () => {
      const longName = Buffer.alloc(5000, "f").toString();
      const packageJson = JSON.stringify({ name: "pack-cwd-long-filename", version: "1.0.0" });

      test.concurrent("is reported as an error", async () => {
        using dir = tempDir("pack-cwd-long-filename", { "package.json": packageJson });

        const { err } = await packExpectError(String(dir), `--filename=${longName}`);

        expect(err).toContain(`error: archive filename too long: "${longName}"\n`);
      });

      test.concurrent("packs when the resolved path fits", async () => {
        using dir = tempDir("pack-cwd-long-filename-normalized", { "package.json": packageJson });

        // `<5000 bytes>/../pkg.tgz` resolves to `<cwd>/pkg.tgz`.
        const { out } = await pack(String(dir), bunEnv, "--quiet", `--filename=${longName}/../pkg.tgz`);

        expect(out).toBe(`${join(String(dir), "pkg.tgz")}\n`);
        expect(readTarball(join(String(dir), "pkg.tgz")).entries).toMatchObject([packageJsonEntry]);
      });
    });
  });
});

// The tarball used to be streamed to its destination while it was being built, so any failure on
// the way exited 1 and left a truncated `<name>-<version>.tgz` behind for the next `bun publish
// ./*.tgz` to pick up. `ulimit -f 0` (RLIMIT_FSIZE) makes every write to the tarball fail with
// EFBIG, which unlike a permission based setup also works when the tests run as root; setting it
// needs a POSIX shell.
describe.skipIf(isWindows)("a failed pack leaves no tarball behind", () => {
  const packageJson = JSON.stringify({ name: "pack-failed", version: "1.0.0" });

  async function packExpectingFailure(cwd: string, { fileSizeLimit }: { fileSizeLimit: boolean }, ...args: string[]) {
    await using proc = spawn({
      cmd: fileSizeLimit
        ? ["/bin/sh", "-c", 'ulimit -f 0 && exec "$0" pm pack "$@"', bunExe(), ...args]
        : [bunExe(), "pm", "pack", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { err, exitCode };
  }

  test.concurrent.each([
    { args: [], left: ["index.js", "package.json"] },
    { args: ["--destination=out"], left: ["index.js", "out", "package.json"] },
    { args: ["--filename=custom.tgz"], left: ["index.js", "package.json"] },
  ])("when the tarball cannot be written (args: $args)", async ({ args, left }) => {
    await using dir = tempDir("pack-failed", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
    });

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: true }, ...args);

    expect(err).toContain("EFBIG");
    expect(err).toContain('failed to write tarball "');
    expect({ exitCode, left: (await readdir(dir, { recursive: true })).sort() }).toEqual({ exitCode: 1, left });
  });

  test.concurrent("and keeps the tarball of an earlier pack", async () => {
    await using dir = tempDir("pack-failed-earlier", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
      "pack-failed-1.0.0.tgz": "an earlier tarball",
    });

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: true });

    expect(err).toContain('failed to write tarball "');
    expect(await sortedNames(dir)).toEqual(["index.js", "pack-failed-1.0.0.tgz", "package.json"]);
    expect({ exitCode, earlier: await file(join(dir, "pack-failed-1.0.0.tgz")).text() }).toEqual({
      exitCode: 1,
      earlier: "an earlier tarball",
    });
  });

  // Root can read a mode 000 file, so this one only runs as a regular user.
  test.concurrent.skipIf(isRoot)("when one of the files cannot be opened", async () => {
    await using dir = tempDir("pack-failed-unreadable", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
      "unreadable.js": "module.exports = 2;",
    });
    await chmod(join(dir, "unreadable.js"), 0o000);

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: false });

    expect(err).toContain('EACCES: Permission denied: failed to open file: "unreadable.js"');
    expect({ exitCode, left: await sortedNames(dir) }).toEqual({
      exitCode: 1,
      left: ["index.js", "package.json", "unreadable.js"],
    });
  });

  // Only the regular file pack itself created (or truncated) is removed; a destination that is
  // something else, like a symlink, is not pack's to delete.
  test.concurrent("does not delete a --filename that is a symlink", async () => {
    await using dir = tempDir("pack-failed-symlink", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
      "target.tgz": "",
    });
    await symlink("target.tgz", join(dir, "link.tgz"));

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: true }, "--filename=link.tgz");

    expect(err).toContain('failed to write tarball "');
    expect(err).toContain('link.tgz"');
    expect({ exitCode, linkIsSymlink: (await lstat(join(dir, "link.tgz"))).isSymbolicLink() }).toEqual({
      exitCode: 1,
      linkIsSymlink: true,
    });
  });

  // A destination that cannot even be opened was not written to, so it is left as it is (root can
  // open a read-only file, hence the skip).
  test.concurrent.skipIf(isRoot)("keeps a destination it cannot open for writing", async () => {
    await using dir = tempDir("pack-failed-readonly-dest", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
      "pack-failed-1.0.0.tgz": "an earlier tarball",
    });
    await chmod(join(dir, "pack-failed-1.0.0.tgz"), 0o444);

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: false });

    expect(err).toContain('EACCES: Permission denied: failed to open tarball file destination: "');
    expect({ exitCode, destination: await file(join(dir, "pack-failed-1.0.0.tgz")).text() }).toEqual({
      exitCode: 1,
      destination: "an earlier tarball",
    });
  });

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial("and keeps the tarball that a --filename links to", async () => {
    await using dir = tempDir("pack-failed-link", {
      "package.json": JSON.stringify({ name: "pack-failed", version: "1.0.0", files: ["index.js", "unreadable.js"] }),
      "index.js": "module.exports = 1;",
      "unreadable.js": "module.exports = 2;",
      "artifacts/earlier.tgz": "an earlier tarball",
    });
    await symlink(join("artifacts", "earlier.tgz"), join(dir, "latest.tgz"));
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    await chmod(join(dir, "unreadable.js"), 0o000);

    await using proc = spawn({
      cmd: [bunExe(), "pm", "pack", "--filename=latest.tgz"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
      ...unprivileged,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain('EACCES: Permission denied: failed to open file: "unreadable.js"');
    expect({ exitCode, earlier: await file(join(dir, "artifacts", "earlier.tgz")).text() }).toEqual({
      exitCode: 1,
      earlier: "an earlier tarball",
    });
  });
});

describe.concurrent("something already exists at the tarball's destination", () => {
  const files = {
    "pkg/package.json": JSON.stringify({ name: "pack-over", version: "1.0.0", files: ["index.js"] }),
    "pkg/index.js": indexJs,
  };
  const entries = ["package/package.json", "package/index.js"];

  test.each([
    ["to a file", [], true],
    ["to nothing", [], false],
    ["to a file, in --destination", ["--destination=out"], true],
  ] as [string, string[], boolean][])("a symlink %s is replaced", async (_, args, targetExists) => {
    using dir = tempDir("pack-over-link", {
      ...files,
      "pkg/out": {},
      ...(targetExists ? { "other.txt": "as it was" } : {}),
    });
    const tarball = join(dir, "pkg", args.length ? "out" : "", "pack-over-1.0.0.tgz");
    await symlink(join(dir, "other.txt"), tarball, "file");

    const { err, exitCode } = await runPack(join(dir, "pkg"), args);
    expect(err).toBe("");
    expect((await lstat(tarball)).isSymbolicLink()).toBe(false);
    expect(tarballEntries(tarball)).toEqual(entries);
    expect(await sortedNames(dir)).toEqual(targetExists ? ["other.txt", "pkg"] : ["pkg"]);
    if (targetExists) expect(await file(join(dir, "other.txt")).text()).toBe("as it was");
    expect(exitCode).toBe(0);
  });

  test("a symlink that --filename points to stays a symlink", async () => {
    using dir = tempDir("pack-over-typed-link", { ...files, "pkg/artifacts/earlier.tgz": "an earlier tarball" });
    const link = join(dir, "pkg", "latest.tgz");
    await symlink(join("artifacts", "earlier.tgz"), link, "file");

    const { err, exitCode } = await runPack(join(dir, "pkg"), ["--filename=latest.tgz"]);
    expect(err).toBe("");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(tarballEntries(join(dir, "pkg", "artifacts", "earlier.tgz"))).toEqual(entries);
    expect(exitCode).toBe(0);
  });

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial.skipIf(isWindows)("a writable file in a read-only folder", async () => {
    using dir = tempDir("pack-over-locked", { ...files, "pkg/out/pack-over-1.0.0.tgz": "an earlier tarball" });
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    await chmod(join(dir, "pkg", "out"), 0o555);
    try {
      await using proc = spawn({
        cmd: [bunExe(), "pm", "pack", "--quiet", "--destination=out"],
        cwd: join(dir, "pkg"),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: bunEnv,
        ...unprivileged,
      });
      const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toBe("");
      expect(tarballEntries(join(dir, "pkg", "out", "pack-over-1.0.0.tgz"))).toEqual(entries);
      expect(exitCode).toBe(0);
    } finally {
      await chmod(join(dir, "pkg", "out"), 0o755);
    }
  });

  test.skipIf(isWindows)("a file keeps its mode", async () => {
    using dir = tempDir("pack-over-mode", { ...files, "pkg/pack-over-1.0.0.tgz": "an earlier tarball" });
    const tarball = join(dir, "pkg", "pack-over-1.0.0.tgz");
    await chmod(tarball, 0o600);

    const { err, exitCode } = await runPack(join(dir, "pkg"));
    expect(err).toBe("");
    expect(tarballEntries(tarball)).toEqual(entries);
    expect((await lstat(tarball)).mode & 0o777).toBe(0o600);
    expect(exitCode).toBe(0);
  });
});

// A pack that is killed cannot tidy up.
test.concurrent.each([{}, { files: ["*"] }])("leftovers of a killed pack aren't packed (%j)", async fields => {
  using dir = tempDir("pack-killed", {
    "package.json": JSON.stringify({ name: "pack-killed", version: "1.0.0", ...fields }),
    "index.js": indexJs,
    "big.bin": randomBytes(16 * 1024 * 1024),
  });
  const before = await sortedNames(dir);

  const killed = spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd: String(dir),
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: bunEnv,
  });
  // Until it has begun to write, or is over.
  while (killed.exitCode === null && (await readdir(dir)).length === before.length) {}
  killed.kill("SIGKILL");
  await killed.exited;
  await rm(join(dir, "pack-killed-1.0.0.tgz"), { force: true });

  const { err, exitCode } = await runPack(dir, ["--gzip-level=0"]);
  expect(err).toBe("");
  expect(tarballEntries(join(dir, "pack-killed-1.0.0.tgz")).sort()).toEqual([
    "package/big.bin",
    "package/index.js",
    "package/package.json",
  ]);
  expect(exitCode).toBe(0);
});

// This is what a watcher does to its output: truncate it, then write it again. /proc shows how far pack has read.
test.concurrent.skipIf(!isLinux)("a file that gets shorter while it is read fails the pack", async () => {
  using dir = tempDir("pack-shorter", {
    "package.json": JSON.stringify({ name: "pack-shorter", version: "1.0.0" }),
    "bundle.js": randomBytes(32 * 1024 * 1024),
  });
  const bundle = realpathSync(join(dir, "bundle.js"));

  await using proc = spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });
  function bytesRead() {
    try {
      for (const fd of readdirSync(`/proc/${proc.pid}/fd`)) {
        if (readlinkSync(`/proc/${proc.pid}/fd/${fd}`) !== bundle) continue;
        return Number(/^pos:\s*(\d+)/m.exec(readFileSync(`/proc/${proc.pid}/fdinfo/${fd}`, "utf8"))![1]);
      }
    } catch {}
    return 0;
  }
  while (proc.exitCode === null && bytesRead() === 0) await new Promise(setImmediate);
  await truncate(bundle, 1024);

  const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toBe('error: file shrank while packing: "bundle.js"\n');
  expect(await sortedNames(dir)).toEqual(["bundle.js", "package.json"]);
  expect(exitCode).toBe(1);
});

// A file of zeroes costs no disk, and --gzip-level=0 stores it, so the tarball is as big as the file.
test.concurrent("peak memory does not grow with the size of the tarball", async () => {
  using dir = tempDir("pack-memory", {
    "package.json": JSON.stringify({ name: "pack-memory", version: "1.0.0", files: ["zeroes.bin"] }),
    "zeroes.bin": "",
  });

  async function peakMemory(size: number) {
    await truncate(join(dir, "zeroes.bin"), size);
    await using proc = spawn({
      cmd: [bunExe(), "pm", "pack", "--quiet", "--gzip-level=0"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(out).toBe("pack-memory-1.0.0.tgz\n");
    expect(exitCode).toBe(0);
    expect(file(join(dir, "pack-memory-1.0.0.tgz")).size).toBeGreaterThan(size);
    return proc.resourceUsage()!.maxRSS;
  }

  const MiB = 1024 * 1024;
  const small = await peakMemory(1 * MiB);
  const large = await peakMemory(32 * MiB);
  // A release build grows by under 1 MiB. One that holds the tarball in memory grew by 36 to 54 MiB, never under 31.
  expect(large - small).toBeLessThan((isASAN || isDebug ? 16 : 8) * MiB);
  expect(await sortedNames(dir)).toEqual(["pack-memory-1.0.0.tgz", "package.json", "zeroes.bin"]);
});

test.concurrent("shasum and integrity are consistent", async () => {
  using dir = tempDir("pack-shasum", {
    "package.json": JSON.stringify({ name: "pack-shasum", version: "1.1.1" }),
    "index.js": indexJs,
  });

  const first = await runPack(dir);
  expect(first.err).toBe("");
  expect(first.out).toMatchInlineSnapshot(`
    "bun pack <version> (<revision>)

    packed 49B package.json
    packed 31B index.js

    pack-shasum-1.1.1.tgz

    Total files: 2
    Shasum: <shasum>
    Integrity: <integrity>
    Unpacked size: 80B
    Packed size: <packed size>"
  `);
  expect(first.exitCode).toBe(0);

  const tarball = readTarball(join(dir, "pack-shasum-1.1.1.tgz"));
  expect(entryNames(tarball)).toEqual(["package/package.json", "package/index.js"]);
  expect(first.stdout).toContain(`\nShasum: ${tarball.shasum}\n`);
  // the summary shortens the integrity to its first 13 and last 15 characters
  expect(first.stdout).toContain(
    `\nIntegrity: sha512-${tarball.integrity.slice(0, 13)}[...]${tarball.integrity.slice(-15)}\n`,
  );

  await rm(join(dir, "pack-shasum-1.1.1.tgz"));

  // the same tree packs to the same bytes
  const second = await runPack(dir);
  expect(second).toEqual(first);
  expect(readTarball(join(dir, "pack-shasum-1.1.1.tgz"))).toEqual(tarball);
});

describe.concurrent("workspaces", () => {
  const basicWorkspace = {
    "package.json": JSON.stringify({ name: "pack-workspace", version: "2.2.2", workspaces: ["pkgs/*"] }),
    "root.js": "console.log('hello ./root.js')",
    "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.1.1" }),
    "pkgs/pkg1/index.js": indexJs,
  };

  test("in a workspace", async () => {
    using dir = tempDir("pack-workspace", basicWorkspace);

    const { out, err, exitCode } = await runPack(dir, [], join(dir, "pkgs", "pkg1"));
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 42B package.json
      packed 31B index.js

      pkg1-1.1.1.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 73B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pkgs", "pkg1", "pkg1-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
  });

  test("in a workspace subdirectory", async () => {
    using dir = tempDir("pack-workspace-subdir", { ...basicWorkspace, "pkgs/pkg1/subdir": {} });

    const { out, err, exitCode } = await runPack(dir, [], join(dir, "pkgs", "pkg1", "subdir"));
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 42B package.json
      packed 31B index.js

      pkg1-1.1.1.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 73B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pkgs", "pkg1", "pkg1-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
  });

  describe("lifecycle scripts describe the workspace member being packed", () => {
    const echoPackageEnv = "$npm_package_name $npm_package_version $npm_package_json $npm_config_local_prefix";

    function memberWorkspace() {
      const dir = tempDir("pack-workspace-member-env", {
        "package.json": JSON.stringify({ name: "pack-workspace", version: "2.2.2", workspaces: ["pkgs/*"] }),
        "pkgs/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          version: "1.1.1",
          scripts: {
            prepack: `echo prepack ${echoPackageEnv}`,
            postpack: `echo postpack ${echoPackageEnv}`,
            release: `'${bunExe()}' pm pack --dry-run`,
          },
        }),
      });
      const pkg1Dir = join(dir, "pkgs", "pkg1");
      // npm_config_local_prefix is the workspace root, as with npm.
      const memberEnv = `pkg1 1.1.1 ${join(pkg1Dir, "package.json")} ${dir}`;
      return { dir, pkg1Dir, expectedLines: [`prepack ${memberEnv}`, `postpack ${memberEnv}`] };
    }

    function lifecycleLines(out: string) {
      return out.split("\n").filter(line => line.startsWith("prepack ") || line.startsWith("postpack "));
    }

    test("bun pm pack in the member", async () => {
      const { dir, pkg1Dir, expectedLines } = memberWorkspace();
      using _ = dir;
      const { out } = await pack(pkg1Dir, bunEnv, "--dry-run");
      expect(lifecycleLines(out)).toEqual(expectedLines);
    });

    test("bun pm pack from a member script", async () => {
      const { dir, pkg1Dir, expectedLines } = memberWorkspace();
      using _ = dir;
      await using proc = spawn({
        cmd: [bunExe(), "run", "--silent", "release"],
        cwd: pkg1Dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(lifecycleLines(out)).toEqual(expectedLines);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
    });
  });

  test("replaces workspace: protocol without lockfile", async () => {
    using dir = tempDir("pack-workspace-protocol", {
      "package.json": JSON.stringify({
        name: "pack-workspace-protocol",
        version: "2.3.4",
        workspaces: ["pkgs/*"],
        dependencies: {
          "pkg1": "workspace:1.1.1",
        },
      }),
      "root.js": "console.log('hello ./root.js')",
      "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.1.1" }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 134B package.json
      packed 33B pkgs/pkg1/package.json
      packed 30B root.js

      pack-workspace-protocol-2.3.4.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 197B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-workspace-protocol-2.3.4.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", "package/pkgs/pkg1/package.json", "package/root.js"]);
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "pack-workspace-protocol",
      version: "2.3.4",
      workspaces: ["pkgs/*"],
      dependencies: {
        "pkg1": "1.1.1",
      },
    });
  });

  const withLockfileWorkspaceProtocolTests = [
    { input: "workspace:^", expected: "^1.1.1" },
    { input: "workspace:~", expected: "~1.1.1" },
    { input: "workspace:1.x", expected: "1.x" },
    { input: "workspace:1.1.x", expected: "1.1.x" },
    { input: "workspace:*", expected: "1.1.1" },
    { input: "workspace:-", expected: "-" },
    // leading whitespace is not part of the specifier
    { input: " workspace:^", expected: "^1.1.1" },
    // aliasing a workspace under its own name needs no `npm:` alias
    { input: "workspace:pkg1@*", expected: "1.1.1" },
    { input: "workspace:pkg1@~", expected: "~1.1.1" },
    { input: "workspace:pkg1@1.x", expected: "1.x" },
  ];

  test.each(withLockfileWorkspaceProtocolTests)(
    "replaces workspace: protocol with lockfile: $input",
    async ({ input, expected }) => {
      using dir = tempDir("pack-workspace-protocol-lockfile", {
        "package.json": JSON.stringify({
          name: "pack-workspace-protocol-with-lockfile",
          version: "2.5.6",
          workspaces: ["pkgs/*"],
          dependencies: {
            "pkg1": input,
          },
        }),
        "root.js": "console.log('hello ./root.js')",
        "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.1.1" }),
      });

      await runBunInstall(bunEnv, String(dir));
      const { out, err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(out.split("\n")).toEqual([
        "bun pack <version> (<revision>)",
        "",
        expect.stringMatching(/^packed \d+B package\.json$/),
        "packed 33B pkgs/pkg1/package.json",
        "packed 30B root.js",
        "",
        "pack-workspace-protocol-with-lockfile-2.5.6.tgz",
        "",
        "Total files: 3",
        "Shasum: <shasum>",
        "Integrity: <integrity>",
        expect.stringMatching(/^Unpacked size: \d+B$/),
        "Packed size: <packed size>",
      ]);
      expect(exitCode).toBe(0);

      const tarball = readTarball(join(dir, "pack-workspace-protocol-with-lockfile-2.5.6.tgz"));
      expect(entryNames(tarball)).toEqual([
        "package/package.json",
        "package/pkgs/pkg1/package.json",
        "package/root.js",
      ]);
      expect(JSON.parse(tarball.entries[0].contents)).toEqual({
        name: "pack-workspace-protocol-with-lockfile",
        version: "2.5.6",
        workspaces: ["pkgs/*"],
        dependencies: {
          "pkg1": expected,
        },
      });
    },
  );

  test.each([
    { input: "workspace:*", expected: "2.3.4" },
    { input: "workspace:^", expected: "^2.3.4" },
    { input: "workspace:~", expected: "~2.3.4" },
    { input: "workspace:2.x", expected: "2.x" },
    { input: "workspace:pack-workspace-root@^", expected: "^2.3.4" },
  ])("replaces workspace: protocol naming the root package: $input", async ({ input, expected }) => {
    using dir = tempDir("pack-workspace-protocol-root", {
      "package.json": JSON.stringify({ name: "pack-workspace-root", version: "2.3.4", workspaces: ["pkgs/*"] }),
      "pkgs/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "pack-workspace-root": input },
      }),
    });

    const { err, exitCode } = await runPack(dir, [], join(dir, "pkgs", "pkg1"));
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pkgs", "pkg1", "pkg1-1.0.0.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json"]);
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "pkg1",
      version: "1.0.0",
      dependencies: { "pack-workspace-root": expected },
    });
  });

  test("resolves workspace:* from the workspace's package.json without a lockfile", async () => {
    using dir = tempDir("pack-workspace-protocol-no-lockfile", {
      "package.json": JSON.stringify({
        name: "pack-workspace-protocol-no-lockfile",
        version: "2.2.3",
        workspaces: ["pkgs/*"],
        dependencies: {
          "pkg1": "workspace:*",
        },
      }),
      "root.js": "console.log('hello ./root.js')",
      "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.1.1" }),
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-workspace-protocol-no-lockfile-2.2.3.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", "package/pkgs/pkg1/package.json", "package/root.js"]);
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "pack-workspace-protocol-no-lockfile",
      version: "2.2.3",
      workspaces: ["pkgs/*"],
      dependencies: {
        "pkg1": "1.1.1",
      },
    });
  });

  test("fails when no workspace with a version matches a workspace:* dependency", async () => {
    using dir = tempDir("pack-workspace-no-match", {});
    await Promise.all([
      write(join(dir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkgs/*"] })),
      write(join(dir, "pkgs", "unversioned", "package.json"), JSON.stringify({ name: "unversioned" })),
      write(
        join(dir, "pkgs", "app1", "package.json"),
        JSON.stringify({ name: "app1", version: "1.0.0", dependencies: { "not-a-workspace": "workspace:*" } }),
      ),
      write(
        join(dir, "pkgs", "app2", "package.json"),
        JSON.stringify({ name: "app2", version: "1.0.0", devDependencies: { "unversioned": "workspace:^" } }),
      ),
    ]);

    const app1 = await packExpectError(join(dir, "pkgs", "app1"));
    expect(app1.err).toContain('error: Failed to resolve workspace version for "not-a-workspace" in `dependencies` (');
    expect(app1.err).toContain(
      'package.json" has no workspace named "not-a-workspace", or its package.json has no version).',
    );
    expect(await exists(join(dir, "pkgs", "app1", "app1-1.0.0.tgz"))).toBeFalse();

    const app2 = await packExpectError(join(dir, "pkgs", "app2"));
    expect(app2.err).toContain('error: Failed to resolve workspace version for "unversioned" in `devDependencies` (');
    expect(app2.err).toContain(
      'package.json" has no workspace named "unversioned", or its package.json has no version).',
    );
    expect(await exists(join(dir, "pkgs", "app2", "app2-1.0.0.tgz"))).toBeFalse();
  });

  // https://github.com/oven-sh/bun/issues/20477: a release bumps versions (`bun pm version`,
  // changesets) after the last `bun install`, so bun.lock still has the versions from before
  // the bump when the packages get packed and published.
  test("uses the versions and catalogs in the package.json files, not the ones in bun.lock", async () => {
    const rootPackageJson = (react: string) =>
      JSON.stringify({
        name: "mono",
        private: true,
        workspaces: { packages: ["packages/*"], catalog: { react } },
      });
    const corePackageJson = (version: string) => JSON.stringify({ name: "@acme/core", version });
    const utilsPackageJson = (version: string) =>
      JSON.stringify({
        name: "@acme/utils",
        version,
        dependencies: { "@acme/core": "workspace:*" },
        devDependencies: { "@acme/core": "workspace:~" },
        peerDependencies: { "@acme/core": "workspace:^", "react": "catalog:" },
        // optional so that `bun install` does not need a registry to install react
        peerDependenciesMeta: { react: { optional: true } },
      });
    using dir = tempDir("pack-workspace-stale-lockfile", {});
    const coreDir = join(dir, "packages", "core");
    const utilsDir = join(dir, "packages", "utils");

    await Promise.all([
      write(join(dir, "package.json"), rootPackageJson("^18.3.1")),
      write(join(coreDir, "package.json"), corePackageJson("1.2.3")),
      write(join(utilsDir, "package.json"), utilsPackageJson("0.4.0")),
    ]);
    await runBunInstall(bunEnv, String(dir));

    await Promise.all([
      write(join(dir, "package.json"), rootPackageJson("^19.1.0")),
      write(join(coreDir, "package.json"), corePackageJson("1.3.0")),
      write(join(utilsDir, "package.json"), utilsPackageJson("0.4.1")),
    ]);
    const lockfile = await file(join(dir, "bun.lock")).text();
    expect(lockfile).toContain('"version": "1.2.3"');
    expect(lockfile).toContain('"react": "^18.3.1"');

    await pack(utilsDir, bunEnv);

    const tarball = readTarball(join(utilsDir, "acme-utils-0.4.1.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "@acme/utils",
      version: "0.4.1",
      dependencies: { "@acme/core": "1.3.0" },
      devDependencies: { "@acme/core": "~1.3.0" },
      peerDependencies: { "@acme/core": "^1.3.0", "react": "^19.1.0" },
      peerDependenciesMeta: { react: { optional: true } },
    });
  });

  test("packing the workspace root uses the versions in the workspaces' package.json files", async () => {
    using dir = tempDir("pack-workspace-root", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-workspace-root",
          version: "2.0.0",
          workspaces: ["pkgs/*"],
          dependencies: { "pkg1": "workspace:*" },
        }),
      ),
      write(join(dir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
    ]);
    await runBunInstall(bunEnv, String(dir));
    await write(join(dir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.2.0" }));

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-workspace-root-2.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "1.2.0" });
  });

  test("sees the versions a prepack script writes to other workspaces", async () => {
    using dir = tempDir("pack-workspace-prepack-bump", {});
    const pkg1PackageJson = join(dir, "pkgs", "pkg1", "package.json");
    await Promise.all([
      write(join(dir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkgs/*"] })),
      write(pkg1PackageJson, JSON.stringify({ name: "pkg1", version: "1.0.0" })),
      write(
        join(dir, "pkgs", "app", "package.json"),
        JSON.stringify({
          name: "app",
          version: "1.0.0",
          scripts: { prepack: `${bunExe()} bump-pkg1.js` },
          dependencies: { "pkg1": "workspace:*" },
        }),
      ),
      write(
        join(dir, "pkgs", "app", "bump-pkg1.js"),
        `require("fs").writeFileSync(${JSON.stringify(pkg1PackageJson)}, JSON.stringify({ name: "pkg1", version: "2.0.0" }));`,
      ),
    ]);
    await runBunInstall(bunEnv, String(dir));

    await pack(join(dir, "pkgs", "app"), bunEnv);

    const tarball = readTarball(join(dir, "pkgs", "app", "app-1.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "2.0.0" });
  });

  // pack does not read the lockfile, so a lockfile that would not parse (mid-rebase, truncated) does
  // not get in the way, whether or not the package has specs to resolve.
  const unreadableLockfiles = [
    { label: "an empty bun.lock", file: "bun.lock", contents: "" },
    {
      label: "a bun.lock with git conflict markers",
      file: "bun.lock",
      contents: `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
${"<<<<<<<"} HEAD
      "dependencies": {},
${"======="}
      "devDependencies": {},
${">>>>>>>"} feature
    },
  },
  "packages": {},
}
`,
    },
    { label: "a corrupt bun.lockb", file: "bun.lockb", contents: "not a lockfile" },
  ];

  for (const { label, file: lockfile, contents } of unreadableLockfiles) {
    test(`packs a package without workspace specs next to ${label}`, async () => {
      using dir = tempDir("pack-bad-lockfile", {});
      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify({ name: "pack-bad-lockfile", version: "1.0.0" })),
        write(join(dir, "index.js"), "module.exports = 1"),
        write(join(dir, lockfile), contents),
      ]);

      const { err } = await pack(dir, bunEnv);
      expect(err).toBe("");

      const tarball = readTarball(join(dir, "pack-bad-lockfile-1.0.0.tgz"));
      expect(tarball.entries).toMatchObject([
        { "pathname": "package/package.json" },
        { "pathname": "package/index.js" },
      ]);
    });

    test(`resolves workspace:* next to ${label}`, async () => {
      using dir = tempDir("pack-workspace-bad-lockfile", {});
      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkgs/*"] })),
        write(join(dir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
        write(
          join(dir, "pkgs", "app", "package.json"),
          JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "pkg1": "workspace:*" } }),
        ),
        write(join(dir, lockfile), contents),
      ]);

      const { err } = await pack(join(dir, "pkgs", "app"), bunEnv);
      expect(err).toBe("");

      const tarball = readTarball(join(dir, "pkgs", "app", "app-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "1.1.1" });
    });
  }

  // Only the root's `workspaces` and catalogs are read to resolve a spec. Its own dependency sections
  // are `bun install`'s business: a `workspace:<range>` there is packed as written (see the table
  // above) and does not have to match the workspace, whether the root or a member is being packed.
  describe("a workspace: range in the root that no workspace satisfies", () => {
    const files = {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["pkgs/*"],
        dependencies: { "pkg1": "workspace:9.9.9", "pkg2": "workspace:*" },
      }),
      "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.0.1" }),
      "pkgs/pkg2/package.json": JSON.stringify({ name: "pkg2", version: "2.0.0" }),
      "pkgs/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "pkg2": "workspace:^" },
      }),
    };

    test("packing the root", async () => {
      using dir = tempDir("pack-workspace-unsatisfied-range", files);
      await pack(dir, bunEnv);

      const tarball = readTarball(join(dir, "root-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "9.9.9", "pkg2": "2.0.0" });
    });

    test("packing a member", async () => {
      using dir = tempDir("pack-workspace-unsatisfied-range", files);
      await pack(join(dir, "pkgs", "app"), bunEnv);

      const tarball = readTarball(join(dir, "pkgs", "app", "app-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg2": "^2.0.0" });
    });
  });

  describe("a workspaces entry that does not exist", () => {
    const files = {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["pkgs/pkg1", "pkgs/app", "pkgs/plain", "pkgs/missing"],
      }),
      "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.0.0" }),
      "pkgs/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "pkg1": "workspace:*" },
      }),
      "pkgs/plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0" }),
    };

    test("fails a pack that has to resolve a workspace: spec, with bun install's error", async () => {
      using dir = tempDir("pack-workspace-missing-entry", files);
      const { err } = await packExpectError(join(dir, "pkgs", "app"));
      expect(err).toContain('error: Workspace not found "pkgs/missing"');
      expect(err).toContain("package.json:1:");
      expect(await exists(join(dir, "pkgs", "app", "app-1.0.0.tgz"))).toBeFalse();
    });

    test("does not affect a pack that has nothing to resolve", async () => {
      using dir = tempDir("pack-workspace-missing-entry", files);
      const { err } = await pack(join(dir, "pkgs", "plain"), bunEnv);
      expect(err).toBe("");
      expect(await exists(join(dir, "pkgs", "plain", "plain-1.0.0.tgz"))).toBeTrue();
    });
  });

  // pkgs/ui depends on its sibling workspaces by directory (`workspace:../core`)
  function createDirectoryWorkspace(uiDependencies: Record<string, Record<string, string>>) {
    return tempDir("pack-workspace-directories", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["pkgs/*", "pkgs/@scoped/*"] }),
      "pkgs/core/package.json": JSON.stringify({ name: "@acme/core", version: "1.2.3" }),
      "pkgs/plain/package.json": JSON.stringify({ name: "plain", version: "0.5.0" }),
      "pkgs/@scoped/thing/package.json": JSON.stringify({ name: "thing", version: "0.0.7" }),
      "pkgs/ui/package.json": JSON.stringify({ name: "@acme/ui", version: "2.0.0", ...uiDependencies }),
    });
  }

  test("replaces workspace: directories with the version of the workspace in that directory", async () => {
    using dir = createDirectoryWorkspace({
      dependencies: {
        "core": "workspace:../core",
        // declared under the workspace's own name, so no alias is needed
        "@acme/core": "workspace:../core",
        "core-dot": "workspace:./../core",
        "core-slash": "workspace:../core/",
        // the `@` in the directory does not make this `workspace:<name>@<range>`
        "scoped-dir": "workspace:../@scoped/thing",
        "self": "workspace:.",
      },
      devDependencies: {
        "plain": "workspace:../plain",
      },
      peerDependencies: {
        "plain-peer": "workspace:../plain",
      },
      optionalDependencies: {
        "plain-optional": "workspace:../plain",
      },
    });
    // every one of these is a spec `bun install` links
    await runBunInstall(bunEnv, String(dir));

    await pack(join(dir, "pkgs", "ui"), bunEnv);

    const tarball = readTarball(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "@acme/ui",
      version: "2.0.0",
      dependencies: {
        "core": "npm:@acme/core@1.2.3",
        "@acme/core": "1.2.3",
        "core-dot": "npm:@acme/core@1.2.3",
        "core-slash": "npm:@acme/core@1.2.3",
        "scoped-dir": "npm:thing@0.0.7",
        "self": "npm:@acme/ui@2.0.0",
      },
      devDependencies: {
        "plain": "0.5.0",
      },
      peerDependencies: {
        "plain-peer": "npm:plain@0.5.0",
      },
      optionalDependencies: {
        "plain-optional": "npm:plain@0.5.0",
      },
    });
  });

  test("replaces workspace: directories in the workspace root with the versions in the workspaces' package.json files", async () => {
    using dir = createDirectoryWorkspace({});
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "pack-workspace-root-directories",
        version: "3.0.0",
        workspaces: ["pkgs/*", "pkgs/@scoped/*"],
        dependencies: {
          "core": "workspace:pkgs/core",
          "plain": "workspace:./pkgs/plain",
        },
      }),
    );
    await runBunInstall(bunEnv, String(dir));
    // bumped after the install, so bun.lock still says 0.5.0
    await write(join(dir, "pkgs", "plain", "package.json"), JSON.stringify({ name: "plain", version: "0.6.0" }));

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-workspace-root-directories-3.0.0.tgz"));
    expect(tarball.entries[0]).toMatchObject({ pathname: "package/package.json" });
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({
      "core": "npm:@acme/core@1.2.3",
      "plain": "0.6.0",
    });
  });

  test("replaces a workspace: directory given as a bare directory name", async () => {
    // `bun install` joins whatever follows `workspace:` onto the declaring package.json's directory,
    // so from the root the directory name alone is enough. Only a dependency that is itself a
    // workspace reads it as a version range instead.
    using dir = tempDir("pack-workspace-bare-directory", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-workspace-bare-directory",
          version: "3.0.0",
          workspaces: ["core", "plain"],
          dependencies: { "bare": "workspace:core", "@acme/core": "workspace:core", "plain": "workspace:0.x" },
        }),
      ),
      write(join(dir, "core", "package.json"), JSON.stringify({ name: "@acme/core", version: "1.2.3" })),
      write(join(dir, "plain", "package.json"), JSON.stringify({ name: "plain", version: "0.5.0" })),
    ]);
    await runBunInstall(bunEnv, String(dir));

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-workspace-bare-directory-3.0.0.tgz"));
    expect(tarball.entries[0]).toMatchObject({ pathname: "package/package.json" });
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({
      "bare": "npm:@acme/core@1.2.3",
      "@acme/core": "1.2.3",
      "plain": "0.x",
    });
  });

  test("replaces workspace: directories without a lockfile", async () => {
    using dir = createDirectoryWorkspace({
      dependencies: { "core": "workspace:../core", "plain": "workspace:../plain" },
    });

    await pack(join(dir, "pkgs", "ui"), bunEnv);

    const tarball = readTarball(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({
      "core": "npm:@acme/core@1.2.3",
      "plain": "0.5.0",
    });
  });

  // `"core-star": "workspace:@acme/core@*"` installs workspace @acme/core under the name core-star
  test("replaces workspace: aliases with npm: aliases", async () => {
    using dir = createDirectoryWorkspace({
      dependencies: {
        "core-star": "workspace:@acme/core@*",
        "core-caret": "workspace:@acme/core@^",
        "core-tilde": "workspace:@acme/core@~",
        "core-range": "workspace:@acme/core@^1.0.0",
        "core-exact": "workspace:@acme/core@1.2.3",
        "core-tag": "workspace:@acme/core@latest",
        "core-spaced": "workspace:@acme/core@ ^ ",
        // `bun install` links an empty range like `*`
        "core-empty": "workspace:@acme/core@",
        "thing-star": "workspace:thing@*",
      },
      devDependencies: {
        "plain-star": "workspace:plain@*",
        "plain-range": "workspace:plain@0.x",
      },
      peerDependencies: {
        "plain-peer": "workspace:plain@^",
      },
      optionalDependencies: {
        "plain-optional": "workspace:plain@~",
      },
    });
    // every one of these is a spec `bun install` links
    await runBunInstall(bunEnv, String(dir));

    await pack(join(dir, "pkgs", "ui"), bunEnv);

    const tarball = readTarball(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "@acme/ui",
      version: "2.0.0",
      dependencies: {
        "core-star": "npm:@acme/core@1.2.3",
        "core-caret": "npm:@acme/core@^1.2.3",
        "core-tilde": "npm:@acme/core@~1.2.3",
        "core-range": "npm:@acme/core@^1.0.0",
        "core-exact": "npm:@acme/core@1.2.3",
        "core-tag": "npm:@acme/core@latest",
        "core-spaced": "npm:@acme/core@^1.2.3",
        "core-empty": "npm:@acme/core@1.2.3",
        "thing-star": "npm:thing@0.0.7",
      },
      devDependencies: {
        "plain-star": "npm:plain@0.5.0",
        "plain-range": "npm:plain@0.x",
      },
      peerDependencies: {
        "plain-peer": "npm:plain@^0.5.0",
      },
      optionalDependencies: {
        "plain-optional": "npm:plain@~0.5.0",
      },
    });
  });

  test("replaces workspace: aliases with the versions in the package.json files, without a lockfile", async () => {
    using dir = createDirectoryWorkspace({
      dependencies: { "core": "workspace:@acme/core@*", "plain-caret": "workspace:plain@^" },
    });
    await runBunInstall(bunEnv, String(dir));
    // bumped after the install, so bun.lock still says 1.2.3
    await write(join(dir, "pkgs", "core", "package.json"), JSON.stringify({ name: "@acme/core", version: "1.3.0" }));

    await pack(join(dir, "pkgs", "ui"), bunEnv);
    const installed = readTarball(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(JSON.parse(installed.entries[0].contents).dependencies).toEqual({
      "core": "npm:@acme/core@1.3.0",
      "plain-caret": "npm:plain@^0.5.0",
    });

    await rm(join(dir, "bun.lock"));
    await rm(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    await pack(join(dir, "pkgs", "ui"), bunEnv);
    const uninstalled = readTarball(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(uninstalled.entries[0].contents).toBe(installed.entries[0].contents);
  });

  test("fails when the workspace a workspace: alias installs has no version", async () => {
    using dir = createDirectoryWorkspace({
      dependencies: { "core": "workspace:@acme/core@*" },
      devDependencies: { "no-version": "workspace:unversioned@^" },
    });
    await write(join(dir, "pkgs", "unversioned", "package.json"), JSON.stringify({ name: "unversioned" }));

    const { err } = await packExpectError(join(dir, "pkgs", "ui"));
    expect(err).toContain(
      'error: Failed to resolve workspace version for "no-version" in `devDependencies` (workspace "unversioned" has no version in package.json).',
    );
    expect(await exists(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"))).toBeFalse();
  });

  const notAWorkspaceSpecs = [
    // exists on disk, but the root's `workspaces` does not list it (written below)
    { group: "devDependencies", name: "unlisted", spec: "workspace:../../unlisted", reported: "unlisted" },
    { group: "dependencies", name: "missing", spec: "workspace:../missing", reported: "missing" },
    // the `@` in a directory does not make it `<name>@<range>`; the error names the dependency
    { group: "dependencies", name: "scoped-dir", spec: "workspace:../@scoped/missing", reported: "scoped-dir" },
    // a range only means something for a dependency that is itself a workspace
    { group: "peerDependencies", name: "not-a-workspace", spec: "workspace:1.2.3", reported: "not-a-workspace" },
    // and `<name>@<range>` only when <name> is a workspace, whatever the range, so the error names <name>
    { group: "optionalDependencies", name: "bogus-alias", spec: "workspace:nope@*", reported: "nope" },
    { group: "dependencies", name: "bogus-alias", spec: "workspace:@acme/nope@^1.0.0", reported: "@acme/nope" },
  ];

  for (const { group, name, spec, reported } of notAWorkspaceSpecs) {
    test(`fails when a workspace: spec is neither a workspace's directory nor a workspace's range: ${spec}`, async () => {
      using dir = createDirectoryWorkspace({
        dependencies: { "plain": "workspace:../plain" },
        [group]: { [name]: spec },
      });
      await write(join(dir, "unlisted", "package.json"), JSON.stringify({ name: "unlisted", version: "1.0.0" }));

      const { err } = await packExpectError(join(dir, "pkgs", "ui"));
      expect(err).toContain(`error: Failed to resolve workspace version for "${name}" in \`${group}\` (`);
      expect(err).toContain(
        `package.json" has no workspace named "${reported}" and no workspace in the directory "${spec.slice("workspace:".length)}").`,
      );
      expect(await exists(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"))).toBeFalse();
    });
  }

  test("fails when the workspace in a workspace: directory has no version", async () => {
    using dir = createDirectoryWorkspace({ dependencies: { "no-version": "workspace:../unversioned" } });
    await write(join(dir, "pkgs", "unversioned", "package.json"), JSON.stringify({ name: "unversioned" }));

    const { err } = await packExpectError(join(dir, "pkgs", "ui"));
    expect(err).toContain(
      'error: Failed to resolve workspace version for "no-version" in `dependencies` (workspace "unversioned" in "../unversioned" has no version in package.json).',
    );
    expect(await exists(join(dir, "pkgs", "ui", "acme-ui-2.0.0.tgz"))).toBeFalse();
  });
});

test.concurrent("lifecycle scripts execution order", async () => {
  const script = `const fs = require("fs");
  fs.writeFileSync(\`\${process.argv[2]}.txt\`, \`
prepack: \${fs.existsSync("prepack.txt")}
prepare: \${fs.existsSync("prepare.txt")}
postpack: \${fs.existsSync("postpack.txt")}
tarball: \${fs.existsSync("pack-lifecycle-order-1.1.1.tgz")}\`)`;

  using dir = tempDir("pack-lifecycle-order", {
    "package.json": JSON.stringify({
      name: "pack-lifecycle-order",
      version: "1.1.1",
      scripts: {
        prepack: `${bunExe()} script.js prepack`,
        postpack: `${bunExe()} script.js postpack`,
        prepare: `${bunExe()} script.js prepare`,
      },
    }),
    "script.js": script,
  });

  const { out, stderr, exitCode } = await runPack(dir);
  expect(stderr).toBe(
    [`$ ${bunExe()} script.js prepack`, `$ ${bunExe()} script.js prepare`, `$ ${bunExe()} script.js postpack`, ""].join(
      "\n",
    ),
  );
  // package.json embeds the path to bun, so its size differs between machines (and passes 512
  // bytes on some CI agents, where the size prints as "0.58KB")
  expect(out.split("\n")).toEqual([
    "bun pack <version> (<revision>)",
    "",
    expect.stringMatching(/^packed \S+ package\.json$/),
    "packed 61B prepack.txt",
    "packed 60B prepare.txt",
    "packed 259B script.js",
    "",
    "pack-lifecycle-order-1.1.1.tgz",
    "",
    "Total files: 4",
    "Shasum: <shasum>",
    "Integrity: <integrity>",
    expect.stringMatching(/^Unpacked size: /),
    "Packed size: <packed size>",
  ]);
  expect(exitCode).toBe(0);

  expect(tarballEntries(join(dir, "pack-lifecycle-order-1.1.1.tgz"))).toEqual([
    "package/package.json",
    "package/prepack.txt",
    "package/prepare.txt",
    "package/script.js",
  ]);

  const results = await Promise.all([
    Bun.file(join(dir, "prepack.txt")).text(),
    Bun.file(join(dir, "postpack.txt")).text(),
    Bun.file(join(dir, "prepare.txt")).text(),
  ]);

  expect(results).toEqual([
    "\nprepack: false\nprepare: false\npostpack: false\ntarball: false",
    "\nprepack: true\nprepare: true\npostpack: false\ntarball: true",
    "\nprepack: true\nprepare: false\npostpack: false\ntarball: false",
  ]);
});

test.concurrent("--dry-run still runs prepack, prepare and postpack", async () => {
  using dir = tempDir("pack-dry-run-scripts", {
    "package.json": JSON.stringify({
      name: "pack-dry-run-scripts",
      version: "1.1.1",
      scripts: {
        prepack: "echo prepack > prepack.txt",
        prepare: "echo prepare > prepare.txt",
        postpack: "echo postpack > postpack.txt",
      },
    }),
  });

  const { exitCode } = await runPack(dir, ["--dry-run"]);
  // The three markers exist and no tarball does.
  expect(await sortedNames(String(dir))).toEqual(["package.json", "postpack.txt", "prepack.txt", "prepare.txt"]);
  expect(exitCode).toBe(0);
});

describe.concurrent("lifecycle scripts run the commands in node_modules/.bin", () => {
  const scripts = { prepack: "tool", prepare: "tool", postpack: "tool" };

  test("of the package", async () => {
    using dir = tempDir("pack-bin-path", {
      "package.json": JSON.stringify({ name: "pack-bin-path", version: "1.0.0", scripts }),
    });
    writeBinCommand(String(dir), "tool", "tool of the package");

    const { stdout, err, exitCode } = await runPack(String(dir));
    expect(err).toBe("$ tool\n$ tool\n$ tool");
    expect(stdout.match(/^tool of .*$/gm)).toEqual(Array(3).fill("tool of the package"));
    expect(exitCode).toBe(0);
  });

  test.each([
    ["of the member before the workspace root's", ["root", "member"], "member"],
    ["of the workspace root, for a member", ["root"], "root"],
  ] as const)("%s", async (_, has, runs) => {
    using dir = tempDir("pack-bin-path-workspace", {
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["pkgs/*"] }),
      "pkgs/member/package.json": JSON.stringify({ name: "member", version: "1.0.0", scripts }),
    });
    const dirs = { root: String(dir), member: join(dir, "pkgs", "member") };
    for (const owner of has) writeBinCommand(dirs[owner], "tool", `tool of the ${owner}`);

    const { stdout, err, exitCode } = await runPack(dirs.member, ["--dry-run"]);
    expect(err).toBe("$ tool\n$ tool\n$ tool");
    expect(stdout.match(/^tool of .*$/gm)).toEqual(Array(3).fill(`tool of the ${runs}`));
    expect(exitCode).toBe(0);
  });
});

test.concurrent("lifecycle script modifying version updates tarball filename (#17195)", async () => {
  const updateScript = `const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = "2.0.0-snapshot.test";
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));`;

  using dir = tempDir("pack-version-update", {
    "package.json": JSON.stringify({
      name: "pack-version-update",
      version: "1.0.0",
      scripts: {
        prepack: `${bunExe()} update-version.js`,
      },
    }),
    "update-version.js": updateScript,
    "index.js": "module.exports = {};",
  });

  const { out, stderr, exitCode } = await runPack(dir);
  expect(stderr).toBe(`$ ${bunExe()} update-version.js\n`);
  // The tarball filename uses the version prepack wrote.
  // package.json embeds the path to bun, so its size differs between machines.
  expect(out.split("\n")).toEqual([
    "bun pack <version> (<revision>)",
    "",
    expect.stringMatching(/^packed \S+ package\.json$/),
    "packed 20B index.js",
    "packed 197B update-version.js",
    "",
    "pack-version-update-2.0.0-snapshot.test.tgz",
    "",
    "Total files: 3",
    "Shasum: <shasum>",
    "Integrity: <integrity>",
    expect.stringMatching(/^Unpacked size: /),
    "Packed size: <packed size>",
  ]);
  expect(exitCode).toBe(0);

  expect(await sortedNames(dir)).toEqual([
    "index.js",
    "pack-version-update-2.0.0-snapshot.test.tgz",
    "package.json",
    "update-version.js",
  ]);
  const tarball = readTarball(join(dir, "pack-version-update-2.0.0-snapshot.test.tgz"));
  expect(entryNames(tarball)).toEqual(["package/package.json", "package/index.js", "package/update-version.js"]);
  expect(JSON.parse(tarball.entries[0].contents)).toEqual({
    name: "pack-version-update",
    version: "2.0.0-snapshot.test",
    scripts: {
      prepack: `${bunExe()} update-version.js`,
    },
  });
});

describe.concurrent("package.json that cannot be loaded", () => {
  test("unparsable package.json", async () => {
    using dir = tempDir("pack-unparsable-package-json", {
      "package.json": `{ "name": "pack-unparsable", "version": "1.0.0",`,
    });

    const { err } = await packExpectError(String(dir));
    // the parser's own diagnostic is printed along with the error
    expect(err).toMatch(/at .*package\.json:1:\d+/);
    expect(err).toMatch(/^ParserError: failed to parse package\.json: .*package\.json$/m);
  });

  test("prepack script removes package.json before it is re-read", async () => {
    using dir = tempDir("pack-prepack-removes-package-json", {
      "package.json": JSON.stringify({
        name: "pack-prepack-removes",
        version: "1.0.0",
        scripts: { prepack: `${bunExe()} remove.js` },
      }),
      "remove.js": `require("fs").unlinkSync("package.json");`,
    });

    const { err } = await packExpectError(String(dir));
    expect(err).toMatch(/^ENOENT: failed to read package\.json: .*package\.json$/m);
    expect(await exists(join(String(dir), "pack-prepack-removes-1.0.0.tgz"))).toBeFalse();
  });

  test("prepack script leaves package.json unparsable before it is re-read", async () => {
    using dir = tempDir("pack-prepack-breaks-package-json", {
      "package.json": JSON.stringify({
        name: "pack-prepack-breaks",
        version: "1.0.0",
        scripts: { prepack: `${bunExe()} break.js` },
      }),
      "break.js": `require("fs").writeFileSync("package.json", "{ broken\\n");`,
    });

    const { err } = await packExpectError(String(dir));
    expect(err).toMatch(/at .*package\.json:1:\d+/);
    expect(err).toMatch(/^ParserError: failed to parse package\.json: .*package\.json$/m);
    expect(await exists(join(String(dir), "pack-prepack-breaks-1.0.0.tgz"))).toBeFalse();
  });
});

describe.concurrent("bundledDependencies", () => {
  test.each(["bundledDependencies", "bundleDependencies"])("basic (%s)", async bundledDependencies => {
    using dir = tempDir("pack-bundled", {
      "package.json": JSON.stringify({
        name: "pack-bundled",
        version: "4.4.4",
        dependencies: {
          "dep1": "1.1.1",
        },
        [bundledDependencies]: ["dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({ name: "dep1", version: "1.1.1" }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out.split("\n")).toEqual([
      "bun pack <version> (<revision>)",
      "",
      expect.stringMatching(/^packed \d+B package\.json$/),
      "bundled dep1",
      "",
      "pack-bundled-4.4.4.tgz",
      "",
      "Total files: 2",
      "Shasum: <shasum>",
      "Integrity: <integrity>",
      expect.stringMatching(/^Unpacked size: \d+B$/),
      "Packed size: <packed size>",
      "Bundled deps: 1",
    ]);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-4.4.4.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/package.json",
    ]);
  });

  test("basic (bundledDependencies: true)", async () => {
    using dir = tempDir("pack-bundled-true", {
      "package.json": JSON.stringify({
        name: "pack-bundled",
        version: "4.4.4",
        dependencies: {
          "dep1": "1.1.1",
        },
        devDependencies: {
          "dep2": "1.1.1",
        },
        bundledDependencies: true,
      }),
      "node_modules/dep1/package.json": JSON.stringify({ name: "dep1", version: "1.1.1" }),
      "node_modules/dep2/package.json": JSON.stringify({ name: "dep2", version: "1.1.1" }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 174B package.json
      bundled dep1

      pack-bundled-4.4.4.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 207B
      Packed size: <packed size>
      Bundled deps: 1"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-4.4.4.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/package.json",
    ]);
  });

  test("scoped bundledDependencies", async () => {
    using dir = tempDir("pack-bundled-scoped", {
      "package.json": JSON.stringify({
        name: "pack-bundled",
        version: "4.4.4",
        dependencies: {
          "@oven/bun": "1.1.1",
        },
        bundledDependencies: ["@oven/bun"],
      }),
      "node_modules/@oven/bun/package.json": JSON.stringify({ name: "@oven/bun", version: "1.1.1" }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 140B package.json
      bundled @oven/bun

      pack-bundled-4.4.4.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 178B
      Packed size: <packed size>
      Bundled deps: 1"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-4.4.4.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/@oven/bun/package.json",
    ]);
  });

  test("invalid bundledDependencies value should throw", async () => {
    using dir = tempDir("pack-bundled-invalid", {
      "package.json": JSON.stringify({
        name: "pack-bundled",
        version: "4.4.4",
        bundledDependencies: "a",
      }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toMatchInlineSnapshot(
      `"error: expected \`bundledDependencies\` to be a boolean or an array of strings"`,
    );
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["package.json"]);
  });

  test("resolve dep of bundled dep", async () => {
    // A bundled dep can have its dependencies resolved without adding them to
    // `bundledDependencies`. Only the bundled deps are included, the other files
    // in node_modules are excluded.
    using dir = tempDir("pack-resolved-bundled-dep", {
      "package.json": JSON.stringify({
        name: "pack-resolved-bundled-dep",
        version: "5.5.5",
        dependencies: {
          dep1: "1.1.1",
        },
        bundledDependencies: ["dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({
        name: "dep1",
        version: "1.1.1",
        dependencies: {
          dep2: "2.2.2",
          dep3: "3.3.3",
        },
      }),
      "node_modules/dep2/package.json": JSON.stringify({ name: "dep2", version: "2.2.2" }),
      "node_modules/dep1/node_modules/excluded.txt": "do not add to tarball!",
      "node_modules/dep1/node_modules/dep3/package.json": JSON.stringify({ name: "dep3", version: "3.3.3" }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 143B package.json
      bundled dep1
      bundled dep3
      bundled dep2

      pack-resolved-bundled-dep-5.5.5.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 289B
      Packed size: <packed size>
      Bundled deps: 3"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-resolved-bundled-dep-5.5.5.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/node_modules/dep3/package.json",
      "package/node_modules/dep1/package.json",
      "package/node_modules/dep2/package.json",
    ]);
  });

  test("scoped names", async () => {
    using dir = tempDir("pack-resolve-scoped", {
      "package.json": JSON.stringify({
        name: "pack-resolve-scoped",
        version: "6.6.6",
        dependencies: {
          "@scoped/dep1": "1.1.1",
        },
        bundledDependencies: ["@scoped/dep1"],
      }),
      "node_modules/@scoped/dep1/package.json": JSON.stringify({
        name: "@scoped/dep1",
        version: "1.1.1",
        dependencies: {
          "@scoped/dep2": "2.2.2",
          "@scoped/dep3": "3.3.3",
        },
      }),
      "node_modules/@scoped/dep2/package.json": JSON.stringify({ name: "@scoped/dep2", version: "2.2.2" }),
      "node_modules/@scoped/dep1/node_modules/@scoped/dep3/package.json": JSON.stringify({
        name: "@scoped/dep3",
        version: "3.3.3",
      }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 153B package.json
      bundled @scoped/dep1
      bundled @scoped/dep3
      bundled @scoped/dep2

      pack-resolve-scoped-6.6.6.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 339B
      Packed size: <packed size>
      Bundled deps: 3"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-resolve-scoped-6.6.6.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/@scoped/dep1/node_modules/@scoped/dep3/package.json",
      "package/node_modules/@scoped/dep1/package.json",
      "package/node_modules/@scoped/dep2/package.json",
    ]);
  });

  test("scoped names match on scope and name together", async () => {
    // `bundled` exists unscoped, in @scope and in @other; only the first two are bundled.
    // @scope/not-bundled shares its scope directory with a bundled dep.
    const packages = ["bundled", "@scope/bundled", "@scope/not-bundled", "@other/bundled"];
    using dir = tempDir("pack-bundled-same-name-across-scopes", {
      "package.json": JSON.stringify({
        name: "pack-bundled-same-name-across-scopes",
        version: "1.0.0",
        dependencies: Object.fromEntries(packages.map(name => [name, "1.0.0"])),
        bundledDependencies: ["@scope/bundled", "bundled"],
      }),
      ...Object.fromEntries(
        packages.map(name => [`node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0" })]),
      ),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 275B package.json
      bundled @scope/bundled
      bundled bundled

      pack-bundled-same-name-across-scopes-1.0.0.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 354B
      Packed size: <packed size>
      Bundled deps: 2"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-same-name-across-scopes-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/@scope/bundled/package.json",
      "package/node_modules/bundled/package.json",
    ]);
  });

  test("ignore deps that aren't directories", async () => {
    using dir = tempDir("pack-bundled-dep-not-dir", {
      "package.json": JSON.stringify({
        name: "pack-bundled-dep-not-dir",
        version: "4.5.6",
        dependencies: {
          dep1: "1.1.1",
        },
      }),
      "node_modules/dep1": "hi. this is a file, not a directory",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 107B package.json

      pack-bundled-dep-not-dir-4.5.6.tgz

      Total files: 1
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 107B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-dep-not-dir-4.5.6.tgz"))).toEqual(["package/package.json"]);
  });

  // No key is `name` or `@scope/name`. Without the check, each of the first eight opens a directory that exists. `\` is
  // only a separator on Windows, and a NUL ends the path that the OS gets.
  test.each([
    "../../outside",
    "other/lib",
    "",
    ".",
    "..",
    "@scope",
    ".bin",
    "@scope/.hidden",
    "..\\..\\outside",
    "x\\..\\..\\..\\outside",
    "other\\lib",
    "other\u0000x",
    "C:/Users/Public",
  ])("a dependency key of a bundled dependency that is not a package name is not looked up: %j", async key => {
    using dir = tempDir("pack-bundled-dep-key", {
      "outside/secret.txt": "not in the package",
      "pkg/package.json": JSON.stringify({
        name: "pack-bundled-dep-key",
        version: "1.0.0",
        bundledDependencies: ["dep1"],
      }),
      "pkg/node_modules/dep1/package.json": JSON.stringify({
        name: "dep1",
        version: "1.0.0",
        dependencies: { [key]: "1.0.0" },
      }),
      "pkg/node_modules/other/lib/index.js": indexJs,
      "pkg/node_modules/@scope/.hidden/index.js": indexJs,
      "pkg/node_modules/.bin/tool": "#!/usr/bin/env bun\n",
    });
    const pkg = join(dir, "pkg");

    const { out, err, exitCode } = await runPack(pkg);
    expect(err).toBe("");
    expect(out.split("\n").filter(line => line.startsWith("bundled "))).toEqual(["bundled dep1"]);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(pkg, "pack-bundled-dep-key-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/package.json",
    ]);
  });

  test("a dependency key of a bundled dependency can have capital letters", async () => {
    using dir = tempDir("pack-bundled-dep-capitals", {
      "package.json": JSON.stringify({
        name: "pack-bundled-dep-capitals",
        version: "1.0.0",
        bundledDependencies: ["dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({
        name: "dep1",
        version: "1.0.0",
        dependencies: { JSONStream: "1.3.5", "@Scope/Name": "1.0.0" },
      }),
      "node_modules/JSONStream/package.json": JSON.stringify({ name: "JSONStream", version: "1.3.5" }),
      "node_modules/@Scope/Name/package.json": JSON.stringify({ name: "@Scope/Name", version: "1.0.0" }),
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-dep-capitals-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/@Scope/Name/package.json",
      "package/node_modules/JSONStream/package.json",
      "package/node_modules/dep1/package.json",
    ]);
  });

  // A lockfile is only left out of the project's own root.
  test.each(["x-node_modules-y", "@node_modules/x"])(
    'the dependency of a bundled dependency named "%s" is packed whole',
    async host => {
      using dir = tempDir("pack-bundled-dep-name", {
        "package.json": JSON.stringify({
          name: "pack-bundled-dep-name",
          version: "1.0.0",
          bundledDependencies: [host],
        }),
        [`node_modules/${host}/package.json`]: JSON.stringify({
          name: host,
          version: "1.0.0",
          dependencies: { dep: "1.0.0" },
        }),
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "node_modules/dep/fixtures/yarn.lock": "# a fixture of dep\n",
      });

      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(exitCode).toBe(0);

      expect(tarballEntries(join(dir, "pack-bundled-dep-name-1.0.0.tgz")).sort()).toEqual(
        [
          "package/package.json",
          `package/node_modules/${host}/package.json`,
          "package/node_modules/dep/fixtures/yarn.lock",
          "package/node_modules/dep/package.json",
        ].sort(),
      );
    },
  );

  // The tarball's package.json keeps the field, so whoever installs the tarball doesn't install the package.
  test.each([{ args: [] }, { args: ["--dry-run"] }])(
    "a bundled dependency that is not installed is an error (args: $args)",
    async ({ args }) => {
      using dir = tempDir("pack-bundled-missing", {
        "package.json": JSON.stringify({
          name: "pack-bundled-missing",
          version: "1.0.0",
          dependencies: { dep1: "1.0.0", dep2: "1.0.0" },
          bundledDependencies: ["dep1", "dep2"],
        }),
        "node_modules/dep1/package.json": JSON.stringify({ name: "dep1", version: "1.0.0" }),
      });

      const { out, err, exitCode } = await runPack(dir, args);
      expect(err).toBe('error: bundled dependency "dep2" is not installed');
      expect(out).toBe("bun pack <version> (<revision>)");
      expect(exitCode).toBe(1);
      expect(await sortedNames(dir)).toEqual(["node_modules", "package.json"]);
    },
  );

  // Packages that an install may skip, such as an optional dependency for another platform. npm and pnpm do the same.
  test.each([
    ["an optional dependency", { optionalDependencies: { absent: "1.0.0" } }],
    [
      "an optional dependency that is in dependencies too",
      { dependencies: { dep1: "1.0.0", absent: "1.0.0" }, optionalDependencies: { absent: "1.0.0" } },
    ],
    ["a peer", { peerDependencies: { absent: "*" } }],
    ["an optional peer", { peerDependencies: { absent: "*" }, peerDependenciesMeta: { absent: { optional: true } } }],
    ["a devDependency", { devDependencies: { absent: "1.0.0" } }],
    ["a name in no group", {}],
  ])("a bundled dependency that is not installed is left out: %s", async (_, groups) => {
    using dir = tempDir("pack-bundled-absent", {
      "package.json": JSON.stringify({
        name: "pack-bundled-absent",
        version: "1.0.0",
        dependencies: { dep1: "1.0.0" },
        ...groups,
        bundledDependencies: ["absent", "dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({ name: "dep1", version: "1.0.0" }),
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out.split("\n").filter(line => line.startsWith("bundled "))).toEqual(["bundled dep1"]);
    expect(tarballEntries(join(dir, "pack-bundled-absent-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/package.json",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a workspace bundles packages from the node_modules of the workspace root", async () => {
    using dir = tempDir("pack-bundled-hoisted-workspace", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        dependencies: { x: "1.0.0", "@s/x": "1.0.0" },
        bundledDependencies: ["x", "@s/x"],
      }),
      "node_modules/x/package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { y: "^1.0.0" } }),
      "node_modules/@s/x/package.json": JSON.stringify({ name: "@s/x", version: "1.0.0" }),
      "node_modules/y/package.json": JSON.stringify({ name: "y", version: "1.0.0", dependencies: { z: "^1.0.0" } }),
      "node_modules/z/package.json": JSON.stringify({ name: "z", version: "1.0.0" }),
      "node_modules/not-bundled/package.json": JSON.stringify({ name: "not-bundled", version: "1.0.0" }),
    });
    const lib = join(dir, "packages", "lib");

    const { out, err, exitCode } = await runPack(lib);
    expect(err).toBe("");
    expect(out.split("\n").filter(line => line.startsWith("bundled "))).toEqual([
      "bundled x",
      "bundled @s/x",
      "bundled y",
      "bundled z",
    ]);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(lib, "lib-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/@s/x/package.json",
      "package/node_modules/x/package.json",
      "package/node_modules/y/package.json",
      "package/node_modules/z/package.json",
    ]);
  });

  // The isolated linker's layout: node_modules has links into a store, where a package's dependencies are links next to
  // it. `y` goes next to `x`, unless the packed package has its own `y` that it doesn't bundle.
  test.skipIf(isWindows).each([
    { name: "x", own: {}, y: "node_modules/y" },
    { name: "@s/x", own: {}, y: "node_modules/y" },
    { name: "x", own: { y: "2.0.0" }, y: "node_modules/x/node_modules/y" },
    { name: "@s/x", own: { y: "2.0.0" }, y: "node_modules/@s/x/node_modules/y" },
  ])("$name is a link into a store, and its dependency goes to $y", async ({ name, own, y }) => {
    const entry = `node_modules/.bun/${name.replace("/", "+")}@1.0.0/node_modules`;
    using dir = tempDir("pack-bundled-store", {
      "package.json": JSON.stringify({
        name: "pack-bundled-store",
        version: "1.0.0",
        dependencies: { [name]: "1.0.0" },
        devDependencies: own,
        bundledDependencies: [name],
      }),
      "node_modules/@s": {},
      [`${entry}/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", dependencies: { y: "^1.0.0" } }),
      [`${entry}/${name}/index.js`]: indexJs,
      "node_modules/.bun/y@1.0.0/node_modules/y/package.json": JSON.stringify({ name: "y", version: "1.0.0" }),
      "node_modules/.bun/y@2.0.0/node_modules/y/package.json": JSON.stringify({ name: "y", version: "2.0.0" }),
    });
    await symlink(join(dir, entry, name), join(dir, "node_modules", name));
    await symlink(join(dir, "node_modules/.bun/y@1.0.0/node_modules/y"), join(dir, entry, "y"));
    if ("y" in own)
      await symlink(join(dir, "node_modules/.bun/y@2.0.0/node_modules/y"), join(dir, "node_modules", "y"));

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-bundled-store-1.0.0.tgz"));
    expect(entryNames(tarball).sort()).toEqual(
      [
        "package/package.json",
        `package/node_modules/${name}/index.js`,
        `package/node_modules/${name}/package.json`,
        `package/${y}/package.json`,
      ].sort(),
    );
    const packed = tarball.entries.find(entry => entry.pathname === `package/${y}/package.json`);
    expect(JSON.parse(packed!.contents)).toEqual({ name: "y", version: "1.0.0" });
  });

  // Like npm: a link to a folder that is no installed copy is packed by that folder's own rules.
  test.skipIf(isWindows).each([
    ["", "project"],
    [", also below a folder named node_modules", "node_modules/project"],
  ])("a bundled workspace is packed with its own files and .npmignore%s", async (_, project) => {
    using parent = tempDir("pack-bundled-sibling", {
      [project]: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          dependencies: { util: "workspace:*", other: "workspace:*" },
          bundledDependencies: ["util", "other"],
        }),
        "packages/util/package.json": JSON.stringify({
          name: "util",
          version: "1.0.0",
          files: ["dist"],
          // `lib` is not packed into itself.
          dependencies: { lib: "workspace:*", y: "1.0.0" },
        }),
        "packages/util/dist/index.js": indexJs,
        "packages/util/src/index.ts": indexJs,
        "packages/util/node_modules/y/package.json": JSON.stringify({ name: "y", version: "1.0.0" }),
        "packages/other/package.json": JSON.stringify({ name: "other", version: "1.0.0" }),
        "packages/other/index.js": indexJs,
        "packages/other/test/index.js": indexJs,
        "packages/other/.npmignore": "test\n",
        "node_modules": {},
      },
    });
    const dir = join(String(parent), project);
    for (const name of ["lib", "util", "other"]) {
      await symlink(join("..", "packages", name), join(dir, "node_modules", name));
    }
    const lib = join(dir, "packages", "lib");

    const { err, exitCode } = await runPack(lib);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(lib, "lib-1.0.0.tgz"));
    expect(entryNames(tarball)).toEqual([
      "package/package.json",
      "package/node_modules/other/index.js",
      "package/node_modules/other/package.json",
      "package/node_modules/util/dist/index.js",
      "package/node_modules/util/node_modules/y/package.json",
      "package/node_modules/util/package.json",
    ]);
    // No other package manager reads `workspace:`.
    expect(JSON.parse(tarball.entries.at(-1)!.contents).dependencies).toEqual({ lib: "1.0.0", y: "1.0.0" });
  });

  // The ignore files of a bundled linked folder still apply when the folder's package.json does not load. A folder that
  // has a package.json entry is packed as a package, and a folder that has none as a directory.
  describe("a bundled linked folder whose package.json does not load", () => {
    const notJson = '{ "name": "other", oops';

    // A package that bundles `name`, which is a link to the folder `vendor/other`. `link` is the target of a link at
    // the folder's package.json.
    async function bundlesLinkedFolder(folder: DirectoryTree, name = "other", link?: string) {
      const dir = tempDir("pack-bundled-linked", {
        "package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          files: ["index.js"],
          dependencies: { [name]: "1.0.0" },
          bundledDependencies: [name],
        }),
        "index.js": indexJs,
        "vendor/other": folder,
        "vendor/not.json": notJson,
        "node_modules/@s": {},
      });
      if (link) await symlink(link, join(dir, "vendor", "other", "package.json"), "file");
      // A junction on Windows. Elsewhere, "junction" is ignored and a plain symlink is created.
      await symlink(join(dir, "vendor", "other"), join(dir, "node_modules", name), "junction");
      return dir;
    }

    // The paths, inside the bundled package `name`, of its files in the tarball.
    async function bundledFiles(dir: string, name = "other") {
      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(exitCode).toBe(0);
      const prefix = `package/node_modules/${name}/`;
      return tarballEntries(join(dir, "lib-1.0.0.tgz"))
        .filter(entry => entry.startsWith(prefix))
        .map(entry => entry.slice(prefix.length));
    }

    // The ignore file names a file at every depth, a directory of the folder only, and two documents. README and
    // LICENSE are always in a package, and the lockfiles of its root never are. In a directory they are files like any
    // other.
    const folder = {
      "index.js": indexJs,
      "secret.txt": "secret",
      "lib/secret.txt": "secret",
      "build/out.js": indexJs,
      "lib/build/out.js": indexJs,
      "README.md": "# other",
      "LICENSE": "MIT",
      "package-lock.json": "{}",
      "yarn.lock": "",
      ".npmignore": "secret.txt\n/build\nREADME.md\nLICENSE\n",
    };
    const asPackage = ["LICENSE", "README.md", "index.js", "lib/build/out.js"];
    const asDirectory = ["index.js", "lib/build/out.js", "package-lock.json", "yarn.lock"];

    // Every list is what `npm pack` 11.16.0 packs for the same folder.
    test.each([
      { state: "is missing", name: "other", expected: asDirectory },
      { state: "is missing", name: "@s/other", expected: asDirectory },
      { state: "is a dangling link", name: "other", link: "nowhere.json", expected: asPackage },
      { state: "is a link to itself", name: "other", link: "package.json", expected: asPackage },
      {
        state: "is a directory",
        name: "other",
        manifest: { "inner.js": indexJs },
        expected: [...asPackage, "package.json/inner.js"],
      },
      // The file is packed as it is.
      { state: "does not parse", name: "other", manifest: notJson, expected: [...asPackage, "package.json"] },
      { state: "is a link to a file that does not parse", name: "other", link: "../not.json", expected: asPackage },
    ])("package.json $state, bundled as $name", async ({ name, manifest, link, expected }) => {
      const tree = manifest === undefined ? folder : { ...folder, "package.json": manifest };
      using dir = await bundlesLinkedFolder(tree, name, link);

      expect(await bundledFiles(dir, name)).toEqual(expected);
    });

    const sources = {
      "index.js": indexJs,
      "secret.txt": "secret",
      "lib/a.js": indexJs,
      "lib/secret.txt": "secret",
      "build/out.js": indexJs,
      "lib/build/out.js": indexJs,
    };
    const ignored = { ".npmignore": "secret.txt\n/build\n" };
    const kept = ["index.js", "lib/a.js", "lib/build/out.js"];
    const whole = Object.keys(sources).sort();

    // Every list is what `npm pack` 11.16.0 packs for the same folder.
    test.each([
      { what: "only a .gitignore", ignores: { ".gitignore": ignored[".npmignore"] }, expected: kept },
      {
        what: "an .npmignore beside a .gitignore",
        ignores: { ...ignored, ".gitignore": "index.js\n" },
        expected: kept,
      },
      {
        what: "an .npmignore in a subdirectory",
        ignores: { "lib/.npmignore": ignored[".npmignore"] },
        expected: ["build/out.js", "index.js", "lib/a.js", "secret.txt"],
      },
      {
        what: "a negated pattern",
        ignores: { ".npmignore": "secret.txt\n!lib/secret.txt\n" },
        expected: ["build/out.js", "index.js", "lib/a.js", "lib/build/out.js", "lib/secret.txt"],
      },
      // A folder of build output can have such a file. Nothing of the folder is packed then.
      { what: "a .gitignore that names every file", ignores: { ".gitignore": "*\n" }, expected: [] },
      // An .npmignore, also an empty one, is read in place of the .gitignore.
      {
        what: "an empty .npmignore beside a .gitignore that names every file",
        ignores: { ".gitignore": "*\n", ".npmignore": "" },
        expected: whole,
      },
    ])("no package.json and $what", async ({ ignores, expected }) => {
      using dir = await bundlesLinkedFolder({ ...sources, ...ignores });

      expect(await bundledFiles(dir)).toEqual(expected);
    });

    // Unlike npm, which packs it. The packages in the node_modules of a bundled package are packed as its dependencies.
    test("no package.json: the folder's own node_modules is not packed", async () => {
      using dir = await bundlesLinkedFolder({
        "index.js": indexJs,
        "node_modules/y/package.json": JSON.stringify({ name: "y", version: "1.0.0" }),
      });

      expect(await bundledFiles(dir)).toEqual(["index.js"]);
    });

    // The patterns of the ignore file are anchored at the folder, at every depth in the tarball.
    test("no package.json, as the dependency of a bundled linked folder and of an installed package", async () => {
      const inner = { ...sources, ...ignored };
      using dir = tempDir("pack-bundled-linked-transitive", {
        "package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          files: ["index.js"],
          dependencies: { host: "1.0.0", installed: "1.0.0" },
          bundledDependencies: true,
        }),
        "index.js": indexJs,
        "vendor/host/package.json": JSON.stringify({
          name: "host",
          version: "1.0.0",
          dependencies: { nested: "1.0.0" },
        }),
        "vendor/host/node_modules": {},
        "vendor/nested": inner,
        "vendor/hoisted": inner,
        "node_modules/installed/package.json": JSON.stringify({
          name: "installed",
          version: "1.0.0",
          dependencies: { hoisted: "1.0.0" },
        }),
      });
      // Junctions on Windows, plain symlinks elsewhere.
      await symlink(join(dir, "vendor", "host"), join(dir, "node_modules", "host"), "junction");
      await symlink(join(dir, "vendor", "nested"), join(dir, "vendor", "host", "node_modules", "nested"), "junction");
      await symlink(join(dir, "vendor", "hoisted"), join(dir, "node_modules", "hoisted"), "junction");

      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(exitCode).toBe(0);

      expect(tarballEntries(join(dir, "lib-1.0.0.tgz"))).toEqual([
        "package/package.json",
        "package/index.js",
        ...kept.map(file => `package/node_modules/hoisted/${file}`),
        ...kept.map(file => `package/node_modules/host/node_modules/nested/${file}`),
        "package/node_modules/host/package.json",
        "package/node_modules/installed/package.json",
      ]);
    });

    test.each(["pm pack --dry-run", "publish --dry-run"])("no package.json: bun %s", async command => {
      using dir = await bundlesLinkedFolder({ ...sources, ...ignored });

      await using proc = spawn({
        cmd: [bunExe(), ...command.split(" ")],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        // `bun publish` stops early when it has no credentials. Nothing listens on port 1.
        env: { ...bunEnv, npm_config_registry: "http://user:password@127.0.0.1:1/" },
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toBe("");
      // package.json, index.js, and the three files of the folder
      expect(out).toContain("\nTotal files: 5\n");
      expect(exitCode).toBe(0);
    });

    // `bun install` makes the link for a `link:` folder, which needs no package.json.
    test.each([
      { spec: "link:./vendor/other", folder: "app/vendor/other", expected: kept },
      { spec: "link:../other", folder: "other", expected: kept },
      // The real path of these two has a `node_modules` component, so each is taken for an installed copy, which is
      // packed whole. npm packs them by their ignore file.
      { spec: "link:./packages/node_modules/other", folder: "app/packages/node_modules/other", expected: whole },
      { spec: "link:../node_modules/ws/other", folder: "node_modules/ws/other", expected: whole },
    ])("no package.json, linked by bun install as $spec", async ({ spec, folder, expected }) => {
      using dir = tempDir("pack-bundled-link-protocol", {
        "app/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          files: ["index.js"],
          dependencies: { other: spec },
          bundledDependencies: ["other"],
        }),
        "app/index.js": indexJs,
        [folder]: { ...sources, ...ignored },
      });
      const app = join(dir, "app");
      await runBunInstall(bunEnv, app);

      expect(await bundledFiles(app)).toEqual(expected);
    });

    // The files that it would have named must not be packed.
    test("no package.json, and an .npmignore that can't be read stops the pack", async () => {
      using dir = await bundlesLinkedFolder({ ...sources, ".npmignore": {} });

      const { err, exitCode } = await runPack(dir);
      expect(err).toBe('EISDIR: failed to read .npmignore at: "<dir>/vendor/other/.npmignore"');
      expect(exitCode).toBe(1);
      expect(await sortedNames(dir)).toEqual(["index.js", "node_modules", "package.json", "vendor"]);
    });
  });

  // A copy below `node_modules`, for example of a `file:` folder, is packed whole in every state of its package.json.
  // No ignore file in it is read.
  test.each([
    { state: "loads", manifest: JSON.stringify({ name: "dep", version: "1.0.0" }) },
    { state: "is missing", manifest: undefined },
  ])("an installed package whose package.json $state is packed whole", async ({ manifest }) => {
    using dir = tempDir("pack-bundled-installed-ignore", {
      "package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        dependencies: { dep: "1.0.0" },
        bundledDependencies: ["dep"],
      }),
      ...(manifest === undefined ? {} : { "node_modules/dep/package.json": manifest }),
      "node_modules/dep/secret.txt": "secret",
      "node_modules/dep/.npmignore": "secret.txt\n",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "lib-1.0.0.tgz"))).toEqual([
      "package/package.json",
      ...(manifest === undefined ? [] : ["package/node_modules/dep/package.json"]),
      "package/node_modules/dep/secret.txt",
    ]);
  });

  test.each([
    ["does not parse", '{ "name": "fixture", oops'],
    ["has the same name", JSON.stringify({ name: "app", version: "9.0.0" })],
  ])("installed packages are bundled beside a workspace that %s", async (_, sibling) => {
    using dir = tempDir("pack-bundled-beside", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { dep: "1.0.0" },
        bundledDependencies: ["dep"],
      }),
      "packages/app/node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "packages/fixture/package.json": sibling,
    });
    const app = join(dir, "packages", "app");

    const { err, exitCode } = await runPack(app);
    expect(err).toBe("");
    expect(tarballEntries(join(app, "app-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep/package.json",
    ]);
    expect(exitCode).toBe(0);
  });

  describe("a node_modules above the project is not the project's", () => {
    const above = { "node_modules/above/package.json": JSON.stringify({ name: "above", version: "1.0.0" }) };

    test("for a bundled dependency", async () => {
      using dir = tempDir("pack-bundled-above", {
        ...above,
        "project/package.json": JSON.stringify({
          name: "project",
          version: "1.0.0",
          dependencies: { above: "1.0.0" },
          bundledDependencies: ["above"],
        }),
      });

      const { err, exitCode } = await runPack(join(dir, "project"));
      expect(err).toBe('error: bundled dependency "above" is not installed');
      expect(await sortedNames(join(dir, "project"))).toEqual(["package.json"]);
      expect(exitCode).toBe(1);
    });

    test("for the dependencies of a bundled dependency", async () => {
      using dir = tempDir("pack-bundled-above-nested", {
        ...above,
        "project/package.json": JSON.stringify({
          name: "project",
          version: "1.0.0",
          dependencies: { dep: "1.0.0" },
          bundledDependencies: ["dep"],
        }),
        "project/node_modules/dep/package.json": JSON.stringify({
          name: "dep",
          version: "1.0.0",
          optionalDependencies: { above: "1.0.0" },
        }),
      });

      const { err, exitCode } = await runPack(join(dir, "project"));
      expect(err).toBe("");
      expect(tarballEntries(join(dir, "project", "project-1.0.0.tgz"))).toEqual([
        "package/package.json",
        "package/node_modules/dep/package.json",
      ]);
      expect(exitCode).toBe(0);
    });
  });

  // The layout of pnpm and of the isolated linker: each package is next to links to its dependencies.
  describe.skipIf(isWindows)("two versions of two packages that depend on each other", () => {
    async function packLinked(graph: Record<string, Record<string, string>>) {
      const tree: Record<string, string> = {
        "package.json": JSON.stringify({
          name: "pack-bundled-ring",
          version: "1.0.0",
          dependencies: { a: "1.0.0" },
          bundledDependencies: ["a"],
        }),
      };
      for (const [id, dependencies] of Object.entries(graph)) {
        const [name, version] = id.split("@");
        tree[`node_modules/.store/${id}/node_modules/${name}/package.json`] = JSON.stringify({
          name,
          version,
          dependencies,
        });
      }
      using dir = tempDir("pack-bundled-ring", tree);
      for (const [id, dependencies] of Object.entries(graph)) {
        for (const [name, version] of Object.entries(dependencies)) {
          await symlink(
            join("..", "..", `${name}@${version}`, "node_modules", name),
            join(dir, "node_modules", ".store", id, "node_modules", name),
          );
        }
      }
      await symlink(join(".store", "a@1.0.0", "node_modules", "a"), join(dir, "node_modules", "a"));

      await using proc = spawn({
        cmd: [bunExe(), "pm", "pack", "--dry-run"],
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: bunEnv,
        timeout: 5_000,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { bundled: out.split("\n").filter(line => line.startsWith("bundled ")).length, err, exitCode };
    }

    const chain = { "a@1.0.0": { b: "1.0.0" }, "b@1.0.0": { a: "2.0.0" }, "a@2.0.0": { b: "2.0.0" } };

    test("in a chain", async () => {
      expect(await packLinked({ ...chain, "b@2.0.0": {} })).toEqual({ bundled: 4, err: "", exitCode: 0 });
    });

    test("in a cycle, which no node_modules layout can represent", async () => {
      const { err, exitCode } = await packLinked({ ...chain, "b@2.0.0": { a: "1.0.0" } });
      expect(err).toStartWith("error: bundled dependencies form a cycle: ");
      expect(exitCode).toBe(1);
    });
  });

  test("a missing dependency of a bundled dependency is skipped", async () => {
    using dir = tempDir("pack-bundled-dep-absent", {
      "package.json": JSON.stringify({
        name: "pack-bundled-dep-absent",
        version: "1.0.0",
        bundledDependencies: ["dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({
        name: "dep1",
        version: "1.0.0",
        dependencies: {
          "never-installed": "1.0.0",
          "a-file": "1.0.0",
          // longer than a directory entry can be
          [Buffer.alloc(300, "a").toString()]: "1.0.0",
        },
      }),
      "node_modules/dep1/node_modules/a-file": "not a directory",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-dep-absent-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/package.json",
    ]);
  });

  test.skipIf(isWindows)("bundled dependencies that link to each other end the lookup", async () => {
    using dir = tempDir("pack-bundled-dep-cycle", {
      "package.json": JSON.stringify({
        name: "pack-bundled-dep-cycle",
        version: "1.0.0",
        bundledDependencies: ["dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({
        name: "dep1",
        version: "1.0.0",
        dependencies: { dep2: "1.0.0" },
      }),
      "node_modules/dep1/node_modules": {},
      "node_modules/dep2/package.json": JSON.stringify({
        name: "dep2",
        version: "1.0.0",
        dependencies: { dep1: "1.0.0" },
      }),
      "node_modules/dep2/node_modules": {},
    });
    await symlink("../../dep2", join(dir, "node_modules", "dep1", "node_modules", "dep2"));
    await symlink("../../dep1", join(dir, "node_modules", "dep2", "node_modules", "dep1"));

    // From where `dep2` is in the tarball, `dep1` is found further up: it is not packed again.
    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-dep-cycle-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/dep1/node_modules/dep2/package.json",
      "package/node_modules/dep1/package.json",
    ]);
  });

  // This is what `bun install` creates for a workspace that's a dependency.
  test.skipIf(isWindows)("a scoped bundled dependency that is a link is followed", async () => {
    using dir = tempDir("pack-bundled-dep-scoped-link", {
      "package.json": JSON.stringify({
        name: "pack-bundled-dep-scoped-link",
        version: "1.0.0",
        bundledDependencies: ["@acme/core"],
      }),
      "node_modules/@acme": {},
      "packages/core/package.json": JSON.stringify({ name: "@acme/core", version: "1.0.0" }),
      ".npmignore": "packages",
    });
    await symlink("../../packages/core", join(dir, "node_modules", "@acme", "core"));

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bundled-dep-scoped-link-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/@acme/core/package.json",
    ]);
  });

  // The lookup used to keep every directory it found open.
  test.skipIf(isWindows)("more dependencies than file descriptors", async () => {
    const names = Array.from({ length: 299 }, (_, i) => `d${i}`);
    using dir = tempDir("pack-bundled-dep-emfile", {
      "package.json": JSON.stringify({
        name: "pack-bundled-dep-emfile",
        version: "1.0.0",
        bundledDependencies: ["dep1"],
      }),
      "node_modules/dep1/package.json": JSON.stringify({
        name: "dep1",
        version: "1.0.0",
        dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
      }),
      ...Object.fromEntries(
        names.map(name => [
          `node_modules/dep1/node_modules/${name}/package.json`,
          JSON.stringify({ name, version: "1.0.0" }),
        ]),
      ),
    });

    await using proc = spawn({
      cmd: ["sh", "-c", 'ulimit -n 200 && exec "$0" pm pack', bunExe()],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(out).toContain("Bundled deps: 300\n");
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(dir, "pack-bundled-dep-emfile-1.0.0.tgz"))).toHaveLength(301);
  });
});

describe.concurrent("files", () => {
  test("CHANGELOG is not included by default", async () => {
    using dir = tempDir("pack-files-changelog", {
      "package.json": JSON.stringify({ name: "pack-files-changelog", version: "1.1.1", files: ["lib"] }),
      "CHANGELOG.md": "hello",
      "lib/index.js": "console.log('hello ./lib/index.js')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 78B package.json
      packed 35B lib/index.js

      pack-files-changelog-1.1.1.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 113B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-changelog-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/lib/index.js",
    ]);
  });

  const defaultIgnoredFiles = {
    "lib/index.js": "console.log('hello ./lib/index.js')",
    ".git/config": "[core]",
    ".npmrc": "registry=https://registry.npmjs.org/",
    ".gitignore": "node_modules",
    "bunfig.toml": "[install]",
    "package-lock.json": "{}",
    ".hg/store": "hg",
    ".svn/entries": "svn",
    "CVS/Root": "cvs",
  };

  test("'files' overrides the overridable default ignores but never .git/.npmrc/lockfiles", async () => {
    using dir = tempDir("pack-files-default-ignores", {
      "package.json": JSON.stringify({
        name: "pack-files-default-ignores",
        version: "1.1.1",
        files: ["lib", ".git", ".npmrc", ".gitignore", "bunfig.toml", "package-lock.json", ".hg", ".svn", "CVS"],
      }),
      ...defaultIgnoredFiles,
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 174B package.json
      packed 12B .gitignore
      packed 2B .hg/store
      packed 3B .svn/entries
      packed 3B CVS/Root
      packed 9B bunfig.toml
      packed 35B lib/index.js

      pack-files-default-ignores-1.1.1.tgz

      Total files: 7
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 238B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-default-ignores-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/.gitignore",
      "package/.hg/store",
      "package/.svn/entries",
      "package/CVS/Root",
      "package/bunfig.toml",
      "package/lib/index.js",
    ]);
  });

  test("non-overridable default ignores are not packed when 'files' matches everything", async () => {
    using dir = tempDir("pack-files-default-ignores-glob", {
      "package.json": JSON.stringify({ name: "pack-files-default-ignores-glob", version: "1.1.1", files: ["**"] }),
      ...defaultIgnoredFiles,
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 88B package.json
      packed 12B .gitignore
      packed 2B .hg/store
      packed 3B .svn/entries
      packed 3B CVS/Root
      packed 9B bunfig.toml
      packed 35B lib/index.js

      pack-files-default-ignores-glob-1.1.1.tgz

      Total files: 7
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 152B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-default-ignores-glob-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/.gitignore",
      "package/.hg/store",
      "package/.svn/entries",
      "package/CVS/Root",
      "package/bunfig.toml",
      "package/lib/index.js",
    ]);
  });

  test(".npmignore cannot exclude CHANGELOG", async () => {
    using dir = tempDir("pack-files-changelog-npmignore", {
      "package.json": JSON.stringify({ name: "pack-files-changelog", version: "1.1.2" }),
      ".npmignore": "CHANGELOG\nCHANGELOG.*",
      "CHANGELOG": "hello",
      "CHANGELOG.md": "hello",
      "CHANGELOG.txt": "hello",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 58B package.json
      packed 5B CHANGELOG
      packed 5B CHANGELOG.md
      packed 5B CHANGELOG.txt

      pack-files-changelog-1.1.2.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 73B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-changelog-1.1.2.tgz"))).toEqual([
      "package/package.json",
      "package/CHANGELOG",
      "package/CHANGELOG.md",
      "package/CHANGELOG.txt",
    ]);
  });

  test("'files' field cannot exclude LICENSE", async () => {
    using dir = tempDir("pack-files-license", {
      "package.json": JSON.stringify({ name: "pack-files-license", version: "1.1.1", files: ["lib", "!LICENSE"] }),
      "LICENSE": "hello",
      "lib/index.js": "console.log('hello ./lib/index.js')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 88B package.json
      packed 5B LICENSE
      packed 35B lib/index.js

      pack-files-license-1.1.1.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 128B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-license-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/LICENSE",
      "package/lib/index.js",
    ]);
  });

  test(".npmignore cannot exclude LICENSE", async () => {
    using dir = tempDir("pack-files-license-npmignore", {
      "package.json": JSON.stringify({ name: "pack-files-license", version: "1.1.2" }),
      ".npmignore": "LICENSE",
      "LICENSE": "hello",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 56B package.json
      packed 5B LICENSE

      pack-files-license-1.1.2.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 61B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-license-1.1.2.tgz"))).toEqual([
      "package/package.json",
      "package/LICENSE",
    ]);
  });

  test("can include files and directories", async () => {
    using dir = tempDir("pack-files-1", {
      "package.json": JSON.stringify({
        name: "pack-files-1",
        version: "1.1.1",
        files: ["root.js", "subdir", "subdir2/subdir"],
      }),
      "root.js": "console.log('hello ./root.js')",
      "subdir/index.js": "console.log('hello ./subdir/index.js')",
      "subdir/anotherdir/index.js": "console.log('hello ./subdir/anotherdir/index.js')",
      "subdir2/subdir/index.js": "console.log('hello ./subdir2/subdir/index.js')",

      // should not be included
      "subdir2/index.js": "console.log('hello, dont include me!')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 102B package.json
      packed 30B root.js
      packed 49B subdir/anotherdir/index.js
      packed 38B subdir/index.js
      packed 46B subdir2/subdir/index.js

      pack-files-1-1.1.1.tgz

      Total files: 5
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 265B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-1-1.1.1.tgz"))).toEqual([
      "package/package.json",
      "package/root.js",
      "package/subdir/anotherdir/index.js",
      "package/subdir/index.js",
      "package/subdir2/subdir/index.js",
    ]);
  });

  test("matches relative to root by default", async () => {
    using dir = tempDir("pack-files-2", {
      "package.json": JSON.stringify({ name: "pack-files-2", version: "1.2.3", files: ["index.js"] }),
      "root.js": "console.log('hello ./root.js')",
      "index.js": indexJs,
      "subdir/index.js": "console.log('hello ./subdir/index.js')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 75B package.json
      packed 31B index.js

      pack-files-2-1.2.3.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 106B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-2-1.2.3.tgz"))).toEqual(["package/package.json", "package/index.js"]);
  });

  test("matches './' as the root", async () => {
    using dir = tempDir("pack-files-3", {
      "package.json": JSON.stringify({
        name: "pack-files-3",
        version: "1.2.3",
        files: ["./dist", "!./subdir", "!./dist/index.js", "./////src//index.ts"],
      }),
      "dist/index.js": "console.log('hello ./dist/index.js')",
      "subdir/index.js": "console.log('hello ./subdir/index.js')",
      "src/dist/index.js": "console.log('hello ./src/dist/index.js')",
      "src/index.ts": "console.log('hello ./src/index.ts')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 129B package.json
      packed 36B dist/index.js
      packed 35B src/index.ts

      pack-files-3-1.2.3.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 200B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-3-1.2.3.tgz"))).toEqual([
      "package/package.json",
      "package/dist/index.js",
      "package/src/index.ts",
    ]);
  });

  test("recursive only if leading **/", async () => {
    using dir = tempDir("pack-files-4", {
      "package.json": JSON.stringify({
        name: "pack-files-4",
        version: "1.2.123",
        files: ["**/index.js", "!**/index.test.ts"],
      }),
      "root.js": "console.log('hello ./root.js')",
      "subdir/index.js": "console.log('hello ./subdir/index.js')",
      "subdir/anotherdir/index.js": "console.log('hello ./subdir/anotherdir/index.js')",
      "index.js": indexJs,
      "index.test.ts": "console.log('hello ./index.test.ts')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 101B package.json
      packed 31B index.js
      packed 49B subdir/anotherdir/index.js
      packed 38B subdir/index.js

      pack-files-4-1.2.123.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 219B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-files-4-1.2.123.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
      "package/subdir/anotherdir/index.js",
      "package/subdir/index.js",
    ]);
  });

  test("excluded entries within included directories are not included", async () => {
    using dir = tempDir("bun-pack-files-excluded-entries", {
      "package.json": `
      {
        "name": "pack-excluded-entries-from-files",
        "version": "1.0.0",
        "files": ["src/**", "!src/**/*.test.ts"]
      }
      `,
      src: {
        "index.ts": "console.log('hello ./src/index.js')",
        "index.test.ts": "test('foo', () => expect(1).toBe(1))",
      },
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 126B package.json
      packed 35B src/index.ts

      pack-excluded-entries-from-files-1.0.0.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 161B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-excluded-entries-from-files-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/src/index.ts",
    ]);
  });

  // npm reads the `!` of `!(a).txt` as a negation and the parentheses as plain characters.
  // Every list is what `npm pack` 11.16.0 packs for the same `files`.
  test.each([
    [
      ["*.txt", "!(a).txt"],
      ["a.txt", "b.txt"],
    ],
    [
      ["*.txt", "!/(a).txt"],
      ["a.txt", "b.txt"],
    ],
    // the entry also applies inside a directory that `files` includes
    [
      ["*.txt", "sub", "!(a).txt"],
      ["a.txt", "b.txt", "sub/b.txt"],
    ],
    // this spelling packed the same before
    [
      ["*.txt", "![(]a).txt"],
      ["a.txt", "b.txt"],
    ],
  ])("an excluded name that begins with `(`: %j", async (files, expected) => {
    using dir = tempDir("pack-files-excluded-paren", {
      "package.json": JSON.stringify({ name: "pack-files-excluded-paren", version: "1.0.0", files }),
      "(a).txt": "x",
      "a.txt": "x",
      "b.txt": "x",
      "index.js": indexJs,
      "sub/(a).txt": "x",
      "sub/b.txt": "x",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-files-excluded-paren-1.0.0.tgz"))).toEqual([
      "package/package.json",
      ...expected.map(name => `package/${name}`),
    ]);
    expect(exitCode).toBe(0);
  });

  test("an entry longer than the path buffer is still matched", async () => {
    // A brace group of 1000 names that do not exist, then "dist". ~100KB, longer
    // than the path buffer on every platform (98302 bytes on Windows).
    const unused = Buffer.alloc(100, "x").toString();
    const pattern = `{${Array.from({ length: 1000 }, (_, i) => `${unused}${i}`).join(",")},dist}`;
    expect(pattern.length).toBeGreaterThan(100_000);

    using dir = tempDir("pack-files-long-entry", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-files-long-entry",
          version: "1.0.0",
          files: [pattern],
        }),
      ),
      write(join(dir, "dist", "index.js"), "console.log('hello ./dist/index.js')"),
      write(join(dir, "src", "index.js"), "console.log('hello ./src/index.js')"),
    ]);

    await pack(dir, bunEnv);
    const tarball = readTarball(join(dir, "pack-files-long-entry-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/dist/index.js" },
    ]);
  });

  test("leading **/ with a multi-segment pattern matches at any depth", async () => {
    using dir = tempDir("pack-files-doublestar-path", {
      "package.json": JSON.stringify({
        name: "pack-files-doublestar-path",
        version: "1.0.0",
        files: ["**/build/out.js", "src", "!**/__tests__/**", "!**/lib/skip.js"],
      }),
      "build/out.js": "x",
      "build/other.js": "x",
      "sub/build/out.js": "x",
      "a/b/build/out.js": "x",
      "out.js": "x",
      "src/index.js": "x",
      "src/__tests__/a.test.js": "x",
      "src/lib/__tests__/b.test.js": "x",
      "src/lib/b.js": "x",
      "src/lib/skip.js": "x",
      "src/vendor/lib/skip.js": "x",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-files-doublestar-path-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/a/b/build/out.js",
      "package/build/out.js",
      "package/src/index.js",
      "package/src/lib/b.js",
      "package/sub/build/out.js",
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent(".gitignore/.npmignore", () => {
  test.each([".gitignore", ".npmignore"])("can ignore and un-ignore a file (%s)", async ignoreFile => {
    using dir = tempDir("pack-ignore-1", {
      "package.json": JSON.stringify({ name: "pack-ignore-1", version: "0.0.0" }),
      "index.js": indexJs,
      [ignoreFile]: "index.js",
    });
    const tarballPath = join(dir, "pack-ignore-1-0.0.0.tgz");

    const ignored = await runPack(dir);
    expect(ignored.err).toBe("");
    expect(ignored.out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 51B package.json

      pack-ignore-1-0.0.0.tgz

      Total files: 1
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 51B
      Packed size: <packed size>"
    `);
    expect(ignored.exitCode).toBe(0);
    expect(tarballEntries(tarballPath)).toEqual(["package/package.json"]);

    await Promise.all([rm(tarballPath), write(join(dir, ignoreFile), "index.js\n!index.js")]);

    const unignored = await runPack(dir);
    expect(unignored.err).toBe("");
    expect(unignored.out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 51B package.json
      packed 31B index.js

      pack-ignore-1-0.0.0.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 82B
      Packed size: <packed size>"
    `);
    expect(unignored.exitCode).toBe(0);
    expect(tarballEntries(tarballPath)).toEqual(["package/package.json", "package/index.js"]);

    await Promise.all([rm(tarballPath), write(join(dir, ignoreFile), "!index.js\nindex.js")]);

    // the last matching pattern wins
    const ignoredAgain = await runPack(dir);
    expect(ignoredAgain).toEqual(ignored);
    expect(tarballEntries(tarballPath)).toEqual(["package/package.json"]);
  });

  test.each([".gitignore", ".npmignore"])("reports which %s could not be read", async ignoreFile => {
    using dir = tempDir("pack-ignore-unreadable", {
      "package.json": JSON.stringify({ name: "pack-ignore-unreadable", version: "1.0.0" }),
      "subdir/index.js": "console.log('hello ./subdir/index.js')",
      // a directory where the ignore file is expected: opening it succeeds, reading it fails
      [`subdir/${ignoreFile}`]: {},
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe(`EISDIR: failed to read ${ignoreFile} at: "<dir>/subdir/${ignoreFile}"`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["package.json", "subdir"]);
  });

  test("excludes files recursively", async () => {
    using dir = tempDir("pack-ignore-2", {
      "package.json": JSON.stringify({ name: "pack-ignore-2", version: "1.2.1" }),
      ".npmignore": "index.js",
      "index.js": indexJs,
      "subdir/index.js": "console.log('hello ./subdir/index.js')",
      "subdir/subsubdir/index.js": "console.log('hello ./subdir/subsubdir/index.js')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 51B package.json

      pack-ignore-2-1.2.1.tgz

      Total files: 1
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 51B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-ignore-2-1.2.1.tgz"))).toEqual(["package/package.json"]);
  });

  test.each([".gitignore", ".npmignore"])(
    "leading **/ with a multi-segment pattern matches at any depth (%s)",
    async ignoreFile => {
      using dir = tempDir("pack-ignore-doublestar-path", {
        "package.json": JSON.stringify({ name: "pack-ignore-doublestar-path", version: "1.0.0" }),
        [ignoreFile]: "**/docs/internal.md\n**/fixtures/tmp/\n**/__tests__/**\n",
        "keep.js": "keep",
        "docs/internal.md": "x",
        "docs/public.md": "x",
        "sub/docs/internal.md": "x",
        "sub/fixtures/tmp/file.txt": "x",
        "sub/fixtures/tmp.txt": "x",
        "__tests__/root.test.js": "x",
        "src/__tests__/a.test.js": "x",
        "src/lib/__tests__/b.test.js": "x",
        "src/lib/index.js": "x",
      });

      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(tarballEntries(join(dir, "pack-ignore-doublestar-path-1.0.0.tgz"))).toEqual([
        "package/package.json",
        "package/docs/public.md",
        "package/keep.js",
        "package/src/lib/index.js",
        "package/sub/fixtures/tmp.txt",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  test("leading **/ in a nested ignore file is relative to that file", async () => {
    using dir = tempDir("pack-ignore-doublestar-nested", {
      "package.json": JSON.stringify({ name: "pack-ignore-doublestar-nested", version: "1.0.0" }),
      "config/local.json": "outside of sub: kept",
      "sub/.npmignore": "**/config/local.json\n",
      "sub/config/local.json": "x",
      "sub/a/config/local.json": "x",
      "sub/a/config/shared.json": "x",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-ignore-doublestar-nested-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/config/local.json",
      "package/sub/a/config/shared.json",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a bare **/ ignores every directory", async () => {
    using dir = tempDir("pack-ignore-doublestar-bare", {
      "package.json": JSON.stringify({ name: "pack-ignore-doublestar-bare", version: "1.0.0" }),
      ".npmignore": "**/\n",
      "index.js": indexJs,
      "a/b.js": "x",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-ignore-doublestar-bare-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
    expect(exitCode).toBe(0);
  });

  test.each([".gitignore", ".npmignore"])(
    "negated leading **/ with a multi-segment pattern un-ignores at any depth (%s)",
    async ignoreFile => {
      using dir = tempDir("pack-ignore-doublestar-negated", {
        "package.json": JSON.stringify({ name: "pack-ignore-doublestar-negated", version: "1.0.0" }),
        [ignoreFile]: "**/build/*.js\n!**/build/keep.js\n",
        "keep.js": "keep",
        "build/out.js": "x",
        "build/keep.js": "x",
        "build/readme.txt": "x",
        "sub/build/out.js": "x",
        "sub/build/keep.js": "x",
        "a/b/build/out.js": "x",
        "a/b/build/other.js": "x",
      });

      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(tarballEntries(join(dir, "pack-ignore-doublestar-negated-1.0.0.tgz"))).toEqual([
        "package/package.json",
        "package/build/keep.js",
        "package/build/readme.txt",
        "package/keep.js",
        "package/sub/build/keep.js",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  test.each([".gitignore", ".npmignore"])("trailing spaces are trimmed unless escaped (%s)", async ignoreFile => {
    using dir = tempDir("pack-ignore-trailing-space", {
      "package.json": JSON.stringify({ name: "pack-ignore-trailing-space", version: "1.0.0" }),
      [ignoreFile]: "secrets   \nnotes.txt \nspaced\\ \n",
      "index.js": indexJs,
      "secrets/prod.env": "TOKEN=abc",
      "notes.txt": "notes",
      // Windows cannot create a file name that ends in a space.
      ...(isWindows ? {} : { "spaced ": "has a trailing space in its name" }),
      "spaced": "no trailing space",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-ignore-trailing-space-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
      "package/spaced",
    ]);
    expect(exitCode).toBe(0);
  });

  // git's add_patterns_from_buffer() skips a UTF-8 BOM before it splits lines
  test.each([".gitignore", ".npmignore"])("skips a UTF-8 BOM at the start of %s", async ignoreFile => {
    using dir = tempDir("pack-ignore-bom", {
      "package.json": JSON.stringify({ name: "pack-ignore-bom", version: "1.0.0" }),
      [ignoreFile]: "﻿secrets/\n*.log\n",
      "secrets/token.txt": "secret",
      "debug.log": "log",
      "index.js": indexJs,
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-ignore-bom-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/15602
  describe("a negation re-includes files below an excluded directory", () => {
    async function packed(ignoreFile: string, ignore: string, files: Record<string, string>) {
      using dir = tempDir("pack-ignore-negation", {
        "package.json": JSON.stringify({ name: "pack-ignore-negation", version: "0.0.7" }),
        [ignoreFile]: ignore,
        ...files,
      });
      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(exitCode).toBe(0);
      return tarballEntries(join(dir, "pack-ignore-negation-0.0.7.tgz")).map(entry => entry.slice("package/".length));
    }

    const dist = {
      "dist/cli.js": "a",
      "dist/sub/deep.js": "b",
      "dist/lib/foo.js": "c",
      "src/index.ts": "d",
      "src/keep.js": "e",
      "keep.js": "f",
    };

    // Every list is what `npm pack` packs for the same .npmignore.
    test.each([
      ["*\n!dist/**\n", ["dist/cli.js", "dist/lib/foo.js", "dist/sub/deep.js"]],
      ["*\n!dist/*\n", ["dist/cli.js"]],
      ["*\n!dist/**/*\n", ["dist/cli.js", "dist/lib/foo.js", "dist/sub/deep.js"]],
      ["*\n!dist/lib/foo.js\n", ["dist/lib/foo.js"]],
      ["*\n!*/keep.js\n", ["src/keep.js"]],
      ["*\n!**/keep.js\n", ["keep.js", "src/keep.js"]],
      ["*\n!dist/**\ndist/sub\n", ["dist/cli.js", "dist/lib/foo.js"]],
      // these packed the same before
      ["*\n!dist\n", []],
      ["*\n!keep.js\n", ["keep.js"]],
      ["*\n!dist\n!dist/**/*\n", ["dist/cli.js", "dist/lib/foo.js", "dist/sub/deep.js"]],
    ])("%j", async (ignore, expected) => {
      expect(await packed(".npmignore", ignore, dist)).toEqual(["package.json", ...expected]);
    });

    const secrets = {
      "index.js": indexJs,
      "secrets/keep.js": "named by the negation",
      "secrets/token.txt": "not named by anything",
      "secrets/deep/keep.js": "x",
      "secrets/deep/token.txt": "x",
    };

    // The directory is excluded by a rule that does not match its files. npm forgets that rule once a negation makes
    // it walk the directory, and packs every token.txt below. git never looks below an excluded directory, so
    // negations like these sit in real .gitignore files without effect. Only what a negation names is packed.
    describe.each([".npmignore", ".gitignore"])("the rest of the directory is still excluded (%s)", ignoreFile => {
      test.each([
        ["secrets/\n!secrets/keep.js\n", ["secrets/keep.js"]],
        ["secrets\n!secrets/keep.js\n", ["secrets/keep.js"]],
        ["secrets/\n!**/*.js\n", ["secrets/deep/keep.js", "secrets/keep.js"]],
        ["secrets/\n!secrets/deep/keep.js\n", ["secrets/deep/keep.js"]],
        // the negation names the directory, so all of it is back
        ["secrets/\n!secrets/deep/\n", ["secrets/deep/keep.js", "secrets/deep/token.txt"]],
        ["secrets/\n!secrets/deep/**\n", ["secrets/deep/keep.js", "secrets/deep/token.txt"]],
        // the last rule that matches wins
        ["!secrets/keep.js\nsecrets/\n", []],
        ["secrets/\n!secrets/keep.js\nkeep.js\n", []],
      ])("%j", async (ignore, expected) => {
        expect(await packed(ignoreFile, ignore, secrets)).toEqual(["package.json", "index.js", ...expected]);
      });
    });

    test("in the ignore file of a subdirectory", async () => {
      expect(
        await packed("sub/.npmignore", "build/\n!build/out/**\n", {
          "index.js": indexJs,
          "sub/build/tmp.txt": "x",
          "sub/build/out/a.js": "x",
          "build/tmp.txt": "the rule of sub does not reach here",
        }),
      ).toEqual(["package.json", "build/tmp.txt", "index.js", "sub/build/out/a.js"]);
    });

    test("the ignore file of a directory that no negation reaches is not read", async () => {
      expect(
        await packed(".npmignore", "secrets/\n!secrets/keep.js\n", {
          ...secrets,
          "secrets/deep/.npmignore": "!token.txt\n",
        }),
      ).toEqual(["package.json", "index.js", "secrets/keep.js"]);
    });

    test('below a directory that "files" includes', async () => {
      using dir = tempDir("pack-ignore-negation-files", {
        "package.json": JSON.stringify({ name: "pack-ignore-negation-files", version: "1.0.0", files: ["lib"] }),
        "lib/.npmignore": "secrets/\n!secrets/keep.js\n",
        "lib/index.js": indexJs,
        "lib/secrets/keep.js": "x",
        "lib/secrets/token.txt": "x",
      });
      const { err, exitCode } = await runPack(dir);
      expect(err).toBe("");
      expect(tarballEntries(join(dir, "pack-ignore-negation-files-1.0.0.tgz"))).toEqual([
        "package/package.json",
        "package/lib/index.js",
        "package/lib/secrets/keep.js",
      ]);
      expect(exitCode).toBe(0);
    });

    test(".git and .npmrc are never packed", async () => {
      expect(
        await packed(".npmignore", "conf/\n!conf/**\n", {
          "index.js": indexJs,
          "conf/a.json": "x",
          "conf/.npmrc": "//registry/:_authToken=secret",
          "conf/.git/config": "x",
        }),
      ).toEqual(["package.json", "conf/a.json", "index.js"]);
    });

    // npm and git read the `!` of `!(a).txt` as a negation and the parentheses as plain characters.
    // Every list is what `npm pack` 11.16.0 packs for the same ignore file.
    describe.each([".npmignore", ".gitignore"])("a negated name that begins with `(` (%s)", ignoreFile => {
      const files = {
        "(a).txt": "x",
        "(group)/page.js": "x",
        "a.txt": "x",
        "b.txt": "x",
        "index.js": indexJs,
        "other/page.js": "x",
      };
      const all = Object.keys(files);

      test.each([
        ["*.txt\n!(a).txt\n", ["(a).txt", "(group)/page.js", "index.js", "other/page.js"]],
        ["*.txt\n!/(a).txt\n", ["(a).txt", "(group)/page.js", "index.js", "other/page.js"]],
        ["!(a).txt\n", all],
        ["*\n!(group)/**\n", ["(group)/page.js"]],
        ["(group)\n!(group)/page.js\n", all],
        // this spelling packed the same before
        ["*.txt\n!\\(a).txt\n", ["(a).txt", "(group)/page.js", "index.js", "other/page.js"]],
      ])("%j", async (ignore, expected) => {
        expect(await packed(ignoreFile, ignore, files)).toEqual(["package.json", ...expected]);
      });
    });
  });

  // The usual monorepo: one .gitignore, at the root, that names the folder its packages build into.
  test.each([".gitignore", ".npmignore"])("the %s of the workspace root doesn't apply to a workspace", async name => {
    using dir = tempDir("pack-ignore-root", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      [name]: "node_modules\ndist\n",
      "packages/m/package.json": JSON.stringify({ name: "m", version: "1.0.0", main: "dist/index.js" }),
      "packages/m/dist/index.js": indexJs,
      "packages/m/src/index.ts": indexJs,
    });
    const member = join(dir, "packages", "m");

    const { err, exitCode } = await runPack(member);
    expect(err).toBe("");
    expect(tarballEntries(join(member, "m-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/dist/index.js",
      "package/src/index.ts",
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("bins", () => {
  test("basic", async () => {
    using dir = tempDir("pack-bins", {
      "package.json": JSON.stringify({ name: "pack-bins", version: "1.2.3", bin: "bin.js" }),
      "bin.js": "#!/usr/bin/env bun\n",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 66B package.json
      packed 19B bin.js

      pack-bins-1.2.3.tgz

      Total files: 2
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 85B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-bins-1.2.3.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", "package/bin.js"]);
    expect(tarball.entries[0].perm & 0o644).toBe(0o644);
    expect(tarball.entries[1].perm & 0o755).toBe(0o755);
  });

  test("directory", async () => {
    using dir = tempDir("pack-bins-dir", {
      "package.json": JSON.stringify({ name: "pack-bins-dir", version: "1.2.3", directories: { bin: "bins" } }),
      "bins/bin1.js": "#!/usr/bin/env bun\n",
      "bins/bin2.js": "#!/usr/bin/env bun\n",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 93B package.json
      packed 19B bins/bin1.js
      packed 19B bins/bin2.js

      pack-bins-dir-1.2.3.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 131B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-bins-dir-1.2.3.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", "package/bins/bin1.js", "package/bins/bin2.js"]);
    expect(tarball.entries[0].perm & 0o644).toBe(0o644);
    expect(tarball.entries[1].perm & 0o755).toBe(0o755);
    expect(tarball.entries[2].perm & 0o755).toBe(0o755);
  });

  test('are included even if not included in "files"', async () => {
    using dir = tempDir("pack-bins-and-files-1", {
      "package.json": JSON.stringify({
        name: "pack-bins-and-files-1",
        version: "2.2.2",
        files: ["dist"],
        bin: "bin.js",
      }),
      "dist/hi.js": "console.log('hi!')",
      "bin.js": "console.log('hello')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 99B package.json
      packed 20B bin.js
      packed 18B dist/hi.js

      pack-bins-and-files-1-2.2.2.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 137B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bins-and-files-1-2.2.2.tgz"))).toEqual([
      "package/package.json",
      "package/bin.js",
      "package/dist/hi.js",
    ]);
  });

  test('"directories" works with "files"', async () => {
    using dir = tempDir("pack-bins-and-files-2", {
      "package.json": JSON.stringify({
        name: "pack-bins-and-files-2",
        version: "1.2.3",
        files: ["dist"],
        directories: { bin: "bins" },
      }),
      "dist/hi.js": "console.log('hi!')",
      "bins/bin.js": "console.log('hello')",
      "bins/what/what.js": "console.log('hello')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 122B package.json
      packed 20B bins/bin.js
      packed 20B bins/what/what.js
      packed 18B dist/hi.js

      pack-bins-and-files-2-1.2.3.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 180B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bins-and-files-2-1.2.3.tgz"))).toEqual([
      "package/package.json",
      "package/bins/bin.js",
      "package/bins/what/what.js",
      "package/dist/hi.js",
    ]);
  });

  test('deduplicate with "files"', async () => {
    using dir = tempDir("pack-bins-and-files-dedupe", {
      "package.json": JSON.stringify({
        name: "pack-bins-and-files-2",
        version: "1.2.3",
        files: ["dist", "bins/bin.js"],
        directories: { bin: "bins" },
      }),
      "dist/hi.js": "console.log('hi!')",
      "bins/bin.js": "console.log('hello')",
      "bins/what/what.js": "console.log('hello')",
    });

    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 137B package.json
      packed 20B bins/bin.js
      packed 20B bins/what/what.js
      packed 18B dist/hi.js

      pack-bins-and-files-2-1.2.3.tgz

      Total files: 4
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 195B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-bins-and-files-2-1.2.3.tgz"))).toEqual([
      "package/package.json",
      "package/bins/bin.js",
      "package/bins/what/what.js",
      "package/dist/hi.js",
    ]);
  });

  describe("longer than the path buffer", () => {
    // Longer than the path buffer on every platform (98302 bytes on Windows), so
    // nothing on disk can have this name.
    const long = Buffer.alloc(100_000, "b").toString();

    test.each([
      ["bin", { bin: long }],
      ["bin object value", { bin: { cli: long } }],
      ["directories.bin", { directories: { bin: long } }],
    ])("%s is skipped like any other bin that does not exist", async (_, fields) => {
      using dir = tempDir("pack-long-bin", {});
      await Promise.all([
        write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "pack-long-bin",
            version: "1.0.0",
            ...fields,
          }),
        ),
        write(join(dir, "index.js"), "console.log('hello ./index.js')"),
      ]);

      await pack(dir, bunEnv);

      const tarball = readTarball(join(dir, "pack-long-bin-1.0.0.tgz"));
      expect(tarball.entries).toMatchObject([{ pathname: "package/package.json" }, { pathname: "package/index.js" }]);
    });

    test("the other bins are still packed", async () => {
      using dir = tempDir("pack-long-bin", {});
      await Promise.all([
        write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "pack-long-bin",
            version: "1.0.0",
            files: ["index.js"],
            bin: { long, cli: "cli.js" },
          }),
        ),
        write(join(dir, "index.js"), "console.log('hello ./index.js')"),
        write(join(dir, "cli.js"), `#!/usr/bin/env bun\n`),
      ]);

      await pack(dir, bunEnv);

      const tarball = readTarball(join(dir, "pack-long-bin-1.0.0.tgz"));
      expect(tarball.entries).toMatchObject([
        { pathname: "package/package.json" },
        { pathname: "package/cli.js" },
        { pathname: "package/index.js" },
      ]);
      expect(tarball.entries[1].perm & 0o111).toBe(0o111);
    });
  });

  test("that are not regular files are ignored", async () => {
    using dir = tempDir("pack-bins-not-files", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-bins-not-files",
          version: "1.0.0",
          bin: {
            "a-directory": "lib",
            "empty": "",
            "real": "real-bin.js",
          },
        }),
      ),
      write(join(dir, "index.js"), "console.log('index')"),
      write(join(dir, "lib", "a.js"), "console.log('a')"),
      write(join(dir, "real-bin.js"), "console.log('real bin')"),
    ]);

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-bins-not-files-1.0.0.tgz"));
    expect(tarball.entries.map(({ pathname }) => pathname)).toEqual([
      "package/package.json",
      "package/index.js",
      "package/lib/a.js",
      "package/real-bin.js",
    ]);
    expect(tarball.entries[3].perm & 0o111).toBe(0o111);
  });

  // Symlinks are never packed (same as npm). Bins are no exception: packing one
  // would copy the link target, which may live outside the package.
  const OUTSIDE = "console.log('outside the package')";

  async function writeSymlinkedBins(dir: string) {
    const outside = join(dir, "outside");
    const pkgDir = join(dir, "pkg");
    await Promise.all([
      write(join(outside, "secret.js"), OUTSIDE),
      write(join(outside, "nested", "inner.js"), OUTSIDE),
      write(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-symlink",
          version: "1.0.0",
          // `files` leaves out every bin so that only the bin handling can add them.
          files: ["index.js"],
          bin: {
            "real": "real-bin.js",
            "relative-link": "relative-link.js",
            "absolute-link": "absolute-link.js",
            "link-inside-package": "link-to-real.js",
            "through-linked-dir": "linked-dir/inner.js",
            // bin paths are normalized to `/` before they are checked
            "through-linked-dir-backslash": "linked-dir\\inner.js",
          },
        }),
      ),
      write(join(pkgDir, "index.js"), "console.log('index')"),
      write(join(pkgDir, "real-bin.js"), "console.log('real bin')"),
    ]);
    await Promise.all([
      symlink(join("..", "outside", "secret.js"), join(pkgDir, "relative-link.js"), "file"),
      symlink(join(outside, "secret.js"), join(pkgDir, "absolute-link.js"), "file"),
      symlink("real-bin.js", join(pkgDir, "link-to-real.js"), "file"),
      symlink(join("..", "outside", "nested"), join(pkgDir, "linked-dir"), "dir"),
    ]);
    return pkgDir;
  }

  test("that are symlinks, or behind a symlinked directory, are not packed", async () => {
    using dir = tempDir("pack-bins-symlink", {});
    const pkgDir = await writeSymlinkedBins(dir);

    await pack(pkgDir, bunEnv);

    const tarball = readTarball(join(pkgDir, "pack-bins-symlink-1.0.0.tgz"));
    expect(tarball.entries.map(({ pathname }) => pathname)).toEqual([
      "package/package.json",
      "package/index.js",
      "package/real-bin.js",
    ]);
    for (const entry of tarball.entries) {
      expect(entry.contents).not.toContain(OUTSIDE);
    }
    expect(tarball.entries[2].perm & 0o111).toBe(0o111);
  });

  test("that are symlinks are not listed by --dry-run", async () => {
    using dir = tempDir("pack-bins-symlink", {});
    const pkgDir = await writeSymlinkedBins(dir);

    const { out } = await pack(pkgDir, bunEnv, "--dry-run");

    const packed = out
      .split("\n")
      .filter(line => line.startsWith("packed "))
      .map(line => line.split(" ").at(-1));
    expect(packed).toEqual(["package.json", "index.js", "real-bin.js"]);
    expect(out).toContain("Total files: 3");
  });

  test('"directories.bin" that is a symlink is not packed', async () => {
    using dir = tempDir("pack-bins-dir-symlink", {});
    const outside = join(dir, "outside");
    const pkgDir = join(dir, "pkg");
    await Promise.all([
      write(join(outside, "bins", "a.js"), OUTSIDE),
      write(join(outside, "bins", "b.js"), OUTSIDE),
      write(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-dir-symlink",
          version: "1.0.0",
          directories: {
            bin: "./bins/",
          },
        }),
      ),
      write(join(pkgDir, "index.js"), "console.log('index')"),
    ]);
    // A junction on Windows. Elsewhere, "junction" is ignored and a plain symlink is created.
    await symlink(join(outside, "bins"), join(pkgDir, "bins"), "junction");

    await pack(pkgDir, bunEnv);

    const tarball = readTarball(join(pkgDir, "pack-bins-dir-symlink-1.0.0.tgz"));
    expect(tarball.entries.map(({ pathname }) => pathname)).toEqual(["package/package.json", "package/index.js"]);
  });

  // Paths resolve against the package root, as in npm, so all four name one file.
  test("the same file under several bin names is packed once", async () => {
    using dir = tempDir("pack-bins-same-file", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-bins-same-file",
          version: "1.0.0",
          bin: {
            "one": "cli.js",
            "two": "cli.js",
            "three": "./cli.js",
            "four": "../cli.js",
          },
        }),
      ),
      write(join(dir, "cli.js"), "console.log('hello')"),
    ]);

    const { out } = await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-bins-same-file-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([{ pathname: "package/package.json" }, { pathname: "package/cli.js" }]);
    expect(tarball.entries[1].perm & 0o111).toBe(0o111);
    expect(out).toContain("Total files: 2");
  });

  test('the same file under several bin names and in "files" is packed once', async () => {
    using dir = tempDir("pack-bins-dedupe", {
      "package.json": JSON.stringify({
        name: "pack-bins-dedupe",
        version: "1.2.3",
        files: ["dist/minified/index.mjs", "dist/other.js"],
        bin: { pbd: "dist/minified/index.mjs", "pack-bins-dedupe": "dist/minified/index.mjs" },
      }),
      "dist/minified/index.mjs": "#!/usr/bin/env bun\n",
      "dist/other.js": "console.log('other')",
    });

    const dryRun = await runPack(dir, ["--dry-run"]);
    expect(dryRun.err).toBe("");
    expect(dryRun.out.match(/dist\/minified\/index\.mjs/g)).toHaveLength(1);
    expect(dryRun.out).toContain("Total files: 3");
    expect(dryRun.exitCode).toBe(0);

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-bins-dedupe-1.2.3.tgz"));
    expect(entryNames(tarball)).toEqual([
      "package/package.json",
      "package/dist/minified/index.mjs",
      "package/dist/other.js",
    ]);
    expect(tarball.entries[1].perm & 0o111).toBe(0o111);
  });

  // None of these name a file that can be packed as a bin: the package root, a
  // file spelled as a directory, a directory, and the root package.json (which
  // is always in the tarball). The package packs as if "bin" were absent.
  test.each(["", ".", "cli.js/", "lib/", "package.json"])('"bin" of %p is ignored', async bin => {
    using dir = tempDir("pack-bins-not-a-file", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-bins-not-a-file",
          version: "1.0.0",
          bin,
        }),
      ),
      write(join(dir, "cli.js"), "console.log('cli')"),
      write(join(dir, "lib", "a.js"), "console.log('a')"),
    ]);

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-bins-not-a-file-1.0.0.tgz"));
    expect(
      tarball.entries.map(entry => ({ pathname: entry.pathname, executable: (entry.perm & 0o111) !== 0 })),
    ).toEqual([
      { pathname: "package/package.json", executable: false },
      { pathname: "package/cli.js", executable: false },
      { pathname: "package/lib/a.js", executable: false },
    ]);
  });

  test("ignored entries of a bin object do not affect the others", async () => {
    using dir = tempDir("pack-bins-partly-ignored", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-bins-partly-ignored",
          version: "1.0.0",
          bin: {
            "dir": "lib/",
            "cli": "cli.js",
            "pkg": "package.json",
          },
        }),
      ),
      write(join(dir, "cli.js"), "console.log('cli')"),
      write(join(dir, "lib", "a.js"), "console.log('a')"),
    ]);

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-bins-partly-ignored-1.0.0.tgz"));
    expect(
      tarball.entries.map(entry => ({ pathname: entry.pathname, executable: (entry.perm & 0o111) !== 0 })),
    ).toEqual([
      { pathname: "package/package.json", executable: false },
      { pathname: "package/cli.js", executable: true },
      { pathname: "package/lib/a.js", executable: false },
    ]);
  });

  // The bin directory is packed by its own walk, and the walk over the rest of
  // the package has to skip it. Each `files` value below routes that skip
  // through a different walk.
  describe('"directories.bin" with a trailing slash', () => {
    test.each([
      [undefined, ["package/index.js", "package/lib/bins/bin.js", "package/lib/index.js"]],
      [["index.js"], ["package/index.js", "package/lib/bins/bin.js"]],
      [["lib"], ["package/lib/bins/bin.js", "package/lib/index.js"]],
      [["lib/bins"], ["package/lib/bins/bin.js"]],
    ])("files: %p", async (files, expected) => {
      using dir = tempDir("pack-bins-dir-trailing-slash", {});
      await Promise.all([
        write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "pack-bins-dir-trailing-slash",
            version: "1.0.0",
            files,
            directories: {
              bin: "./lib/bins/",
            },
          }),
        ),
        write(join(dir, "index.js"), "console.log('index')"),
        write(join(dir, "lib", "index.js"), "console.log('lib')"),
        write(join(dir, "lib", "bins", "bin.js"), "console.log('bin')"),
      ]);

      await pack(dir, bunEnv);

      const tarball = readTarball(join(dir, "pack-bins-dir-trailing-slash-1.0.0.tgz"));
      expect(tarball.entries.map(entry => entry.pathname)).toEqual(["package/package.json", ...expected]);
      const bin = tarball.entries.find(entry => entry.pathname === "package/lib/bins/bin.js");
      expect(bin.perm & 0o111).toBe(0o111);
    });
  });

  test.each(["", ".", "./"])('"directories.bin" of %p (the package root) is ignored', async bin => {
    using dir = tempDir("pack-bins-dir-root", {});
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "pack-bins-dir-root",
          version: "1.0.0",
          directories: {
            bin,
          },
        }),
      ),
      write(join(dir, "index.js"), "console.log('index')"),
      write(join(dir, "lib", "a.js"), "console.log('a')"),
    ]);

    await pack(dir, bunEnv);

    const tarball = readTarball(join(dir, "pack-bins-dir-root-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([
      { pathname: "package/package.json" },
      { pathname: "package/index.js" },
      { pathname: "package/lib/a.js" },
    ]);
  });

  // "directories.bin" applies only without a "bin", and an empty one counts as absent (npm). `files` leaves bins/a.js out.
  test.each([
    ["", ["package/bins/a.js"]],
    [{}, ["package/bins/a.js"]],
    ["cli.js", ["package/cli.js"]],
  ] as [string | object, string[]][])('"bin" of %j with "directories.bin"', async (bin, bins) => {
    using dir = tempDir("pack-bins-with-dir", {
      "package.json": JSON.stringify({
        name: "pack-bins-with-dir",
        version: "1.0.0",
        files: ["index.js"],
        bin,
        directories: { bin: "bins" },
      }),
      "index.js": "console.log('index')",
      "cli.js": "console.log('cli')",
      "bins/a.js": "console.log('a')",
    });

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-bins-with-dir-1.0.0.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", ...bins, "package/index.js"]);
    expect(tarball.entries.filter(entry => (entry.perm & 0o111) !== 0).map(entry => entry.pathname)).toEqual(bins);
  });

  // Nothing can re-include `.git` and `.npmrc`: not "files", and not a bin either.
  test.each([
    { bin: ".npmrc" },
    { bin: { a: "./conf/.npmrc" } },
    { bin: ".git/config" },
    { bin: { a: "sub/.git/hooks/pre-commit", b: "index.js" } },
    { directories: { bin: ".git/hooks" } },
    { directories: { bin: "sub/.git" } },
  ])("%j does not pack .git or .npmrc", async fields => {
    using dir = tempDir("pack-bins-never-packed", {
      "package.json": JSON.stringify({ name: "pack-bins-never-packed", version: "1.0.0", ...fields }),
      "index.js": indexJs,
      ".npmrc": "//registry.example/:_authToken=secret",
      "conf/.npmrc": "//registry.example/:_authToken=secret",
      ".git/config": "[remote]",
      ".git/hooks/pre-commit": "#!/bin/sh",
      "sub/.git/hooks/pre-commit": "#!/bin/sh",
    });

    const dryRun = await runPack(dir, ["--dry-run"]);
    expect(dryRun.err).toBe("");
    expect(dryRun.out).toContain("Total files: 2");

    const { err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(tarballEntries(join(dir, "pack-bins-never-packed-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
    expect(exitCode).toBe(0);
  });

  // longer than a directory entry can be
  const tooLong = Buffer.alloc(300, "a").toString();
  test.each([
    { what: "a bin that is not there", fields: { bin: "missing.js" } },
    { what: "a bin below a file", fields: { bin: "index.js/cli.js" } },
    { what: "a bin with a name of 300 bytes", fields: { bin: tooLong } },
    { what: "a directories.bin that is not there", fields: { directories: { bin: "missing" } } },
    { what: "a directories.bin that is a file", fields: { directories: { bin: "index.js" } } },
    { what: "a directories.bin with a name of 300 bytes", fields: { directories: { bin: tooLong } } },
  ])("$what is left out", async ({ fields }) => {
    const folder = (index: string) => ({
      "package.json": JSON.stringify({ name: "pack-bins-absent", version: "1.0.0", ...fields }),
      "index.js": index,
    });
    using dir = tempDir("pack-bins-absent", { a: folder(indexJs), b: folder("console.log('changed')") });

    const dryRun = await runPack(join(dir, "a"), ["--dry-run"]);
    expect(dryRun.err).toBe("");
    expect(dryRun.out).toContain("Total files: 2");
    expect(dryRun.exitCode).toBe(0);

    const { out, err, exitCode } = await runPack(join(dir, "a"));
    expect(err).toBe("");
    expect(out).toContain("Total files: 2");
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(dir, "a", "pack-bins-absent-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/index.js",
    ]);
    await rm(join(dir, "a", "pack-bins-absent-1.0.0.tgz"));

    // `bun pm diff` reads a folder as pack would publish it.
    await using proc = spawn({
      cmd: [bunExe(), "pm", "diff", "./a", "./b", "--name-only"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [stdout, stderr, diffExitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(line => /^[AMD] /.test(line))).toEqual(["M index.js"]);
    expect(diffExitCode).toBe(0);
  });
});

// `chmod 000` keeps the user that packs out of one entry that the scan looks for. The entry is
// there, so the scan must not continue as if it was not.
describe.concurrent.skipIf(isWindows)("an entry that exists but can't be opened", () => {
  // Runs `bun ...cmd` in `cwd` while `locked` has no permission bits. Restores them so that the tree can be removed.
  async function runWithout(dir: string, locked: string, cmd: string[], cwd: string = dir) {
    using unprivileged = unprivilegedSpawnOptions(dir);
    const path = join(dir, locked);
    const { mode } = await lstat(path);
    await chmod(path, 0o000);
    try {
      await using proc = spawn({
        cmd: [bunExe(), ...cmd],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        // `bun publish` stops early when it has no credentials. Nothing listens on port 1.
        env: { ...bunEnv, npm_config_registry: "http://user:password@127.0.0.1:1/" },
        ...unprivileged,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { out: normalizeBunSnapshot(stdout, dir), err: normalizeBunSnapshot(stderr, dir), exitCode };
    } finally {
      await chmod(path, mode & 0o777);
    }
  }

  async function tarballs(dir: string) {
    return (await readdir(dir)).filter(name => name.endsWith(".tgz"));
  }

  const manifest = (name: string, fields: object = {}) => JSON.stringify({ name, version: "1.0.0", ...fields });
  const bundlesDep1 = manifest("pack-locked", { bundledDependencies: ["dep1"] });

  test.each([
    {
      // Before, the hoisted copy, another version, was bundled in its place.
      what: "the nested copy of a dependency of a bundled dependency",
      locked: "node_modules/dep1/node_modules/dep3",
      failsOn: "node_modules/dep1/node_modules/dep3",
      tree: {
        "package.json": bundlesDep1,
        "node_modules/dep1/package.json": manifest("dep1", { dependencies: { dep3: "3.3.3" } }),
        "node_modules/dep1/node_modules/dep3/package.json": manifest("dep3", { version: "3.3.3" }),
        "node_modules/dep3/package.json": manifest("dep3", { version: "9.9.9" }),
      },
    },
    {
      what: "the hoisted copy of a dependency of a bundled dependency",
      locked: "node_modules/dep3",
      failsOn: "node_modules/dep3",
      tree: {
        "package.json": bundlesDep1,
        "node_modules/dep1/package.json": manifest("dep1", { dependencies: { dep3: "3.3.3" } }),
        "node_modules/dep3/package.json": manifest("dep3", { version: "3.3.3" }),
      },
    },
    {
      // A nested copy can be in it. npm takes the hoisted copy here.
      what: "the node_modules of a bundled dependency",
      locked: "node_modules/dep1/node_modules",
      failsOn: "node_modules/dep1/node_modules/dep3",
      tree: {
        "package.json": bundlesDep1,
        "node_modules/dep1/package.json": manifest("dep1", { dependencies: { dep3: "3.3.3" } }),
        "node_modules/dep1/node_modules": {},
        "node_modules/dep3/package.json": manifest("dep3", { version: "3.3.3" }),
      },
    },
    {
      what: "the scope of a bundled dependency",
      locked: "node_modules/@scope",
      failsOn: "node_modules/@scope/dep",
      tree: {
        "package.json": manifest("pack-locked", { bundledDependencies: ["@scope/dep", "plain"] }),
        "node_modules/@scope/dep/package.json": manifest("@scope/dep"),
        "node_modules/plain/package.json": manifest("plain"),
      },
    },
    {
      // npm leaves the dependency out here.
      what: "the scope of a dependency of a bundled dependency",
      locked: "node_modules/@scope",
      failsOn: "node_modules/@scope/dep3",
      tree: {
        "package.json": bundlesDep1,
        "node_modules/dep1/package.json": manifest("dep1", { dependencies: { "@scope/dep3": "3.3.3" } }),
        "node_modules/@scope/dep3/package.json": manifest("@scope/dep3", { version: "3.3.3" }),
      },
    },
  ])("$what", async ({ locked, failsOn, tree }) => {
    using dir = tempDir("pack-locked-dep", tree);

    const { out, err, exitCode } = await runWithout(dir, locked, ["pm", "pack"]);
    expect(err).toBe(`EACCES: failed to open directory "<dir>/${failsOn}" for packing`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await tarballs(dir)).toEqual([]);
  });

  // `bun publish` and `bun pm diff` run the same scan. The package is folder `b`, and `a` is a copy that opens.
  // A dry run opens no file, so it sees a directory that does not open and not a file that does not.
  const binDirectory = {
    what: "directories.bin",
    fields: { directories: { bin: "bin" } },
    locked: "b/bin",
    message: 'EACCES: failed to open directory "bin" for packing',
  };
  const binFile = {
    what: "a bin",
    fields: { bin: "bin/cli.js" },
    locked: "b/bin/cli.js",
    message: 'EACCES: Permission denied: failed to open file: "bin/cli.js" (open)',
  };
  const binBelowLocked = {
    what: "the directory of a bin",
    fields: { bin: "bin/cli.js" },
    locked: "b/bin",
    message: 'EACCES: Permission denied: failed to stat file: "bin/cli.js" (lstat)',
  };
  const pmPack = { command: "pm pack", cwd: "b", banner: "bun pack <version> (<revision>)" };
  const pmPackDryRun = { ...pmPack, command: "pm pack --dry-run" };
  const publish = { command: "publish", cwd: "b", banner: "bun publish <version> (<revision>)" };
  const publishDryRun = { ...publish, command: "publish --dry-run" };
  const pmDiff = { command: "pm diff ./a ./b --name-only", cwd: "", banner: "" };
  test.each([
    ...[pmPack, pmPackDryRun, publishDryRun, pmDiff].map(command => ({ ...binDirectory, ...command })),
    ...[pmPack, publish].map(command => ({ ...binFile, ...command })),
    ...[pmPack, pmPackDryRun, publishDryRun, pmDiff].map(command => ({ ...binBelowLocked, ...command })),
  ])("$what, bun $command", async ({ fields, locked, message, command, cwd, banner }) => {
    const folder = {
      "package.json": manifest("pack-locked", fields),
      // keeps the walk of the package out of the directory, so only the bin leads there
      ".npmignore": "bin\n",
      "index.js": indexJs,
      "bin/cli.js": "#!/usr/bin/env bun\n",
    };
    using dir = tempDir("pack-locked-bin", { a: folder, b: folder });

    const { out, err, exitCode } = await runWithout(dir, locked, command.split(" "), join(dir, cwd));
    expect(err).toBe(message);
    expect(out).toBe(banner);
    expect(exitCode).toBe(1);
    expect(await tarballs(join(dir, "b"))).toEqual([]);
  });

  test("a scope that no bundled dependency is in is not opened", async () => {
    using dir = tempDir("pack-locked-other-scope", {
      "package.json": manifest("pack-locked", { bundledDependencies: ["plain"] }),
      "node_modules/plain/package.json": manifest("plain"),
      "node_modules/@other/dep/package.json": manifest("@other/dep"),
    });

    const { err, exitCode } = await runWithout(dir, "node_modules/@other", ["pm", "pack"]);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(tarballEntries(join(dir, "pack-locked-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/node_modules/plain/package.json",
    ]);
  });
});

test.concurrent("unicode", async () => {
  using dir = tempDir("pack-unicode", {
    "package.json": JSON.stringify({ name: "pack-unicode", version: "1.1.1" }),
    "äöüščří.js": "console.log('hello ./äöüščří.js');",
  });

  const { out, err, exitCode } = await runPack(dir);
  expect(err).toBe("");
  expect(out).toMatchInlineSnapshot(`
    "bun pack <version> (<revision>)

    packed 50B package.json
    packed 41B äöüščří.js

    pack-unicode-1.1.1.tgz

    Total files: 2
    Shasum: <shasum>
    Integrity: <integrity>
    Unpacked size: 91B
    Packed size: <packed size>"
  `);
  expect(exitCode).toBe(0);

  expect(tarballEntries(join(dir, "pack-unicode-1.1.1.tgz"))).toEqual(["package/package.json", "package/äöüščří.js"]);
});

// Reads the members of a .tgz without decoding their names: `readTarball` turns
// names into JS strings, which maps the bytes this test is about onto U+FFFD.
// Names are returned latin1-decoded (one char per stored byte) and collected
// from every place the archive spells a name: the ustar header `name` field
// and, when libarchive emits one, the `path` record of the pax header.
function rawTarballMembers(tgz: Uint8Array) {
  const tar = Buffer.from(Bun.gunzipSync(tgz));
  const members: { names: Set<string>; contents: string }[] = [];
  let paxPath: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const nameField = header.subarray(0, 100);
    const nameLength = nameField.indexOf(0) === -1 ? 100 : nameField.indexOf(0);
    const name = nameField.toString("latin1", 0, nameLength);
    const size = parseInt(header.toString("latin1", 124, 136), 8);
    const typeflag = header.toString("latin1", 156, 157);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (typeflag === "x") {
      // pax extended header data is a sequence of "<record length> <key>=<value>\n"
      for (let pos = 0; pos < data.length;) {
        const space = data.indexOf(" ", pos);
        const recordLength = parseInt(data.toString("latin1", pos, space), 10);
        const record = data.toString("latin1", space + 1, pos + recordLength - 1);
        if (record.startsWith("path=")) paxPath = record.slice("path=".length);
        pos += recordLength;
      }
      continue;
    }

    const names = new Set([name]);
    if (paxPath !== undefined) names.add(paxPath);
    paxPath = undefined;
    members.push({ names, contents: data.toString("latin1") });
  }
  return members.sort((a, b) => (a.contents < b.contents ? -1 : 1));
}

// Only Linux lets a filename carry bytes that are not valid UTF-8 (APFS rejects
// them and Windows filenames are UTF-16).
test.concurrent.skipIf(!isLinux)("filenames that are not valid UTF-8 are stored byte for byte", async () => {
  using dir = tempDir("pack-invalid-utf8", {
    "package.json": JSON.stringify({ name: "pack-invalid-utf8", version: "1.0.0" }),
  });
  const rawPath = (byte: number) => Buffer.concat([Buffer.from(`${dir}/x_`), Buffer.from([byte])]);
  await Promise.all([
    // latin-1 "é", and a byte that is invalid in UTF-8 at any position
    writeFile(rawPath(0xe9), "ONE"),
    writeFile(rawPath(0xff), "TWO"),
  ]);

  const { out } = await pack(dir, bunEnv);
  expect(out).toContain("Total files: 3");

  const members = rawTarballMembers(await file(join(dir, "pack-invalid-utf8-1.0.0.tgz")).bytes());
  expect(members).toEqual([
    { names: new Set(["package/x_\xe9"]), contents: "ONE" },
    { names: new Set(["package/x_\xff"]), contents: "TWO" },
    { names: new Set(["package/package.json"]), contents: expect.stringContaining(`"pack-invalid-utf8"`) },
  ]);
});

test.concurrent("$npm_command is accurate", async () => {
  using dir = tempDir("pack-command", {
    "package.json": JSON.stringify({
      name: "pack-command",
      version: "1.1.1",
      scripts: {
        postpack: "echo $npm_command",
      },
    }),
  });

  const { out, err, exitCode } = await runPack(dir);
  expect(err).toBe("$ echo $npm_command");
  expect(out).toMatchInlineSnapshot(`
    "bun pack <version> (<revision>)

    packed 106B package.json

    pack-command-1.1.1.tgz

    Total files: 1
    Shasum: <shasum>
    Integrity: <integrity>
    Unpacked size: 106B
    Packed size: <packed size>

    pack"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("$npm_lifecycle_event is accurate", async () => {
  using dir = tempDir("pack-lifecycle", {
    "package.json": JSON.stringify({
      name: "pack-lifecycle",
      version: "1.1.1",
      scripts: {
        postpack: "echo $npm_lifecycle_event",
      },
    }),
  });

  const { out, err, exitCode } = await runPack(dir);
  expect(err).toBe("$ echo $npm_lifecycle_event");
  expect(out).toMatchInlineSnapshot(`
    "bun pack <version> (<revision>)

    packed 116B package.json

    pack-lifecycle-1.1.1.tgz

    Total files: 1
    Shasum: <shasum>
    Integrity: <integrity>
    Unpacked size: 116B
    Packed size: <packed size>

    postpack"
  `);
  expect(exitCode).toBe(0);
});

// `bun pm pack`, `bun publish` and `bun pm diff <folder>` read each directory of a package with getdents64(2). A read
// that fails is not the end of the directory. They took it as the end: pack wrote a tarball without the files it did
// not read, printed that short count as `Total files` and exited 0, and publish sent that tarball to the registry.
//
// An LD_PRELOAD library makes one chosen read of one directory, by one chosen reader, return -1 with a chosen errno.
// bun issues getdents64 through libc's syscall(), which is the symbol the library interposes.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.skipIf(!isLinux || !cc)("a read of a directory fails", () => {
  const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*next_syscall)(long, ...);
// A walk of the directory is a "reader". A read at offset 0 starts a new one.
static int reader, read_of_reader;

static int env_int(const char *name, int fallback) {
  const char *value = getenv(name);
  return value ? atoi(value) : fallback;
}

// One line for each read of the directory. A test reads them to know that the library interposed.
static void note(const char *what, long value) {
  const char *log = getenv("DIR_READ_FAULT_LOG");
  if (!log) return;
  char line[96];
  int len = snprintf(line, sizeof line, "reader %d read %d: %s %ld\\n", reader, read_of_reader, what, value);
  int fd = open(log, O_WRONLY | O_APPEND | O_CREAT, 0644);
  if (fd < 0) return;
  if (write(fd, line, len) < 0) {}
  close(fd);
}

static long fail(int code) {
  note("failed", code);
  errno = code;
  return -1;
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");

  const char *dir = nr == SYS_getdents64 ? getenv("DIR_READ_FAULT_DIR") : NULL;
  char path[PATH_MAX];
  if (dir) {
    char link[64];
    snprintf(link, sizeof link, "/proc/self/fd/%d", (int)a1);
    ssize_t n = readlink(link, path, sizeof path - 1);
    if (n <= 0) dir = NULL;
    else {
      path[n] = 0;
      if (strcmp(path, dir) != 0) dir = NULL;
    }
  }
  if (!dir) return next_syscall(nr, a1, a2, a3, a4, a5, a6);

  if (lseek((int)a1, 0, SEEK_CUR) == 0) {
    reader++;
    read_of_reader = 0;
  }
  read_of_reader++;

  // DIR_READ_FAULT_READ is a number (that read of the reader fails) or "end" (the read that reports the end of
  // the directory fails in its place). DIR_READ_FAULT_ERRNO is the errno, or "removed": the library removes the
  // empty directory and the kernel fails the read.
  const char *when = reader == env_int("DIR_READ_FAULT_READER", 1) ? getenv("DIR_READ_FAULT_READ") : NULL;
  const char *code = getenv("DIR_READ_FAULT_ERRNO");
  int removed = code && strcmp(code, "removed") == 0;
  int injected = code && !removed ? atoi(code) : EIO;
  if (when && atoi(when) == read_of_reader) {
    if (!removed) return fail(injected);
    rmdir(path);
  }
  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
  int answered = errno;
  if (when && strcmp(when, "end") == 0 && rc == 0) return fail(injected);
  note(rc < 0 ? "failed" : "ok", rc < 0 ? answered : rc);
  errno = answered;
  return rc;
}
`;

  let shimDir: ReturnType<typeof tempDir>;
  let shim: string;
  let logs = 0;

  beforeAll(async () => {
    shimDir = tempDir("dir-read-fault", { "shim.c": SHIM_C });
    shim = join(shimDir, "shim.so");
    await using compile = spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(shimDir, "shim.c"), "-ldl"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      compile.stdout.text(),
      compile.stderr.text(),
      compile.exited,
    ]);
    if (exitCode !== 0) throw new Error(`failed to compile the shim:\n${stdout}${stderr}`);
  });

  afterAll(() => shimDir?.[Symbol.dispose]());

  type Fault = {
    /** The directory whose read fails. */
    dir: string;
    /**
     * Which read of the directory fails, counted from 1 for each reader. "end" is the read that reports the end of
     * the directory. Leave it out for a run in which no read fails.
     */
    read?: number | "end";
    /** Which walk of the directory, counted from 1 in the process. A walk starts with a read at offset 0. */
    reader?: number;
    /** "removed": the directory, which is empty, is removed before the read and the kernel answers ENOENT. */
    errno?: "EIO" | "removed";
  };

  /** The environment of a bun process in which the read fails, and the reads of the directory that the process made. */
  function failDirRead(fault: Fault) {
    const log = join(shimDir, `reads-${logs++}.log`);
    const preload = bunEnv.LD_PRELOAD;
    return {
      env: {
        ...bunEnv,
        LD_PRELOAD: preload ? `${shim}:${preload}` : shim,
        // The library compares with the link in /proc/self/fd, which is the real path.
        DIR_READ_FAULT_DIR: realpathSync(fault.dir),
        DIR_READ_FAULT_READ: fault.read === undefined ? undefined : String(fault.read),
        DIR_READ_FAULT_READER: String(fault.reader ?? 1),
        DIR_READ_FAULT_ERRNO: fault.errno === "removed" ? "removed" : String(constants.errno.EIO),
        DIR_READ_FAULT_LOG: log,
      },
      /** `ok`: the byte count of each read that the kernel answered (0 is the end). `failed`: the errno of each read that failed. */
      reads() {
        const reads = { ok: [] as number[], failed: [] as number[] };
        if (!existsSync(log)) return reads;
        for (const line of readFileSync(log, "utf8").split("\n")) {
          const match = line.match(/: (ok|failed) (-?\d+)$/);
          if (match) reads[match[1] as "ok" | "failed"].push(Number(match[2]));
        }
        return reads;
      },
    };
  }

  async function bun(args: string[], cwd: string, env: Record<string, string | undefined>) {
    await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: normalizeBunSnapshot(stdout, cwd), err: normalizeBunSnapshot(stderr, cwd), exitCode };
  }

  const readFailed = (subpath: string) =>
    `EIO: Input/output error: failed to read directory "${subpath}" for packing (getdents64)`;

  const index = "module.exports = 1;";

  test.concurrent.each([
    // One row for each loop that reads a directory. `dir` is the directory whose first read fails.
    { walk: "the default walk, a subdirectory", packageJson: {}, files: { "lib/index.js": index }, dir: "lib" },
    // The resolver reads the package root before pack does: pack is the second reader.
    { walk: "the default walk, the package root", packageJson: {}, files: { "index.js": index }, dir: "", reader: 2 },
    {
      walk: '"files" with a directory',
      packageJson: { files: ["lib"] },
      files: { "lib/index.js": index },
      dir: "lib",
    },
    {
      walk: '"files" with a glob',
      packageJson: { files: ["lib/*.js"] },
      files: { "lib/index.js": index },
      dir: "lib",
    },
    // pack reads every directory, and cannot know that the entries it did not read match nothing.
    {
      walk: '"files", a directory that no pattern names',
      packageJson: { files: ["lib"] },
      files: { "lib/index.js": index, "other/index.js": index },
      dir: "other",
    },
    {
      walk: "directories.bin",
      packageJson: { directories: { bin: "bin" } },
      files: { "bin/cli.js": index },
      dir: "bin",
    },
    {
      walk: "bundledDependencies, the dependency",
      packageJson: { bundledDependencies: ["dep"] },
      files: { "node_modules/dep/package.json": "{}" },
      dir: "node_modules/dep",
    },
    // Every entry was read when this read fails. pack cannot know that.
    {
      walk: "the read that reports the end of the directory",
      packageJson: {},
      files: { "lib/index.js": index },
      dir: "lib",
      read: "end" as const,
    },
    { walk: "--dry-run", packageJson: {}, files: { "lib/index.js": index }, dir: "lib", args: ["--dry-run"] },
  ])("bun pm pack: $walk", async ({ packageJson, files, dir: subpath, reader, read = 1, args = [] }) => {
    using dir = tempDir("pack-read-fails", {
      "package.json": JSON.stringify({ name: "pack-read-fails", version: "1.0.0", ...packageJson }),
      ...files,
    });
    const before = await sortedNames(dir);
    const fault = failDirRead({ dir: join(dir, subpath), read, reader });

    const { out, err, exitCode } = await bun(["pm", "pack", ...args], dir, fault.env);
    // If no read failed, the library did not interpose and this row shows nothing.
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(readFailed(subpath || "."));
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(await sortedNames(dir)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun pm pack: the second read of a directory of 300 files", async () => {
    // Before: a tarball with 255 of the 301 files, `Total files: 255`, exit 0.
    using dir = tempDir("pack-read-fails-300", {
      "package.json": JSON.stringify({ name: "pack-read-fails-300", version: "1.0.0" }),
      ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`lib/big/f${i}.js`, `${i}`])),
    });
    const fault = failDirRead({ dir: join(dir, "lib", "big"), read: 2 });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads()).toEqual({ ok: [expect.any(Number)], failed: [constants.errno.EIO] });
    expect(err).toBe(readFailed("lib/big"));
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(await sortedNames(dir)).toEqual(["lib", "package.json"]);
    expect(exitCode).toBe(1);
  });

  // pack opens a directory when its parent lists it and reads it later. A directory that is removed in between fails
  // the read with ENOENT, which libc's readdir() and so npm report as the end of the directory.
  test.concurrent("bun pm pack: a directory that is removed after pack opened it has no entries", async () => {
    using dir = tempDir("pack-read-removed", {
      "package.json": JSON.stringify({ name: "pack-read-removed", version: "1.0.0" }),
      "lib/index.js": index,
      "lib/gone": {},
    });
    const fault = failDirRead({ dir: join(dir, "lib", "gone"), read: 1, errno: "removed" });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads()).toEqual({ ok: [], failed: [constants.errno.ENOENT] });
    expect(err).toBe("");
    expect(out).toContain("Total files: 2");
    expect(await sortedNames(join(dir, "lib"))).toEqual(["index.js"]);
    expect(tarballEntries(join(dir, "pack-read-removed-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/lib/index.js",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun pm pack: postpack does not run", async () => {
    using dir = tempDir("pack-read-fails-scripts", {
      "package.json": JSON.stringify({
        name: "pack-read-fails-scripts",
        version: "1.0.0",
        scripts: { prepack: "touch prepack.txt", postpack: "touch postpack.txt" },
      }),
      "lib/index.js": index,
    });
    const fault = failDirRead({ dir: join(dir, "lib"), read: 1 });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err.split("\n")).toEqual(["$ touch prepack.txt", readFailed("lib")]);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(await sortedNames(dir)).toEqual(["lib", "package.json", "prepack.txt"]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun pm pack: no read fails and the library changes nothing", async () => {
    using dir = tempDir("pack-read-healthy", {
      "package.json": JSON.stringify({ name: "pack-read-healthy", version: "1.0.0" }),
      "lib/index.js": index,
    });
    const fault = failDirRead({ dir: join(dir, "lib") });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    // One read with the entries, then the end of the directory.
    expect(fault.reads()).toEqual({ ok: [expect.any(Number), 0], failed: [] });
    expect(err).toBe("");
    expect(out).toContain("Total files: 2");
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(dir, "pack-read-healthy-1.0.0.tgz"))).toEqual([
      "package/package.json",
      "package/lib/index.js",
    ]);
  });

  // A bundled dependency is opened by its path. pack used to list these directories to find it, and their first read would fail.
  test.concurrent.each([
    { name: "dep", listed: "node_modules" },
    { name: "@scope/dep", listed: "node_modules/@scope" },
  ])("bun pm pack: bundledDependencies does not read $listed", async ({ name, listed }) => {
    using dir = tempDir("pack-read-not-listed", {
      "package.json": JSON.stringify({ name: "pack-read-not-listed", version: "1.0.0", bundledDependencies: [name] }),
      [`node_modules/${name}/package.json`]: "{}",
    });
    const fault = failDirRead({ dir: join(dir, listed), read: 1 });

    const { err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads()).toEqual({ ok: [], failed: [] });
    expect(err).toBe("");
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(dir, "pack-read-not-listed-1.0.0.tgz"))).toEqual([
      "package/package.json",
      `package/node_modules/${name}/package.json`,
    ]);
  });

  // A registry that counts the requests it receives.
  function countingRegistry() {
    const registry = {
      requests: 0,
      bunfig: "",
      [Symbol.dispose]: () => void server.stop(true),
    };
    const server = Bun.serve({
      port: 0,
      fetch() {
        registry.requests++;
        return new Response("OK", { status: 200 });
      },
    });
    registry.bunfig = Bun.TOML.stringify({
      install: { cache: false, registry: { url: `http://localhost:${server.port}`, token: "unused" } },
    });
    return registry;
  }

  test.concurrent.each([
    { walk: "the walk of the package", packageJson: {}, dir: "lib" },
    // The resolver reads the package root first, then the scan for the README. Before: published without `readme`.
    { walk: "the scan for the README", packageJson: {}, dir: "", reader: 2 },
    // `directories.bin` is read twice: the walk packs its files, then publish lists them as the `bin` entries of the
    // manifest. Before: the registry received a manifest without the entries that the second read did not return.
    {
      walk: "the `bin` entries of directories.bin",
      packageJson: { directories: { bin: "lib" } },
      dir: "lib",
      reader: 2,
    },
  ])("bun publish: $walk", async ({ packageJson, dir: subpath, reader }) => {
    using registry = countingRegistry();
    using dir = tempDir("publish-read-fails", {
      "package.json": JSON.stringify({ name: "publish-read-fails", version: "1.0.0", ...packageJson }),
      "bunfig.toml": registry.bunfig,
      "README.md": "# publish-read-fails",
      "lib/index.js": index,
    });
    const before = await sortedNames(dir);
    const fault = failDirRead({ dir: join(dir, subpath), read: 1, reader });

    const { out, err, exitCode } = await bun(["publish"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(readFailed(subpath || "."));
    expect(out).toBe("bun publish <version> (<revision>)");
    expect(registry.requests).toBe(0);
    expect(await sortedNames(dir)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  // A folder with a package.json is read as `bun pm pack` would publish it. The diff listed the files it did not
  // read as added or removed and exited 0.
  test.concurrent("bun pm diff: a folder", async () => {
    using dir = tempDir("pm-diff-read-fails", {
      "a/package.json": JSON.stringify({ name: "p", version: "1.0.0" }),
      "a/lib/index.js": "module.exports = 1;\n",
      "b/package.json": JSON.stringify({ name: "p", version: "1.0.0" }),
      "b/lib/index.js": "module.exports = 1;\n",
    });
    const fault = failDirRead({ dir: join(dir, "a", "lib"), read: 1 });

    const { out, err, exitCode } = await bun(["pm", "diff", "./a", "./b", "--name-only"], dir, {
      ...fault.env,
      NO_COLOR: "1",
    });
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(readFailed("lib"));
    expect(out).toBe("");
    expect(exitCode).toBe(1);
  });
});

describe.concurrent.each([
  ["ESC [ 2 K", "\x1b[2K", "\\x1b[2K"],
  ["CR", "\r", "\\r"],
  ["BEL", "\x07", "\\x07"],
  ["U+009B", "\u009b2K", "\\u009b2K"],
  ["OSC 52", "\x1b]52;c;aGk=\x07", "\\x1b]52;c;aGk=\\x07"],
])("%s is printed spelled out", (_, raw, spelled) => {
  const unprintable = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;

  test.skipIf(isWindows)("in a file name", async () => {
    using dir = tempDir("pack-file-name", {
      "package.json": JSON.stringify({ name: "pack-file-name", version: "1.0.0" }),
      [`a${raw}b.js`]: "x",
    });
    for (const args of [["--dry-run"], []]) {
      const { stdout, stderr, exitCode } = await runPack(dir, args);
      expect(stdout).toContain(`packed 1B a${spelled}b.js\n`);
      expect(stdout + stderr).not.toMatch(unprintable);
      expect(exitCode).toBe(0);
    }
    expect(tarballEntries(join(dir, "pack-file-name-1.0.0.tgz"))).toContain(`package/a${raw}b.js`);
  });

  test("in the name of the package", async () => {
    using dir = tempDir("pack-package-name", {
      "package.json": JSON.stringify({ name: `a${raw}b`, version: "1.0.0" }),
    });
    const { stdout, stderr, exitCode } = await runPack(dir, ["--dry-run"]);
    expect(stdout).toContain(`\na${spelled}b-1.0.0.tgz\n`);
    expect(stdout + stderr).not.toMatch(unprintable);
    expect(exitCode).toBe(0);
  });

  test("in an error", async () => {
    using dir = tempDir("pack-dependency-name", {
      "package.json": JSON.stringify({
        name: "pack-dependency-name",
        version: "1.0.0",
        dependencies: { [`a${raw}b`]: "workspace:*" },
      }),
    });
    const { out, err } = await packExpectError(dir);
    expect(err).toStartWith(`error: Failed to resolve workspace version for "a${spelled}b" in \`dependencies\``);
    expect(out + err).not.toMatch(unprintable);
  });
});
