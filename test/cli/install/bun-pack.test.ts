import { file, gunzipSync, spawn, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { beforeEach, describe, expect, test } from "bun:test";
import { chmod, exists, lstat, mkdir, rm, symlink } from "fs/promises";
import { MAX_PATH_BYTES, bunEnv, bunExe, isLinux, isWindows, pack, runBunInstall, tempDir, tmpdirSync, unprivilegedSpawnOptions } from "harness";
import fs from "node:fs/promises";
import { join } from "path";

var packageDir: string;

beforeEach(() => {
  packageDir = tmpdirSync();
});

async function packExpectError(cwd: string, env: NodeJS.Dict<string>, ...args: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "pack", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });

  const err = await stderr.text();
  expect(err).not.toContain("panic:");

  const out = await stdout.text();

  const exitCode = await exited;
  expect(exitCode).toBeGreaterThan(0);

  return { out, err };
}

test("basic", async () => {
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-basic",
        version: "1.2.3",
      }),
    ),
    write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
  ]);

  await pack(packageDir, bunEnv);

  const tarball = readTarball(join(packageDir, "pack-basic-1.2.3.tgz"));
  expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/index.js" }]);
});

// The archive ends right after the two end-of-archive blocks. libarchive's default for a custom
// output sink would pad it to a full 10 KiB record instead, which would change the size and shasum
// of every tarball bun produces.
test("the archive is not padded to a full tar record", async () => {
  await Promise.all([
    write(join(packageDir, "package.json"), JSON.stringify({ name: "pack-unpadded", version: "1.0.0" })),
    write(join(packageDir, "index.js"), "module.exports = 1;"),
  ]);

  await pack(packageDir, bunEnv);

  const tar = gunzipSync(await file(join(packageDir, "pack-unpadded-1.0.0.tgz")).bytes());
  // header + data for each of the two entries, then the two end-of-archive blocks
  expect(tar.byteLength).toBe(6 * 512);
});

// pack only reads package.json, so a file that is readable but not writable (a read-only
// checkout, a file owned by another user) must not stop it.
test.skipIf(isWindows)("read-only package.json", async () => {
  using dir = tempDir("pack-read-only", {
    "package.json": JSON.stringify({ name: "pack-read-only", version: "1.2.3" }),
    "index.js": "console.log('hello ./index.js')",
  });
  await fs.chmod(join(String(dir), "package.json"), 0o444);
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

test("in subdirectory", async () => {
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-from-subdir",
        version: "7.7.7",
      }),
    ),
    mkdir(join(packageDir, "subdir1", "subdir2"), { recursive: true }),
    write(join(packageDir, "root.js"), "console.log(`hello ./root.js`);"),
    write(join(packageDir, "subdir1", "subdir2", "index.js"), "console.log(`hello ./subdir1/subdir2/index.js`);"),
  ]);

  await pack(join(packageDir, "subdir1", "subdir2"), bunEnv);

  const first = readTarball(join(packageDir, "pack-from-subdir-7.7.7.tgz"));
  expect(first.entries).toMatchObject([
    { "pathname": "package/package.json" },
    { "pathname": "package/root.js" },
    { "pathname": "package/subdir1/subdir2/index.js" },
  ]);

  await rm(join(packageDir, "pack-from-subdir-7.7.7.tgz"));

  await pack(join(packageDir, "subdir1"), bunEnv);

  const second = readTarball(join(packageDir, "pack-from-subdir-7.7.7.tgz"));
  expect(first).toEqual(second);
});

describe("package.json names and versions", () => {
  test("rejects name and version containing parent directory components", async () => {
    const projectDir = join(packageDir, "nested", "project");
    await mkdir(projectDir, { recursive: true });
    await Promise.all([
      write(
        join(projectDir, "package.json"),
        JSON.stringify({
          name: "../../outside-pkg",
          version: "1.0.0",
        }),
      ),
      write(join(projectDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const { err } = await packExpectError(projectDir, bunEnv);
    expect(err).toContain("package.json `name` and `version` fields");

    // the tarball must not be created at the location the ".." segments resolve to,
    // nor anywhere inside the project directory
    expect(await exists(join(packageDir, "outside-pkg-1.0.0.tgz"))).toBeFalse();
    expect(await exists(join(projectDir, "outside-pkg-1.0.0.tgz"))).toBeFalse();

    // a version with ".." segments is rejected the same way
    await write(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "pack-traversal-check",
        version: "../1.0.0",
      }),
    );
    const { err: versionErr } = await packExpectError(projectDir, bunEnv);
    expect(versionErr).toContain("package.json `name` and `version` fields");

    // a normal name and version still packs into the project directory
    await write(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "pack-traversal-check",
        version: "1.0.0",
      }),
    );
    await pack(projectDir, bunEnv);
    const tarball = readTarball(join(projectDir, "pack-traversal-check-1.0.0.tgz"));
    expect(tarball.entries).toHaveLength(2);
  });

  const tests = [
    {
      desc: "missing name",
      expectedError: "package.json must have `name` and `version` fields",
      packageJson: {
        version: "1.1.1",
      },
    },
    {
      desc: "missing version",
      expectedError: "package.json must have `name` and `version` fields",
      packageJson: {
        name: "pack-invalid",
      },
    },
    {
      desc: "missing name and version",
      expectedError: "package.json must have `name` and `version` fields",
      packageJson: {
        description: "ooops",
      },
    },
    {
      desc: "empty name",
      expectedError: "package.json `name` and `version` fields must be non-empty strings",
      packageJson: {
        name: "",
        version: "1.1.1",
      },
    },
    {
      desc: "empty version",
      expectedError: "package.json `name` and `version` fields must be non-empty strings",
      packageJson: {
        name: "pack-invalid",
        version: "",
      },
    },
    {
      desc: "empty name and version",
      expectedError: "package.json `name` and `version` fields must be non-empty strings",
      packageJson: {
        name: "",
        version: "",
      },
    },
  ];

  for (const { desc, expectedError, packageJson } of tests) {
    test(desc, async () => {
      await Promise.all([
        write(join(packageDir, "package.json"), JSON.stringify(packageJson)),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      ]);

      const { err } = await packExpectError(packageDir, bunEnv);
      expect(err).toContain(expectedError);
    });
  }

  test("missing", async () => {
    await write(join(packageDir, "index.js"), "console.log('hello ./index.js')");

    const { err } = await packExpectError(packageDir, bunEnv);
    expect(err).toContain(`error: No package.json was found for directory "${packageDir}`);
  });

  const scopedNames = [
    {
      input: "@scoped/pkg",
      output: "scoped-pkg-1.1.1.tgz",
    },
    {
      input: "@",
      output: "-1.1.1.tgz",
    },
    {
      input: "@/",
      output: "--1.1.1.tgz",
    },
    {
      input: "//",
      output: "-1.1.1.tgz",
    },
    {
      input: "@//",
      fail: true,
      output: "",
    },
    {
      input: "@/s",
      output: "-s-1.1.1.tgz",
    },
    {
      input: "@s",
      output: "s-1.1.1.tgz",
    },
  ];
  for (const { input, output, fail } of scopedNames) {
    test(`scoped name: ${input}`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: input,
            version: "1.1.1",
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      ]);

      fail ? await packExpectError(packageDir, bunEnv) : await pack(packageDir, bunEnv);
      if (!fail) {
        const tarball = readTarball(join(packageDir, output));
        expect(tarball.entries).toHaveLength(2);
      }
    });
  }
});

