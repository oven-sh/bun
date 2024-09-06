import { spawn, write, file } from "bun";
import { test, expect, describe, beforeEach } from "bun:test";
import { bunExe, bunEnv, tmpdirSync, runBunInstall } from "harness";
import { readTarball } from "bun:internal-for-testing";
import { exists, rename, rm, stat, mkdir } from "fs/promises";
import { join } from "path";

var packageDir: string;

beforeEach(() => {
  packageDir = tmpdirSync();
  console.log(`packageDir: ${packageDir}`);
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
  expect(exitCode).toBe(0);

  return { out, err };
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
      expect(err).toBe(`error: compression level must be between 0 and 9, received ${invalidGzipLevel}\n`);
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

  test.todo("scoped names", async () => {
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
