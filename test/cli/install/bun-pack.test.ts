import { spawn, write } from "bun";
import { test, expect, describe, beforeEach } from "bun:test";
import { bunExe, bunEnv, tmpdirSync } from "harness";
import { readTarball } from "bun:internal-for-testing";
import { exists, rename, rm, stat } from "fs/promises";
import { join } from "path";

var packageDir: string;

beforeEach(() => {
  packageDir = tmpdirSync();
});

async function pack(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "pack", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });

  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warning:");
  expect(err).not.toContain("failed");
  expect(err).not.toContain("panic:");

  const out = await Bun.readableStreamToText(stdout);
  const exitCode = await exited;

  return { out, err, exitCode };
}

async function packExpectError(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "pack", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });

  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("panic:");

  const out = await Bun.readableStreamToText(stdout);
  const exitCode = await exited;

  return { out, err, exitCode };
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

  const { exitCode } = await pack(packageDir, bunEnv);
  expect(exitCode).toBe(0);

  const tarball = readTarball(join(packageDir, "pack-basic-1.2.3.tgz"));
  // console.log(tarball);
  expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/index.js" }]);
});

describe("package.json names and versions", () => {
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

      const { err, exitCode } = await packExpectError(packageDir, bunEnv);
      expect(exitCode).toBe(1);
      expect(err).toContain(expectedError);
    });
  }

  test("missing", async () => {
    await write(join(packageDir, "index.js"), "console.log('hello ./index.js')");

    const { err, exitCode } = await packExpectError(packageDir, bunEnv);
    expect(exitCode).toBe(1);
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

      const { exitCode } = fail ? await packExpectError(packageDir, bunEnv) : await pack(packageDir, bunEnv);
      const expected = fail ? 1 : 0;
      expect(exitCode).toBe(expected);
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

    const { out, exitCode } = await pack(packageDir, bunEnv, "--dry-run");
    expect(exitCode).toBe(0);

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
      const { err, exitCode } = await packExpectError(packageDir, bunEnv, `--gzip-level=${invalidGzipLevel}`);
      expect(exitCode).toBe(1);
      expect(err).toBe(`error: compression level must be between 0 and 9, received ${invalidGzipLevel}\n`);
    }

    let { exitCode } = await pack(packageDir, bunEnv, "--gzip-level=0");
    expect(exitCode).toBe(0);
    const largerTarball = readTarball(join(packageDir, "pack-gzip-test-111111.1.11111111111111.tgz"));
    expect(largerTarball.entries).toHaveLength(2);

    await rm(join(packageDir, "pack-gzip-test-111111.1.11111111111111.tgz"));

    ({ exitCode } = await pack(packageDir, bunEnv, "--gzip-level=9"));
    expect(exitCode).toBe(0);
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
      const { exitCode } = await pack(packageDir, bunEnv, `--destination=${dest}`);
      expect(exitCode).toBe(0);

      const tarball = readTarball(join(dest, "pack-dest-test-1.1.1.tgz"));
      expect(tarball.entries).toHaveLength(2);
    });
  }

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
});

describe("workspaces", () => {});

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

  const { exitCode } = await pack(packageDir, bunEnv);
  expect(exitCode).toBe(0);
  const tarball = readTarball(join(packageDir, "pack-unicode-1.1.1.tgz"));
  expect(tarball.entries).toMatchObject([{ "pathname": "package/package.json" }, { "pathname": "package/äöüščří.js" }]);
});