describe("flags", () => {
  test("--dry-run", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-dry-run",
          version: "1.1.1",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const { out } = await pack(packageDir, bunEnv, "--dry-run");

    expect(out).toContain("files: 2");

    expect(await exists(join(packageDir, "pack-dry-run-1.1.1.tgz"))).toBeFalse();
  });
  test("--gzip", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-gzip-test",
          version: "111111.1.11111111111111",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    for (const invalidGzipLevel of ["-1", "10", "kjefj"]) {
      const { err } = await packExpectError(packageDir, bunEnv, `--gzip-level=${invalidGzipLevel}`);
      expect(err).toContain(`error: compression level must be between 0 and 9, received ${invalidGzipLevel}\n`);
    }

    await pack(packageDir, bunEnv, "--gzip-level=0");
    const largerTarball = readTarball(join(packageDir, "pack-gzip-test-111111.1.11111111111111.tgz"));
    expect(largerTarball.entries).toHaveLength(2);

    await rm(join(packageDir, "pack-gzip-test-111111.1.11111111111111.tgz"));

    await pack(packageDir, bunEnv, "--gzip-level=9");
    const smallerTarball = readTarball(join(packageDir, "pack-gzip-test-111111.1.11111111111111.tgz"));
    expect(smallerTarball.entries).toHaveLength(2);

    expect(smallerTarball.size).toBeLessThan(largerTarball.size);
  });

  const destinationTests = [
    {
      "path": "",
    },
    {
      "path": "dest-dir",
    },
    {
      "path": "more/dir",
    },
  ];

  for (const { path } of destinationTests) {
    test(`--destination="${path}"`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-dest-test",
            version: "1.1.1",
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      ]);

      const dest = join(packageDir, path);
      await pack(packageDir, bunEnv, `--destination=${dest}`);

      const tarball = readTarball(join(dest, "pack-dest-test-1.1.1.tgz"));
      expect(tarball.entries).toHaveLength(2);
    });
  }

  // The destination directory ends `headroom` bytes short of the path buffer, so it still fits,
  // but the longer "/<name>-<version>.tgz" appended to it does not. Windows command lines cannot
  // carry an argument anywhere near its path buffer size.
  test.skipIf(isWindows)("--destination with no room left for the tarball name", async () => {
    const pathMax = isLinux ? 4096 : 1024;
    const headroom = 100;
    const name = `pack-dest-too-long-${Buffer.alloc(2 * headroom, "n").toString()}`;
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    // packageDir + "/" + filler is `headroom` bytes short of the buffer
    const filler = Buffer.alloc(pathMax - headroom - Buffer.byteLength(packageDir) - 1, "d").toString();
    const dest = join(packageDir, filler);
    const { err } = await packExpectError(packageDir, bunEnv, `--destination=${dest}`);
    expect(err).toContain(`error: archive destination name too long: "${dest}/${name}-1.0.0.tgz"\n`);
  });

  const filenameTests = [
    {
      filename: "test.tgz",
      error: false,
    },
    {
      filename: "no-extension",
      error: false,
    },
    {
      filename: "no-extension.tar",
      error: false,
    },
    {
      filename: "out/foo.tgz",
      error: true,
    },
    {
      filename: "out/foo.tar",
      mkdir: "out",
      error: false,
    },
  ];

  for (const { filename, error, mkdir } of filenameTests) {
    test(`--filename="${filename}"`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-dest-test",
            version: "1.1.1",
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      ]);

      const dest = join(packageDir, filename);
      if (mkdir) await fs.mkdir(join(packageDir, mkdir));

      try {
        await pack(packageDir, bunEnv, `--filename=${filename}`);

        const tarball = readTarball(dest);
        expect(tarball.entries).toHaveLength(2);
      } catch (packError) {
        if (!error) expect(packError).toBeNil();
      }
    });
  }

  test("--filename and --destination", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-dest-test",
          version: "1.1.1",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const { err } = await packExpectError(packageDir, bunEnv, "--filename=test.tgz", "--destination=packed");
    expect(err).toContain(
      'error: cannot use both filename and destination at the same time with tarball: filename "test.tgz" and destination "packed"',
    );
    expect(await exists(join(packageDir, "test.tgz"))).toBeFalse();
    expect(await exists(join(packageDir, "packed"))).toBeFalse();
  });

  // On Windows the path buffer is larger than any command line, so the overflow cannot be reached there.
  describe.skipIf(isWindows)("--destination longer than the path buffer", () => {
    const longName = Buffer.alloc(MAX_PATH_BYTES + 1, "d").toString();
    const packageJson = JSON.stringify({ name: "pack-long-dest", version: "1.0.0" });
    const expectedError = `error: archive destination name too long: "${longName}/pack-long-dest-1.0.0.tgz"\n`;

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
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
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
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    await pack(packageDir, bunEnv, "--ignore-scripts");

    let results = await Promise.all([
      exists(join(packageDir, "prepack.txt")),
      exists(join(packageDir, "postpack.txt")),
      exists(join(packageDir, "preprepare.txt")),
      exists(join(packageDir, "prepare.txt")),
      exists(join(packageDir, "postprepare.txt")),
    ]);

    expect(results).toEqual([false, false, false, false, false]);

    await pack(packageDir, bunEnv);

    results = await Promise.all([
      exists(join(packageDir, "prepack.txt")),
      exists(join(packageDir, "postpack.txt")),
      exists(join(packageDir, "preprepare.txt")),
      exists(join(packageDir, "prepare.txt")),
      exists(join(packageDir, "postprepare.txt")),
    ]);

    expect(results).toEqual([true, true, false, true, false]);
  });

  test("--quiet", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-quiet-test",
          version: "1.1.1",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const { out } = await pack(packageDir, bunEnv, "--quiet");

    // Should not contain verbose output
    expect(out).not.toContain("Total files:");
    expect(out).not.toContain("Shasum:");
    expect(out).not.toContain("Integrity:");
    expect(out).not.toContain("Unpacked size:");
    expect(out).not.toContain("Packed size:");
    expect(out).not.toContain("bun pack v");

    // Exactly the tarball name with no leading newline, so `$(bun pm pack --quiet)` works.
    expect(out).toBe("pack-quiet-test-1.1.1.tgz\n");

    // Should still create the tarball
    expect(await exists(join(packageDir, "pack-quiet-test-1.1.1.tgz"))).toBeTrue();
  });

  test("--silent", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-silent-test",
          version: "1.1.1",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const { out } = await pack(packageDir, bunEnv, "--silent");

    expect(out).toBe("pack-silent-test-1.1.1.tgz\n");
    expect(await exists(join(packageDir, "pack-silent-test-1.1.1.tgz"))).toBeTrue();
  });

  test("--quiet with --destination", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-quiet-dest-test",
          version: "1.1.1",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const dest = join(packageDir, "out");
    const { out } = await pack(packageDir, bunEnv, "--quiet", `--destination=${dest}`);

    const tarballPath = join(dest, "pack-quiet-dest-test-1.1.1.tgz");
    expect(out).toBe(`${tarballPath}\n`);
    expect(await exists(tarballPath)).toBeTrue();
  });

  test("--quiet with --dry-run", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-quiet-dry-test",
          version: "1.1.1",
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
    ]);

    const { out } = await pack(packageDir, bunEnv, "--quiet", "--dry-run");
    expect(out).toBe("pack-quiet-dry-test-1.1.1.tgz\n");

    const dest = join(packageDir, "out");
    const { out: destOut } = await pack(packageDir, bunEnv, "--quiet", "--dry-run", `--destination=${dest}`);
    expect(destOut).toBe(`${join(dest, "pack-quiet-dry-test-1.1.1.tgz")}\n`);

    // --dry-run never writes the tarball.
    expect(await exists(join(packageDir, "pack-quiet-dry-test-1.1.1.tgz"))).toBeFalse();
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

        const { err } = await packExpectError(String(dir), bunEnv, `--filename=${longName}`);

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
    { args: [], tarball: "pack-failed-1.0.0.tgz" },
    { args: ["--destination=out"], tarball: join("out", "pack-failed-1.0.0.tgz") },
    { args: ["--filename=custom.tgz"], tarball: "custom.tgz" },
  ])("when the tarball cannot be written (args: $args)", async ({ args, tarball }) => {
    await using dir = tempDir("pack-failed", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
    });

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: true }, ...args);

    expect(err).toContain("EFBIG");
    expect(err).toContain('failed to write tarball: "');
    expect({ exitCode, tarballExists: await exists(join(dir, tarball)) }).toEqual({
      exitCode: 1,
      tarballExists: false,
    });
  });

  // Root can read a mode 000 file, so this one only runs as a regular user.
  test.concurrent.skipIf(process.getuid?.() === 0)("when one of the files cannot be opened", async () => {
    await using dir = tempDir("pack-failed-unreadable", {
      "package.json": packageJson,
      "index.js": "module.exports = 1;",
      "unreadable.js": "module.exports = 2;",
    });
    await chmod(join(dir, "unreadable.js"), 0o000);

    const { err, exitCode } = await packExpectingFailure(dir, { fileSizeLimit: false });

    expect(err).toContain('EACCES: Permission denied: failed to open file: "unreadable.js"');
    expect({ exitCode, tarballExists: await exists(join(dir, "pack-failed-1.0.0.tgz")) }).toEqual({
      exitCode: 1,
      tarballExists: false,
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

    expect(err).toContain('failed to write tarball: "link.tgz"');
    expect({ exitCode, linkIsSymlink: (await lstat(join(dir, "link.tgz"))).isSymbolicLink() }).toEqual({
      exitCode: 1,
      linkIsSymlink: true,
    });
  });

  // A destination that cannot even be opened was not written to, so it is left as it is (root can
  // open a read-only file, hence the skip).
  test.concurrent.skipIf(process.getuid?.() === 0)("keeps a destination it cannot open for writing", async () => {
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
});

test("shasum and integrity are consistent", async () => {
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-shasum",
        version: "1.1.1",
      }),
    ),
    write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
  ]);

  let { out } = await pack(packageDir, bunEnv);

  const tarball = readTarball(join(packageDir, "pack-shasum-1.1.1.tgz"));
  expect(tarball.entries).toMatchObject([
    {
      "pathname": "package/package.json",
    },
    {
      "pathname": "package/index.js",
    },
  ]);

  expect(out).toContain(`Shasum: ${tarball.shasum}`);

  await rm(join(packageDir, "pack-shasum-1.1.1.tgz"));

  ({ out } = await pack(packageDir, bunEnv));

  const secondTarball = readTarball(join(packageDir, "pack-shasum-1.1.1.tgz"));
  expect(secondTarball.entries).toMatchObject([
    {
      "pathname": "package/package.json",
    },
    {
      "pathname": "package/index.js",
    },
  ]);

  expect(out).toContain(`Shasum: ${secondTarball.shasum}`);
  expect(tarball.shasum).toBe(secondTarball.shasum);
  expect(tarball.integrity).toBe(secondTarball.integrity);
});

