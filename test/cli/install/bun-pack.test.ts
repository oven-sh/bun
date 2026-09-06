import { write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { readdir, rm } from "fs/promises";
import { bunEnv, bunExe, isLinux, isWindows, normalizeBunSnapshot, runBunInstall, tempDir } from "harness";
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
    { input: "@//", error: 'error: failed to open tarball file destination: "<dir>/-/-1.1.1.tgz"' },
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
      filename,
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
    expect(err).toMatchInlineSnapshot(`"error: failed to open tarball file destination: "out/foo.tgz""`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["index.js", "package.json"]);
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

  test("fails gracefully when workspace version fails to resolve", async () => {
    using dir = tempDir("pack-workspace-protocol-fail", {
      "package.json": JSON.stringify({
        name: "pack-workspace-protocol-fail",
        version: "2.2.3",
        workspaces: ["pkgs/*"],
        dependencies: {
          "pkg1": "workspace:*",
        },
      }),
      "root.js": "console.log('hello ./root.js')",
      "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.1.1" }),
    });

    const failed = await runPack(dir);
    expect(failed.err).toMatchInlineSnapshot(
      `"error: Failed to resolve workspace version for "pkg1" in \`dependencies\`. Run \`bun install\` and try again."`,
    );
    expect(failed.out).toBe("bun pack <version> (<revision>)");
    expect(failed.exitCode).toBe(1);
    expect(await sortedNames(dir)).toEqual(["package.json", "pkgs", "root.js"]);

    await runBunInstall(bunEnv, String(dir));
    const { out, err, exitCode } = await runPack(dir);
    expect(err).toBe("");
    expect(out).toMatchInlineSnapshot(`
      "bun pack <version> (<revision>)

      packed 139B package.json
      packed 33B pkgs/pkg1/package.json
      packed 30B root.js

      pack-workspace-protocol-fail-2.2.3.tgz

      Total files: 3
      Shasum: <shasum>
      Integrity: <integrity>
      Unpacked size: 202B
      Packed size: <packed size>"
    `);
    expect(exitCode).toBe(0);

    const tarball = readTarball(join(dir, "pack-workspace-protocol-fail-2.2.3.tgz"));
    expect(entryNames(tarball)).toEqual(["package/package.json", "package/pkgs/pkg1/package.json", "package/root.js"]);
    expect(JSON.parse(tarball.entries[0].contents)).toEqual({
      name: "pack-workspace-protocol-fail",
      version: "2.2.3",
      workspaces: ["pkgs/*"],
      dependencies: {
        "pkg1": "1.1.1",
      },
    });
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
      bundled dep3
      bundled dep2

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