describe("workspaces", () => {
  async function createBasicWorkspace() {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-workspace",
          version: "2.2.2",
          workspaces: ["pkgs/*"],
        }),
      ),
      write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
      write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
      write(join(packageDir, "pkgs", "pkg1", "index.js"), "console.log('hello ./index.js')"),
    ]);
  }
  test("in a workspace", async () => {
    await createBasicWorkspace();
    await pack(join(packageDir, "pkgs", "pkg1"), bunEnv);

    const tarball = readTarball(join(packageDir, "pkgs", "pkg1", "pkg1-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/index.js" }]);
  });
  test("in a workspace subdirectory", async () => {
    await createBasicWorkspace();
    await mkdir(join(packageDir, "pkgs", "pkg1", "subdir"));

    await pack(join(packageDir, "pkgs", "pkg1", "subdir"), bunEnv);

    const tarball = readTarball(join(packageDir, "pkgs", "pkg1", "pkg1-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/index.js" }]);
  });

  describe("lifecycle scripts describe the workspace member being packed", () => {
    const echoPackageEnv = "$npm_package_name $npm_package_version $npm_package_json $npm_config_local_prefix";
    let pkg1Dir: string;
    let expectedLines: string[];

    beforeEach(async () => {
      pkg1Dir = join(packageDir, "pkgs", "pkg1");
      // npm_config_local_prefix is the workspace root, as with npm.
      const memberEnv = `pkg1 1.1.1 ${join(pkg1Dir, "package.json")} ${packageDir}`;
      expectedLines = [`prepack ${memberEnv}`, `postpack ${memberEnv}`];
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({ name: "pack-workspace", version: "2.2.2", workspaces: ["pkgs/*"] }),
        ),
        write(
          join(pkg1Dir, "package.json"),
          JSON.stringify({
            name: "pkg1",
            version: "1.1.1",
            scripts: {
              prepack: `echo prepack ${echoPackageEnv}`,
              postpack: `echo postpack ${echoPackageEnv}`,
              release: `'${bunExe()}' pm pack --dry-run`,
            },
          }),
        ),
      ]);
    });

    function lifecycleLines(out: string) {
      return out.split("\n").filter(line => line.startsWith("prepack ") || line.startsWith("postpack "));
    }

    test("bun pm pack in the member", async () => {
      const { out } = await pack(pkg1Dir, bunEnv, "--dry-run");
      expect(lifecycleLines(out)).toEqual(expectedLines);
    });

    test("bun pm pack from a member script", async () => {
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
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-workspace-protocol",
          version: "2.3.4",
          workspaces: ["pkgs/*"],
          dependencies: {
            "pkg1": "workspace:1.1.1",
          },
        }),
      ),
      write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
      write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-workspace-protocol-2.3.4.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/pkgs/pkg1/package.json" },
      { "pathname": "package/root.js" },
    ]);
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

  for (const { input, expected } of withLockfileWorkspaceProtocolTests) {
    test(`replaces workspace: protocol with lockfile: ${input}`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-workspace-protocol-with-lockfile",
            version: "2.5.6",
            workspaces: ["pkgs/*"],
            dependencies: {
              "pkg1": input,
            },
          }),
        ),
        write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
        write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
      ]);

      await runBunInstall(bunEnv, packageDir);
      await pack(packageDir, bunEnv);

      const tarball = readTarball(join(packageDir, "pack-workspace-protocol-with-lockfile-2.5.6.tgz"));
      expect(tarball.entries).toMatchObject([
        { "pathname": "package/package.json" },
        { "pathname": "package/pkgs/pkg1/package.json" },
        { "pathname": "package/root.js" },
      ]);
      expect(JSON.parse(tarball.entries[0].contents)).toEqual({
        name: "pack-workspace-protocol-with-lockfile",
        version: "2.5.6",
        workspaces: ["pkgs/*"],
        dependencies: {
          "pkg1": expected,
        },
      });
    });
  }

  test("resolves workspace:* from the workspace's package.json without a lockfile", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-workspace-protocol-no-lockfile",
          version: "2.2.3",
          workspaces: ["pkgs/*"],
          dependencies: {
            "pkg1": "workspace:*",
          },
        }),
      ),
      write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
      write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-workspace-protocol-no-lockfile-2.2.3.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/pkgs/pkg1/package.json" },
      { "pathname": "package/root.js" },
    ]);
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "1.1.1" });
  });

  test("fails when no workspace with a version matches a workspace:* dependency", async () => {
    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkgs/*"] })),
      write(join(packageDir, "pkgs", "unversioned", "package.json"), JSON.stringify({ name: "unversioned" })),
      write(
        join(packageDir, "pkgs", "app1", "package.json"),
        JSON.stringify({ name: "app1", version: "1.0.0", dependencies: { "not-a-workspace": "workspace:*" } }),
      ),
      write(
        join(packageDir, "pkgs", "app2", "package.json"),
        JSON.stringify({ name: "app2", version: "1.0.0", devDependencies: { "unversioned": "workspace:^" } }),
      ),
    ]);

    const app1 = await packExpectError(join(packageDir, "pkgs", "app1"), bunEnv);
    expect(app1.err).toContain('error: Failed to resolve workspace version for "not-a-workspace" in `dependencies` (');
    expect(app1.err).toContain(
      'package.json" has no workspace named "not-a-workspace", or its package.json has no version).',
    );
    expect(await exists(join(packageDir, "pkgs", "app1", "app1-1.0.0.tgz"))).toBeFalse();

    const app2 = await packExpectError(join(packageDir, "pkgs", "app2"), bunEnv);
    expect(app2.err).toContain('error: Failed to resolve workspace version for "unversioned" in `devDependencies` (');
    expect(app2.err).toContain(
      'package.json" has no workspace named "unversioned", or its package.json has no version).',
    );
    expect(await exists(join(packageDir, "pkgs", "app2", "app2-1.0.0.tgz"))).toBeFalse();
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
    const coreDir = join(packageDir, "packages", "core");
    const utilsDir = join(packageDir, "packages", "utils");

    await Promise.all([
      write(join(packageDir, "package.json"), rootPackageJson("^18.3.1")),
      write(join(coreDir, "package.json"), corePackageJson("1.2.3")),
      write(join(utilsDir, "package.json"), utilsPackageJson("0.4.0")),
    ]);
    await runBunInstall(bunEnv, packageDir);

    await Promise.all([
      write(join(packageDir, "package.json"), rootPackageJson("^19.1.0")),
      write(join(coreDir, "package.json"), corePackageJson("1.3.0")),
      write(join(utilsDir, "package.json"), utilsPackageJson("0.4.1")),
    ]);
    const lockfile = await file(join(packageDir, "bun.lock")).text();
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
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-workspace-root",
          version: "2.0.0",
          workspaces: ["pkgs/*"],
          dependencies: { "pkg1": "workspace:*" },
        }),
      ),
      write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
    ]);
    await runBunInstall(bunEnv, packageDir);
    await write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.2.0" }));

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-workspace-root-2.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "1.2.0" });
  });

  test("sees the versions a prepack script writes to other workspaces", async () => {
    const pkg1PackageJson = join(packageDir, "pkgs", "pkg1", "package.json");
    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkgs/*"] })),
      write(pkg1PackageJson, JSON.stringify({ name: "pkg1", version: "1.0.0" })),
      write(
        join(packageDir, "pkgs", "app", "package.json"),
        JSON.stringify({
          name: "app",
          version: "1.0.0",
          scripts: { prepack: `${bunExe()} bump-pkg1.js` },
          dependencies: { "pkg1": "workspace:*" },
        }),
      ),
      write(
        join(packageDir, "pkgs", "app", "bump-pkg1.js"),
        `require("fs").writeFileSync(${JSON.stringify(pkg1PackageJson)}, JSON.stringify({ name: "pkg1", version: "2.0.0" }));`,
      ),
    ]);
    await runBunInstall(bunEnv, packageDir);

    await pack(join(packageDir, "pkgs", "app"), bunEnv);

    const tarball = readTarball(join(packageDir, "pkgs", "app", "app-1.0.0.tgz"));
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
<<<<<<< HEAD
      "dependencies": {},
=======
      "devDependencies": {},
>>>>>>> feature
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
      await Promise.all([
        write(join(packageDir, "package.json"), JSON.stringify({ name: "pack-bad-lockfile", version: "1.0.0" })),
        write(join(packageDir, "index.js"), "module.exports = 1"),
        write(join(packageDir, lockfile), contents),
      ]);

      const { err } = await pack(packageDir, bunEnv);
      expect(err).toBe("");

      const tarball = readTarball(join(packageDir, "pack-bad-lockfile-1.0.0.tgz"));
      expect(tarball.entries).toMatchObject([
        { "pathname": "package/package.json" },
        { "pathname": "package/index.js" },
      ]);
    });

    test(`resolves workspace:* next to ${label}`, async () => {
      await Promise.all([
        write(join(packageDir, "package.json"), JSON.stringify({ name: "root", workspaces: ["pkgs/*"] })),
        write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.1.1" })),
        write(
          join(packageDir, "pkgs", "app", "package.json"),
          JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "pkg1": "workspace:*" } }),
        ),
        write(join(packageDir, lockfile), contents),
      ]);

      const { err } = await pack(join(packageDir, "pkgs", "app"), bunEnv);
      expect(err).toBe("");

      const tarball = readTarball(join(packageDir, "pkgs", "app", "app-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "1.1.1" });
    });
  }

  // Only the root's `workspaces` and catalogs are read to resolve a spec. Its own dependency sections
  // are `bun install`'s business: a `workspace:<range>` there is packed as written (see the table
  // above) and does not have to match the workspace, whether the root or a member is being packed.
  describe("a workspace: range in the root that no workspace satisfies", () => {
    beforeEach(async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "root",
            version: "1.0.0",
            workspaces: ["pkgs/*"],
            dependencies: { "pkg1": "workspace:9.9.9", "pkg2": "workspace:*" },
          }),
        ),
        write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.0.1" })),
        write(join(packageDir, "pkgs", "pkg2", "package.json"), JSON.stringify({ name: "pkg2", version: "2.0.0" })),
        write(
          join(packageDir, "pkgs", "app", "package.json"),
          JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "pkg2": "workspace:^" } }),
        ),
      ]);
    });

    test("packing the root", async () => {
      await pack(packageDir, bunEnv);

      const tarball = readTarball(join(packageDir, "root-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg1": "9.9.9", "pkg2": "2.0.0" });
    });

    test("packing a member", async () => {
      await pack(join(packageDir, "pkgs", "app"), bunEnv);

      const tarball = readTarball(join(packageDir, "pkgs", "app", "app-1.0.0.tgz"));
      expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({ "pkg2": "^2.0.0" });
    });
  });

  describe("a workspaces entry that does not exist", () => {
    beforeEach(async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({ name: "root", workspaces: ["pkgs/pkg1", "pkgs/app", "pkgs/plain", "pkgs/missing"] }),
        ),
        write(join(packageDir, "pkgs", "pkg1", "package.json"), JSON.stringify({ name: "pkg1", version: "1.0.0" })),
        write(
          join(packageDir, "pkgs", "app", "package.json"),
          JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "pkg1": "workspace:*" } }),
        ),
        write(join(packageDir, "pkgs", "plain", "package.json"), JSON.stringify({ name: "plain", version: "1.0.0" })),
      ]);
    });

    test("fails a pack that has to resolve a workspace: spec, with bun install's error", async () => {
      const { err } = await packExpectError(join(packageDir, "pkgs", "app"), bunEnv);
      expect(err).toContain('error: Workspace not found "pkgs/missing"');
      expect(err).toContain("package.json:1:");
      expect(await exists(join(packageDir, "pkgs", "app", "app-1.0.0.tgz"))).toBeFalse();
    });

    test("does not affect a pack that has nothing to resolve", async () => {
      const { err } = await pack(join(packageDir, "pkgs", "plain"), bunEnv);
      expect(err).toBe("");
      expect(await exists(join(packageDir, "pkgs", "plain", "plain-1.0.0.tgz"))).toBeTrue();
    });
  });

  // pkgs/ui depends on its sibling workspaces by directory (`workspace:../core`)
  async function createDirectoryWorkspace(uiDependencies: Record<string, Record<string, string>>) {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "root", workspaces: ["pkgs/*", "pkgs/@scoped/*"] }),
      ),
      write(join(packageDir, "pkgs", "core", "package.json"), JSON.stringify({ name: "@acme/core", version: "1.2.3" })),
      write(join(packageDir, "pkgs", "plain", "package.json"), JSON.stringify({ name: "plain", version: "0.5.0" })),
      write(
        join(packageDir, "pkgs", "@scoped", "thing", "package.json"),
        JSON.stringify({ name: "thing", version: "0.0.7" }),
      ),
      write(
        join(packageDir, "pkgs", "ui", "package.json"),
        JSON.stringify({ name: "@acme/ui", version: "2.0.0", ...uiDependencies }),
      ),
    ]);
  }

  test("replaces workspace: directories with the version of the workspace in that directory", async () => {
    await createDirectoryWorkspace({
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
    await runBunInstall(bunEnv, packageDir);

    await pack(join(packageDir, "pkgs", "ui"), bunEnv);

    const tarball = readTarball(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
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
    await createDirectoryWorkspace({});
    await write(
      join(packageDir, "package.json"),
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
    await runBunInstall(bunEnv, packageDir);
    // bumped after the install, so bun.lock still says 0.5.0
    await write(join(packageDir, "pkgs", "plain", "package.json"), JSON.stringify({ name: "plain", version: "0.6.0" }));

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-workspace-root-directories-3.0.0.tgz"));
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
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-workspace-bare-directory",
          version: "3.0.0",
          workspaces: ["core", "plain"],
          dependencies: { "bare": "workspace:core", "@acme/core": "workspace:core", "plain": "workspace:0.x" },
        }),
      ),
      write(join(packageDir, "core", "package.json"), JSON.stringify({ name: "@acme/core", version: "1.2.3" })),
      write(join(packageDir, "plain", "package.json"), JSON.stringify({ name: "plain", version: "0.5.0" })),
    ]);
    await runBunInstall(bunEnv, packageDir);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-workspace-bare-directory-3.0.0.tgz"));
    expect(tarball.entries[0]).toMatchObject({ pathname: "package/package.json" });
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({
      "bare": "npm:@acme/core@1.2.3",
      "@acme/core": "1.2.3",
      "plain": "0.x",
    });
  });

  test("replaces workspace: directories without a lockfile", async () => {
    await createDirectoryWorkspace({ dependencies: { "core": "workspace:../core", "plain": "workspace:../plain" } });

    await pack(join(packageDir, "pkgs", "ui"), bunEnv);

    const tarball = readTarball(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(JSON.parse(tarball.entries[0].contents).dependencies).toEqual({
      "core": "npm:@acme/core@1.2.3",
      "plain": "0.5.0",
    });
  });

  // `"core-star": "workspace:@acme/core@*"` installs workspace @acme/core under the name core-star
  test("replaces workspace: aliases with npm: aliases", async () => {
    await createDirectoryWorkspace({
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
    await runBunInstall(bunEnv, packageDir);

    await pack(join(packageDir, "pkgs", "ui"), bunEnv);

    const tarball = readTarball(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
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
    await createDirectoryWorkspace({
      dependencies: { "core": "workspace:@acme/core@*", "plain-caret": "workspace:plain@^" },
    });
    await runBunInstall(bunEnv, packageDir);
    // bumped after the install, so bun.lock still says 1.2.3
    await write(
      join(packageDir, "pkgs", "core", "package.json"),
      JSON.stringify({ name: "@acme/core", version: "1.3.0" }),
    );

    await pack(join(packageDir, "pkgs", "ui"), bunEnv);
    const installed = readTarball(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(JSON.parse(installed.entries[0].contents).dependencies).toEqual({
      "core": "npm:@acme/core@1.3.0",
      "plain-caret": "npm:plain@^0.5.0",
    });

    await rm(join(packageDir, "bun.lock"));
    await rm(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    await pack(join(packageDir, "pkgs", "ui"), bunEnv);
    const uninstalled = readTarball(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"));
    expect(uninstalled.entries[0].contents).toBe(installed.entries[0].contents);
  });

  test("fails when the workspace a workspace: alias installs has no version", async () => {
    await createDirectoryWorkspace({
      dependencies: { "core": "workspace:@acme/core@*" },
      devDependencies: { "no-version": "workspace:unversioned@^" },
    });
    await write(join(packageDir, "pkgs", "unversioned", "package.json"), JSON.stringify({ name: "unversioned" }));

    const { err } = await packExpectError(join(packageDir, "pkgs", "ui"), bunEnv);
    expect(err).toContain(
      'error: Failed to resolve workspace version for "no-version" in `devDependencies` (the package.json of workspace "unversioned" has no version).',
    );
    expect(await exists(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"))).toBeFalse();
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
      await createDirectoryWorkspace({ dependencies: { "plain": "workspace:../plain" }, [group]: { [name]: spec } });
      await write(join(packageDir, "unlisted", "package.json"), JSON.stringify({ name: "unlisted", version: "1.0.0" }));

      const { err } = await packExpectError(join(packageDir, "pkgs", "ui"), bunEnv);
      expect(err).toContain(`error: Failed to resolve workspace version for "${name}" in \`${group}\` (`);
      expect(err).toContain(
        `package.json" has no workspace named "${reported}" and no workspace in the directory "${spec.slice("workspace:".length)}").`,
      );
      expect(await exists(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"))).toBeFalse();
    });
  }

  test("fails when the workspace in a workspace: directory has no version", async () => {
    await createDirectoryWorkspace({ dependencies: { "no-version": "workspace:../unversioned" } });
    await write(join(packageDir, "pkgs", "unversioned", "package.json"), JSON.stringify({ name: "unversioned" }));

    const { err } = await packExpectError(join(packageDir, "pkgs", "ui"), bunEnv);
    expect(err).toContain(
      'error: Failed to resolve workspace version for "no-version" in `dependencies` (the package.json of workspace "unversioned" in the directory "../unversioned" has no version).',
    );
    expect(await exists(join(packageDir, "pkgs", "ui", "acme-ui-2.0.0.tgz"))).toBeFalse();
  });
});

test("lifecycle scripts execution order", async () => {
  const script = `const fs = require("fs");
  fs.writeFileSync(\`\${process.argv[2]}.txt\`, \`
prepack: \${fs.existsSync("prepack.txt")}
prepare: \${fs.existsSync("prepare.txt")}
postpack: \${fs.existsSync("postpack.txt")}
tarball: \${fs.existsSync("pack-lifecycle-order-1.1.1.tgz")}\`)`;

  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-lifecycle-order",
        version: "1.1.1",
        scripts: {
          prepack: `${bunExe()} script.js prepack`,
          postpack: `${bunExe()} script.js postpack`,
          prepare: `${bunExe()} script.js prepare`,
        },
      }),
    ),
    write(join(packageDir, "script.js"), script),
  ]);

  await pack(packageDir, bunEnv);

  const tarball = readTarball(join(packageDir, "pack-lifecycle-order-1.1.1.tgz"));
  expect(tarball.entries).toMatchObject([
    { "pathname": "package/package.json" },
    { "pathname": "package/prepack.txt" },
    { "pathname": "package/prepare.txt" },
    { "pathname": "package/script.js" },
  ]);

  const results = await Promise.all([
    file(join(packageDir, "prepack.txt")).text(),
    file(join(packageDir, "postpack.txt")).text(),
    file(join(packageDir, "prepare.txt")).text(),
  ]);

  expect(results).toEqual([
    "\nprepack: false\nprepare: false\npostpack: false\ntarball: false",
    "\nprepack: true\nprepare: true\npostpack: false\ntarball: true",
    "\nprepack: true\nprepare: false\npostpack: false\ntarball: false",
  ]);
});

test("lifecycle script modifying version updates tarball filename (#17195)", async () => {
  const updateScript = `const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = "2.0.0-snapshot.test";
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));`;

  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-version-update",
        version: "1.0.0",
        scripts: {
          prepack: `${bunExe()} update-version.js`,
        },
      }),
    ),
    write(join(packageDir, "update-version.js"), updateScript),
    write(join(packageDir, "index.js"), "module.exports = {};"),
  ]);

  await pack(packageDir, bunEnv);

  // The tarball filename should use the UPDATED version
  expect(await exists(join(packageDir, "pack-version-update-2.0.0-snapshot.test.tgz"))).toBeTrue();
  // The old version tarball should NOT exist
  expect(await exists(join(packageDir, "pack-version-update-1.0.0.tgz"))).toBeFalse();

  const tarball = readTarball(join(packageDir, "pack-version-update-2.0.0-snapshot.test.tgz"));
  expect(tarball.entries).toMatchObject([
    { "pathname": "package/package.json" },
    { "pathname": "package/index.js" },
    { "pathname": "package/update-version.js" },
  ]);
});

describe.concurrent("package.json that cannot be loaded", () => {
  test("unparsable package.json", async () => {
    using dir = tempDir("pack-unparsable-package-json", {
      "package.json": `{ "name": "pack-unparsable", "version": "1.0.0",`,
    });

    const { err } = await packExpectError(String(dir), bunEnv);
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

    const { err } = await packExpectError(String(dir), bunEnv);
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

    const { err } = await packExpectError(String(dir), bunEnv);
    expect(err).toMatch(/at .*package\.json:1:\d+/);
    expect(err).toMatch(/^ParserError: failed to parse package\.json: .*package\.json$/m);
    expect(await exists(join(String(dir), "pack-prepack-breaks-1.0.0.tgz"))).toBeFalse();
  });
});

describe("bundledDependnecies", () => {
  for (const bundledDependencies of ["bundledDependencies", "bundleDependencies"]) {
    test(`basic (${bundledDependencies})`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-bundled",
            version: "4.4.4",
            dependencies: {
              "dep1": "1.1.1",
            },
            [bundledDependencies]: ["dep1"],
          }),
        ),
        write(
          join(packageDir, "node_modules", "dep1", "package.json"),
          JSON.stringify({
            name: "dep1",
            version: "1.1.1",
          }),
        ),
      ]);

      await pack(packageDir, bunEnv);

      const tarball = readTarball(join(packageDir, "pack-bundled-4.4.4.tgz"));
      expect(tarball.entries).toMatchObject([
        { "pathname": "package/package.json" },
        { "pathname": "package/node_modules/dep1/package.json" },
      ]);
    });
  }

  test(`basic (bundledDependencies: true)`, async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
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
      ),
      write(
        join(packageDir, "node_modules", "dep1", "package.json"),
        JSON.stringify({
          name: "dep1",
          version: "1.1.1",
        }),
      ),
      write(
        join(packageDir, "node_modules", "dep2", "package.json"),
        JSON.stringify({
          name: "dep2",
          version: "1.1.1",
        }),
      ),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bundled-4.4.4.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/node_modules/dep1/package.json" },
    ]);
  });

  test(`scoped bundledDependencies`, async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bundled",
          version: "4.4.4",
          dependencies: {
            "@oven/bun": "1.1.1",
          },
          bundledDependencies: ["@oven/bun"],
        }),
      ),
      write(
        join(packageDir, "node_modules", "@oven", "bun", "package.json"),
        JSON.stringify({
          name: "@oven/bun",
          version: "1.1.1",
        }),
      ),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bundled-4.4.4.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/node_modules/@oven/bun/package.json" },
    ]);
  });

  test(`invalid bundledDependencies value should throw`, async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bundled",
          version: "4.4.4",
          bundledDependencies: "a",
        }),
      ),
    ]);

    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "pm", "pack"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });

    const err = await stderr.text();
    expect(err).toContain("error:");
    expect(err).toContain("to be a boolean or an array of strings");
    expect(err).not.toContain("warning:");
    expect(err).not.toContain("failed");
    expect(err).not.toContain("panic:");

    const exitCode = await exited;
    expect(exitCode).toBe(1);
  });

  test("resolve dep of bundled dep", async () => {
    // Test that a bundled dep can have it's dependencies resolved without
    // needing to add them to `bundledDependencies`. Also test that only
    // the bundled deps are included, the other files in node_modules are excluded.

    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-resolved-bundled-dep",
          version: "5.5.5",
          dependencies: {
            dep1: "1.1.1",
          },
          bundledDependencies: ["dep1"],
        }),
      ),
      write(
        join(packageDir, "node_modules", "dep1", "package.json"),
        JSON.stringify({
          name: "dep1",
          version: "1.1.1",
          dependencies: {
            dep2: "2.2.2",
            dep3: "3.3.3",
          },
        }),
      ),
      write(
        join(packageDir, "node_modules", "dep2", "package.json"),
        JSON.stringify({
          name: "dep2",
          version: "2.2.2",
        }),
      ),
      write(join(packageDir, "node_modules", "dep1", "node_modules", "excluded.txt"), "do not add to tarball!"),
      write(
        join(packageDir, "node_modules", "dep1", "node_modules", "dep3", "package.json"),
        JSON.stringify({
          name: "dep3",
          version: "3.3.3",
        }),
      ),
    ]);

    const { out } = await pack(packageDir, bunEnv);
    expect(out).toContain("Total files: 4");
    expect(out).toContain("Bundled deps: 3");

    const tarball = readTarball(join(packageDir, "pack-resolved-bundled-dep-5.5.5.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/node_modules/dep1/node_modules/dep3/package.json" },
      { "pathname": "package/node_modules/dep1/package.json" },
      { "pathname": "package/node_modules/dep2/package.json" },
    ]);
  });

  test("scoped names", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-resolve-scoped",
          version: "6.6.6",
          dependencies: {
            "@scoped/dep1": "1.1.1",
          },
          bundledDependencies: ["@scoped/dep1"],
        }),
      ),
      write(
        join(packageDir, "node_modules", "@scoped", "dep1", "package.json"),
        JSON.stringify({
          name: "@scoped/dep1",
          version: "1.1.1",
          dependencies: {
            "@scoped/dep2": "2.2.2",
            "@scoped/dep3": "3.3.3",
          },
        }),
      ),
      write(
        join(packageDir, "node_modules", "@scoped", "dep2", "package.json"),
        JSON.stringify({
          name: "@scoped/dep2",
          version: "2.2.2",
        }),
      ),
      write(
        join(packageDir, "node_modules", "@scoped", "dep1", "node_modules", "@scoped", "dep3", "package.json"),
        JSON.stringify({
          name: "@scoped/dep3",
          version: "3.3.3",
        }),
      ),
    ]);

    const { out } = await pack(packageDir, bunEnv);
    expect(out).toContain("Total files: 4");
    expect(out).toContain("Bundled deps: 3");

    const tarball = readTarball(join(packageDir, "pack-resolve-scoped-6.6.6.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/node_modules/@scoped/dep1/node_modules/@scoped/dep3/package.json" },
      { "pathname": "package/node_modules/@scoped/dep1/package.json" },
      { "pathname": "package/node_modules/@scoped/dep2/package.json" },
    ]);
  });

  test("scoped names match on scope and name together", async () => {
    // `bundled` exists unscoped, in @scope and in @other; only the first two are bundled.
    // @scope/not-bundled shares its scope directory with a bundled dep.
    const packages = ["bundled", "@scope/bundled", "@scope/not-bundled", "@other/bundled"];
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bundled-same-name-across-scopes",
          version: "1.0.0",
          dependencies: Object.fromEntries(packages.map(name => [name, "1.0.0"])),
          bundledDependencies: ["@scope/bundled", "bundled"],
        }),
      ),
      ...packages.map(name =>
        write(join(packageDir, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0" })),
      ),
    ]);

    const { out } = await pack(packageDir, bunEnv);
    expect(out).toContain("Total files: 3");
    expect(out).toContain("Bundled deps: 2");

    const tarball = readTarball(join(packageDir, "pack-bundled-same-name-across-scopes-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/node_modules/@scope/bundled/package.json" },
      { "pathname": "package/node_modules/bundled/package.json" },
    ]);
  });

  test("ignore deps that aren't directories", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bundled-dep-not-dir",
          version: "4.5.6",
          dependencies: {
            dep1: "1.1.1",
          },
        }),
      ),
      write(join(packageDir, "node_modules", "dep1"), "hi. this is a file, not a directory"),
    ]);

    const { out } = await pack(packageDir, bunEnv);
    expect(out).toContain("Total files: 1");
    expect(out).not.toContain("Bundled deps");

    const tarball = readTarball(join(packageDir, "pack-bundled-dep-not-dir-4.5.6.tgz"));
    expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }]);
  });
});

describe("files", () => {
  test("CHANGELOG is not included by default", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-changelog",
          version: "1.1.1",
          files: ["lib"],
        }),
      ),
      write(join(packageDir, "CHANGELOG.md"), "hello"),
      write(join(packageDir, "lib", "index.js"), "console.log('hello ./lib/index.js')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-changelog-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/lib/index.js" },
    ]);
  });

  test("'files' overrides the overridable default ignores but never .git/.npmrc/lockfiles", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-default-ignores",
          version: "1.1.1",
          files: ["lib", ".git", ".npmrc", ".gitignore", "bunfig.toml", "package-lock.json", ".hg", ".svn", "CVS"],
        }),
      ),
      write(join(packageDir, "lib", "index.js"), "console.log('hello ./lib/index.js')"),
      write(join(packageDir, ".git", "config"), "[core]"),
      write(join(packageDir, ".npmrc"), "registry=https://registry.npmjs.org/"),
      write(join(packageDir, ".gitignore"), "node_modules"),
      write(join(packageDir, "bunfig.toml"), "[install]"),
      write(join(packageDir, "package-lock.json"), "{}"),
      write(join(packageDir, ".hg", "store"), "hg"),
      write(join(packageDir, ".svn", "entries"), "svn"),
      write(join(packageDir, "CVS", "Root"), "cvs"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-default-ignores-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/.gitignore" },
      { "pathname": "package/.hg/store" },
      { "pathname": "package/.svn/entries" },
      { "pathname": "package/CVS/Root" },
      { "pathname": "package/bunfig.toml" },
      { "pathname": "package/lib/index.js" },
    ]);
  });

  test("non-overridable default ignores are not packed when 'files' matches everything", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-default-ignores-glob",
          version: "1.1.1",
          files: ["**"],
        }),
      ),
      write(join(packageDir, "lib", "index.js"), "console.log('hello ./lib/index.js')"),
      write(join(packageDir, ".git", "config"), "[core]"),
      write(join(packageDir, ".npmrc"), "registry=https://registry.npmjs.org/"),
      write(join(packageDir, ".gitignore"), "node_modules"),
      write(join(packageDir, "bunfig.toml"), "[install]"),
      write(join(packageDir, "package-lock.json"), "{}"),
      write(join(packageDir, ".hg", "store"), "hg"),
      write(join(packageDir, ".svn", "entries"), "svn"),
      write(join(packageDir, "CVS", "Root"), "cvs"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-default-ignores-glob-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/.gitignore" },
      { "pathname": "package/.hg/store" },
      { "pathname": "package/.svn/entries" },
      { "pathname": "package/CVS/Root" },
      { "pathname": "package/bunfig.toml" },
      { "pathname": "package/lib/index.js" },
    ]);
  });

  test(".npmignore cannot exclude CHANGELOG", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-changelog",
          version: "1.1.2",
        }),
      ),
      write(join(packageDir, ".npmignore"), "CHANGELOG\nCHANGELOG.*"),
      write(join(packageDir, "CHANGELOG"), "hello"),
      write(join(packageDir, "CHANGELOG.md"), "hello"),
      write(join(packageDir, "CHANGELOG.txt"), "hello"),
    ]);
    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-changelog-1.1.2.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/CHANGELOG" },
      { "pathname": "package/CHANGELOG.md" },
      { "pathname": "package/CHANGELOG.txt" },
    ]);
  });

  test("'files' field cannot exclude LICENSE", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-license",
          version: "1.1.1",
          files: ["lib", "!LICENSE"],
        }),
      ),
      write(join(packageDir, "LICENSE"), "hello"),
      write(join(packageDir, "lib", "index.js"), "console.log('hello ./lib/index.js')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-license-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/LICENSE" },
      { "pathname": "package/lib/index.js" },
    ]);
  });

  test(".npmignore cannot exclude LICENSE", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-license",
          version: "1.1.2",
        }),
      ),
      write(join(packageDir, ".npmignore"), "LICENSE"),
      write(join(packageDir, "LICENSE"), "hello"),
    ]);
    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-license-1.1.2.tgz"));
    expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/LICENSE" }]);
  });

  test("can include files and directories", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-1",
          version: "1.1.1",
          files: ["root.js", "subdir", "subdir2/subdir"],
        }),
      ),
      write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
      write(join(packageDir, "subdir", "index.js"), "console.log('hello ./subdir/index.js')"),
      write(join(packageDir, "subdir", "anotherdir", "index.js"), "console.log('hello ./subdir/anotherdir/index.js')"),
      write(join(packageDir, "subdir2", "subdir", "index.js"), "console.log('hello ./subdir2/subdir/index.js')"),

      // should not be included
      write(join(packageDir, "subdir2", "index.js"), "console.log('hello, dont include me!')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-files-1-1.1.1.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/root.js" },
      { "pathname": "package/subdir/anotherdir/index.js" },
      { "pathname": "package/subdir/index.js" },
      { "pathname": "package/subdir2/subdir/index.js" },
    ]);
  });

  test("matches relative to root by default", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-2",
          version: "1.2.3",
          files: ["index.js"],
        }),
      ),
      write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      write(join(packageDir, "subdir", "index.js"), "console.log('hello ./subdir/index.js')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-2-1.2.3.tgz"));
    expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/index.js" }]);
  });

  test("matches './' as the root", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-3",
          version: "1.2.3",
          files: ["./dist", "!./subdir", "!./dist/index.js", "./////src//index.ts"],
        }),
      ),
      write(join(packageDir, "dist", "index.js"), "console.log('hello ./dist/index.js')"),
      write(join(packageDir, "subdir", "index.js"), "console.log('hello ./subdir/index.js')"),
      write(join(packageDir, "src", "dist", "index.js"), "console.log('hello ./src/dist/index.js')"),
      write(join(packageDir, "src", "index.ts"), "console.log('hello ./src/index.ts')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-3-1.2.3.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/dist/index.js" },
      { "pathname": "package/src/index.ts" },
    ]);
  });

  test("recursive only if leading **/", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-4",
          version: "1.2.123",
          files: ["**/index.js", "!**/index.test.ts"],
        }),
      ),
      write(join(packageDir, "root.js"), "console.log('hello ./root.js')"),
      write(join(packageDir, "subdir", "index.js"), "console.log('hello ./subdir/index.js')"),
      write(join(packageDir, "subdir", "anotherdir", "index.js"), "console.log('hello ./subdir/anotherdir/index.js')"),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      write(join(packageDir, "index.test.ts"), "console.log('hello ./index.test.ts')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-4-1.2.123.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/index.js" },
      { "pathname": "package/subdir/anotherdir/index.js" },
      { "pathname": "package/subdir/index.js" },
    ]);
  });

  test("excluded entries within included directories are not included", async () => {
    await using dir = tempDir("bun-pack-files-excluded-entries", {
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

    const { out } = await pack(dir, bunEnv);
    expect(out).toContain("Total files: 2");
    const tarball = readTarball(join(dir, "pack-excluded-entries-from-files-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/src/index.ts" },
    ]);
  });

  test("an entry longer than the path buffer is still matched", async () => {
    // A brace group of 1000 names that do not exist, then "dist". ~100KB, longer
    // than the path buffer on every platform (98302 bytes on Windows).
    const unused = Buffer.alloc(100, "x").toString();
    const pattern = `{${Array.from({ length: 1000 }, (_, i) => `${unused}${i}`).join(",")},dist}`;
    expect(pattern.length).toBeGreaterThan(100_000);

    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-files-long-entry",
          version: "1.0.0",
          files: [pattern],
        }),
      ),
      write(join(packageDir, "dist", "index.js"), "console.log('hello ./dist/index.js')"),
      write(join(packageDir, "src", "index.js"), "console.log('hello ./src/index.js')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-files-long-entry-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([
      { "pathname": "package/package.json" },
      { "pathname": "package/dist/index.js" },
    ]);
  });
});

describe(".gitignore/.npmignore", () => {
  for (const ignoreFile of [".gitignore", ".npmignore"]) {
    test(`can ignore and un-ignore a file (${ignoreFile})`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-ignore-1",
            version: "0.0.0",
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
        write(join(packageDir, ignoreFile), "index.js"),
      ]);

      await pack(packageDir, bunEnv);
      const tarball = readTarball(join(packageDir, "pack-ignore-1-0.0.0.tgz"));
      expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }]);

      await Promise.all([
        rm(join(packageDir, "pack-ignore-1-0.0.0.tgz")),
        write(join(packageDir, ignoreFile), "index.js\n!index.js"),
      ]);

      await pack(packageDir, bunEnv);
      const tarball2 = readTarball(join(packageDir, "pack-ignore-1-0.0.0.tgz"));
      expect(tarball2.entries).toMatchObject([
        { "pathname": "package/package.json" },
        { "pathname": "package/index.js" },
      ]);

      await Promise.all([
        rm(join(packageDir, "pack-ignore-1-0.0.0.tgz")),
        write(join(packageDir, ignoreFile), "!index.js\nindex.js"),
      ]);

      await pack(packageDir, bunEnv);
      const tarball3 = readTarball(join(packageDir, "pack-ignore-1-0.0.0.tgz"));
      expect(tarball3.entries).toMatchObject([{ "pathname": "package/package.json" }]);
    });
  }

  for (const ignoreFile of [".gitignore", ".npmignore"]) {
    test(`reports which ${ignoreFile} could not be read`, async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-ignore-unreadable",
            version: "1.0.0",
          }),
        ),
        write(join(packageDir, "subdir", "index.js"), "console.log('hello ./subdir/index.js')"),
        // a directory where the ignore file is expected: opening it succeeds, reading it fails
        mkdir(join(packageDir, "subdir", ignoreFile), { recursive: true }),
      ]);

      const { err } = await packExpectError(packageDir, bunEnv);
      expect(err).toContain(`EISDIR: failed to read ${ignoreFile} at: "${join(packageDir, "subdir", ignoreFile)}"\n`);
    });
  }

  test("excludes files recursively", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-ignore-2",
          version: "1.2.1",
        }),
      ),
      write(join(packageDir, ".npmignore"), "index.js"),
      write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      write(join(packageDir, "subdir", "index.js"), "console.log('hello ./subdir/index.js')"),
      write(join(packageDir, "subdir", "subsubdir", "index.js"), "console.log('hello ./subdir/subsubdir/index.js')"),
    ]);

    await pack(packageDir, bunEnv);
    const tarball = readTarball(join(packageDir, "pack-ignore-2-1.2.1.tgz"));
    expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }]);
  });
});

describe("bins", () => {
  test("basic", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins",
          version: "1.2.3",
          bin: "bin.js",
        }),
      ),
      write(join(packageDir, "bin.js"), `#!/usr/bin/env bun\n`),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-1.2.3.tgz"));
    expect(tarball.entries).toMatchObject([
      {
        pathname: "package/package.json",
      },
      {
        pathname: "package/bin.js",
      },
    ]);

    expect(tarball.entries[0].perm & 0o644).toBe(0o644);
    expect(tarball.entries[1].perm & (0o644 | 0o111)).toBe(0o644 | 0o111);
  });

  test("directory", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-dir",
          version: "1.2.3",
          directories: {
            bin: "bins",
          },
        }),
      ),
      write(join(packageDir, "bins", "bin1.js"), `#!/usr/bin/env bun\n`),
      write(join(packageDir, "bins", "bin2.js"), `#!/usr/bin/env bun\n`),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-dir-1.2.3.tgz"));
    expect(tarball.entries).toMatchObject([
      {
        pathname: "package/package.json",
      },
      {
        pathname: "package/bins/bin1.js",
      },
      {
        pathname: "package/bins/bin2.js",
      },
    ]);

    expect(tarball.entries[0].perm & 0o644).toBe(0o644);
    expect(tarball.entries[1].perm & (0o644 | 0o111)).toBe(0o644 | 0o111);
    expect(tarball.entries[2].perm & (0o644 | 0o111)).toBe(0o644 | 0o111);
  });

  test('are included even if not included in "files"', async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-and-files-1",
          version: "2.2.2",
          files: ["dist"],
          bin: "bin.js",
        }),
      ),
      write(join(packageDir, "dist", "hi.js"), "console.log('hi!')"),
      write(join(packageDir, "bin.js"), "console.log('hello')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-and-files-1-2.2.2.tgz"));

    expect(tarball.entries).toMatchObject([
      {
        pathname: "package/package.json",
      },
      {
        pathname: "package/bin.js",
      },
      {
        pathname: "package/dist/hi.js",
      },
    ]);
  });

  test('"directories" works with "files"', async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-and-files-2",
          version: "1.2.3",
          files: ["dist"],
          directories: {
            bin: "bins",
          },
        }),
      ),
      write(join(packageDir, "dist", "hi.js"), "console.log('hi!')"),
      write(join(packageDir, "bins", "bin.js"), "console.log('hello')"),
      write(join(packageDir, "bins", "what", "what.js"), "console.log('hello')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-and-files-2-1.2.3.tgz"));
    expect(tarball.entries).toMatchObject([
      {
        pathname: "package/package.json",
      },
      {
        pathname: "package/bins/bin.js",
      },
      {
        pathname: "package/bins/what/what.js",
      },
      {
        pathname: "package/dist/hi.js",
      },
    ]);
  });

  test('deduplicate with "files"', async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-and-files-2",
          version: "1.2.3",
          files: ["dist", "bins/bin.js"],
          directories: {
            bin: "bins",
          },
        }),
      ),
      write(join(packageDir, "dist", "hi.js"), "console.log('hi!')"),
      write(join(packageDir, "bins", "bin.js"), "console.log('hello')"),
      write(join(packageDir, "bins", "what", "what.js"), "console.log('hello')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-and-files-2-1.2.3.tgz"));
    expect(tarball.entries).toMatchObject([
      {
        pathname: "package/package.json",
      },
      {
        pathname: "package/bins/bin.js",
      },
      {
        pathname: "package/bins/what/what.js",
      },
      {
        pathname: "package/dist/hi.js",
      },
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
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-long-bin",
            version: "1.0.0",
            ...fields,
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
      ]);

      await pack(packageDir, bunEnv);

      const tarball = readTarball(join(packageDir, "pack-long-bin-1.0.0.tgz"));
      expect(tarball.entries).toMatchObject([{ pathname: "package/package.json" }, { pathname: "package/index.js" }]);
    });

    test("the other bins are still packed", async () => {
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-long-bin",
            version: "1.0.0",
            files: ["index.js"],
            bin: { long, cli: "cli.js" },
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('hello ./index.js')"),
        write(join(packageDir, "cli.js"), `#!/usr/bin/env bun\n`),
      ]);

      await pack(packageDir, bunEnv);

      const tarball = readTarball(join(packageDir, "pack-long-bin-1.0.0.tgz"));
      expect(tarball.entries).toMatchObject([
        { pathname: "package/package.json" },
        { pathname: "package/cli.js" },
        { pathname: "package/index.js" },
      ]);
      expect(tarball.entries[1].perm & 0o111).toBe(0o111);
    });
  });

  test("that are not regular files are ignored", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
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
      write(join(packageDir, "index.js"), "console.log('index')"),
      write(join(packageDir, "lib", "a.js"), "console.log('a')"),
      write(join(packageDir, "real-bin.js"), "console.log('real bin')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-not-files-1.0.0.tgz"));
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

  async function writeSymlinkedBins() {
    const outside = join(packageDir, "outside");
    const pkgDir = join(packageDir, "pkg");
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
    const pkgDir = await writeSymlinkedBins();

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
    const pkgDir = await writeSymlinkedBins();

    const { out } = await pack(pkgDir, bunEnv, "--dry-run");

    const packed = out
      .split("\n")
      .filter(line => line.startsWith("packed "))
      .map(line => line.split(" ").at(-1));
    expect(packed).toEqual(["package.json", "index.js", "real-bin.js"]);
    expect(out).toContain("Total files: 3");
  });

  test('"directories.bin" that is a symlink is not packed', async () => {
    const outside = join(packageDir, "outside");
    const pkgDir = join(packageDir, "pkg");
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
    // A junction on Windows, where "junction" is ignored elsewhere and makes a plain symlink.
    await symlink(join(outside, "bins"), join(pkgDir, "bins"), "junction");

    await pack(pkgDir, bunEnv);

    const tarball = readTarball(join(pkgDir, "pack-bins-dir-symlink-1.0.0.tgz"));
    expect(tarball.entries.map(({ pathname }) => pathname)).toEqual(["package/package.json", "package/index.js"]);
  });

  // Paths resolve against the package root, as in npm, so all four name one file.
  test("the same file under several bin names is packed once", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
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
      write(join(packageDir, "cli.js"), "console.log('hello')"),
    ]);

    const { out } = await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-same-file-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([{ pathname: "package/package.json" }, { pathname: "package/cli.js" }]);
    expect(tarball.entries[1].perm & 0o111).toBe(0o111);
    expect(out).toContain("Total files: 2");
  });

  // None of these name a file that can be packed as a bin: the package root, a
  // file spelled as a directory, a directory, and the root package.json (which
  // is always in the tarball). The package packs as if "bin" were absent.
  test.each(["", ".", "cli.js/", "lib/", "package.json"])('"bin" of %p is ignored', async bin => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-not-a-file",
          version: "1.0.0",
          bin,
        }),
      ),
      write(join(packageDir, "cli.js"), "console.log('cli')"),
      write(join(packageDir, "lib", "a.js"), "console.log('a')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-not-a-file-1.0.0.tgz"));
    expect(
      tarball.entries.map(entry => ({ pathname: entry.pathname, executable: (entry.perm & 0o111) !== 0 })),
    ).toEqual([
      { pathname: "package/package.json", executable: false },
      { pathname: "package/cli.js", executable: false },
      { pathname: "package/lib/a.js", executable: false },
    ]);
  });

  test("ignored entries of a bin object do not affect the others", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
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
      write(join(packageDir, "cli.js"), "console.log('cli')"),
      write(join(packageDir, "lib", "a.js"), "console.log('a')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-partly-ignored-1.0.0.tgz"));
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
      await Promise.all([
        write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "pack-bins-dir-trailing-slash",
            version: "1.0.0",
            files,
            directories: {
              bin: "./lib/bins/",
            },
          }),
        ),
        write(join(packageDir, "index.js"), "console.log('index')"),
        write(join(packageDir, "lib", "index.js"), "console.log('lib')"),
        write(join(packageDir, "lib", "bins", "bin.js"), "console.log('bin')"),
      ]);

      await pack(packageDir, bunEnv);

      const tarball = readTarball(join(packageDir, "pack-bins-dir-trailing-slash-1.0.0.tgz"));
      expect(tarball.entries.map(entry => entry.pathname)).toEqual(["package/package.json", ...expected]);
      const bin = tarball.entries.find(entry => entry.pathname === "package/lib/bins/bin.js");
      expect(bin.perm & 0o111).toBe(0o111);
    });
  });

  test.each(["", ".", "./"])('"directories.bin" of %p (the package root) is ignored', async bin => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "pack-bins-dir-root",
          version: "1.0.0",
          directories: {
            bin,
          },
        }),
      ),
      write(join(packageDir, "index.js"), "console.log('index')"),
      write(join(packageDir, "lib", "a.js"), "console.log('a')"),
    ]);

    await pack(packageDir, bunEnv);

    const tarball = readTarball(join(packageDir, "pack-bins-dir-root-1.0.0.tgz"));
    expect(tarball.entries).toMatchObject([
      { pathname: "package/package.json" },
      { pathname: "package/index.js" },
      { pathname: "package/lib/a.js" },
    ]);
  });
});

test("unicode", async () => {
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-unicode",
        version: "1.1.1",
      }),
    ),
    write(join(packageDir, "äöüščří.js"), `console.log('hello ./äöüščří.js');`),
  ]);

  await pack(packageDir, bunEnv);
  const tarball = readTarball(join(packageDir, "pack-unicode-1.1.1.tgz"));
  expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/äöüščří.js" }]);
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
  for (let offset = 0; offset + 512 <= tar.length; ) {
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
      for (let pos = 0; pos < data.length; ) {
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
test.skipIf(!isLinux)("filenames that are not valid UTF-8 are stored byte for byte", async () => {
  const rawPath = (byte: number) => Buffer.concat([Buffer.from(`${packageDir}/x_`), Buffer.from([byte])]);
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-invalid-utf8",
        version: "1.0.0",
      }),
    ),
    // latin-1 "é", and a byte that is invalid in UTF-8 at any position
    fs.writeFile(rawPath(0xe9), "ONE"),
    fs.writeFile(rawPath(0xff), "TWO"),
  ]);

  const { out } = await pack(packageDir, bunEnv);
  expect(out).toContain("Total files: 3");

  const members = rawTarballMembers(await file(join(packageDir, "pack-invalid-utf8-1.0.0.tgz")).bytes());
  expect(members).toEqual([
    { names: new Set(["package/x_\xe9"]), contents: "ONE" },
    { names: new Set(["package/x_\xff"]), contents: "TWO" },
    { names: new Set(["package/package.json"]), contents: expect.stringContaining(`"pack-invalid-utf8"`) },
  ]);
});

test("$npm_command is accurate", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "pack-command",
      version: "1.1.1",
      scripts: {
        postpack: "echo $npm_command",
      },
    }),
  );
  const p = await pack(packageDir, bunEnv);
  expect(p.out.split("\n")).toEqual([
    `bun pack ${Bun.version_with_sha}`,
    ``,
    `packed 106B package.json`,
    ``,
    `pack-command-1.1.1.tgz`,
    ``,
    `Total files: 1`,
    expect.stringContaining(`Shasum: `),
    expect.stringContaining(`Integrity: sha512-`),
    `Unpacked size: 106B`,
    expect.stringContaining(`Packed size: `),
    ``,
    `pack`,
    ``,
  ]);
  expect(p.err).toEqual(`$ echo $npm_command\n`);
});

test("$npm_lifecycle_event is accurate", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "pack-lifecycle",
      version: "1.1.1",
      scripts: {
        postpack: "echo $npm_lifecycle_event",
      },
    }),
  );
  const p = await pack(packageDir, bunEnv);
  expect(p.out.split("\n")).toEqual([
    `bun pack ${Bun.version_with_sha}`,
    ``,
    `packed 116B package.json`,
    ``,
    `pack-lifecycle-1.1.1.tgz`,
    ``,
    `Total files: 1`,
    expect.stringContaining(`Shasum: `),
    expect.stringContaining(`Integrity: sha512-`),
    `Unpacked size: 116B`,
    expect.stringContaining(`Packed size: `),
    ``,
    `postpack`,
    ``,
  ]);
  expect(p.err).toEqual(`$ echo $npm_lifecycle_event\n`);
});
