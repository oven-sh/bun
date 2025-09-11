import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { mkdir, readlink, rm, symlink } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, readdirSorted, runBunInstall } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("basic", () => {
  test("single dependency", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-1",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("scope package", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-2",
        dependencies: {
          "@types/is-number": "1.0.0",
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", "@types", "is-number"))).toBe(
      join("..", ".bun", "@types+is-number@1.0.0", "node_modules", "@types", "is-number"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"))).toBe(
      join("..", "..", "@types+is-number@1.0.0", "node_modules", "@types", "is-number"),
    );
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@types+is-number@1.0.0",
          "node_modules",
          "@types",
          "is-number",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@types/is-number",
      version: "1.0.0",
    });
  });

  test("transitive dependencies", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-3",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "two-range-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "two-range-deps"))).toBe(
      join("..", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.1.0", "node_modules", "no-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"))).toBe(
      join("..", "..", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"),
    );
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "two-range-deps@1.0.0",
          "node_modules",
          "two-range-deps",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "two-range-deps",
      version: "1.0.0",
      dependencies: {
        "no-deps": "^1.0.0",
        "@types/is-number": ">=1.0.0",
      },
    });
    expect(
      await readdirSorted(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules")),
    ).toEqual(["@types", "no-deps", "two-range-deps"]);
    expect(
      readlinkSync(
        join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "@types", "is-number"),
      ),
    ).toBe(join("..", "..", "..", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"));
    expect(
      readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps")),
    ).toBe(join("..", "..", "no-deps@1.1.0", "node_modules", "no-deps"));
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.1.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.1.0",
    });
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@types+is-number@2.0.0",
          "node_modules",
          "@types",
          "is-number",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@types/is-number",
      version: "2.0.0",
    });
  });
});

test("handles cyclic dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-cyclic",
      dependencies: {
        "a-dep-b": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(readlinkSync(join(packageDir, "node_modules", "a-dep-b"))).toBe(
    join(".bun", "a-dep-b@1.0.0", "node_modules", "a-dep-b"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "a-dep-b"))).toBe(
    join("..", "a-dep-b@1.0.0", "node_modules", "a-dep-b"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "b-dep-a"))).toBe(
    join("..", "b-dep-a@1.0.0", "node_modules", "b-dep-a"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "a-dep-b", "package.json"),
    ).json(),
  ).toEqual({
    name: "a-dep-b",
    version: "1.0.0",
    dependencies: {
      "b-dep-a": "1.0.0",
    },
  });

  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "b-dep-a"))).toBe(
    join("..", "..", "b-dep-a@1.0.0", "node_modules", "b-dep-a"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "b-dep-a", "package.json"),
    ).json(),
  ).toEqual({
    name: "b-dep-a",
    version: "1.0.0",
    dependencies: {
      "a-dep-b": "1.0.0",
    },
  });
});

test("can install folder dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-folder-deps",
      dependencies: {
        "folder-dep": "file:./pkg-1",
      },
    }),
  );

  await write(join(packageDir, "pkg-1", "package.json"), JSON.stringify({ name: "folder-dep", version: "1.0.0" }));

  await runBunInstall(bunEnv, packageDir);

  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "package.json"),
    ).json(),
  ).toEqual({
    name: "folder-dep",
    version: "1.0.0",
  });

  await write(join(packageDir, "pkg-1", "index.js"), "module.exports = 'hello from pkg-1';");

  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "index.js"),
    ).text(),
  ).toBe("module.exports = 'hello from pkg-1';");
});

describe("isolated workspaces", () => {
  test("basic", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-workspaces",
          workspaces: {
            packages: ["pkg-1", "pkg-2"],
          },
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg-1", "package.json"),
        JSON.stringify({
          name: "pkg-1",
          version: "1.0.0",
          dependencies: {
            "a-dep": "1.0.1",
            "pkg-2": "workspace:",
            "@types/is-number": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg-2", "package.json"),
        JSON.stringify({
          name: "pkg-2",
          version: "1.0.0",
          dependencies: {
            "b-dep-a": "1.0.0",
          },
        }),
      ),
    ]);

    await runBunInstall(bunEnv, packageDir);

    expect(existsSync(join(packageDir, "node_modules", "pkg-1"))).toBeFalse();
    expect(readlinkSync(join(packageDir, "pkg-1", "node_modules", "pkg-2"))).toBe(join("..", "..", "pkg-2"));
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );

    expect(await readdirSorted(join(packageDir, "pkg-1", "node_modules"))).toEqual(["@types", "a-dep", "pkg-2"]);
    expect(await readdirSorted(join(packageDir, "pkg-2", "node_modules"))).toEqual(["b-dep-a"]);
    expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([
      "@types+is-number@1.0.0",
      "a-dep-b@1.0.0",
      "a-dep@1.0.1",
      "b-dep-a@1.0.0",
      "no-deps@1.0.0",
      "node_modules",
    ]);

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });
});

for (const backend of ["clonefile", "hardlink", "copyfile"]) {
  test(`isolated install with backend: ${backend}`, async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-backend",
          dependencies: {
            "no-deps": "1.0.0",
            "alias-loop-2": "1.0.0",
            "alias-loop-1": "1.0.0",
            "1-peer-dep-a": "1.0.0",
            "basic-1": "1.0.0",
            "is-number": "1.0.0",
            "file-dep": "file:./file-dep",
            "@scoped/file-dep": "file:./scoped-file-dep",
          },
        }),
      ),
      write(join(packageDir, "file-dep", "package.json"), JSON.stringify({ name: "file-dep", version: "1.0.0" })),
      write(
        join(packageDir, "file-dep", "dir1", "dir2", "dir3", "dir4", "dir5", "index.js"),
        "module.exports = 'hello from file-dep';",
      ),
      write(
        join(packageDir, "scoped-file-dep", "package.json"),
        JSON.stringify({ name: "@scoped/file-dep", version: "1.0.0" }),
      ),
    ]);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--backend", backend],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exited).toBe(0);
    const out = await stdout.text();
    const err = await stderr.text();

    expect(err).not.toContain("error");
    expect(err).not.toContain("warning");

    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });

    expect(readlinkSync(join(packageDir, "node_modules", "file-dep"))).toBe(
      join(".bun", "file-dep@file+file-dep", "node_modules", "file-dep"),
    );

    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "file-dep@file+file-dep", "node_modules", "file-dep", "package.json"),
      ).json(),
    ).toEqual({
      name: "file-dep",
      version: "1.0.0",
    });

    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "file-dep@file+file-dep",
          "node_modules",
          "file-dep",
          "dir1",
          "dir2",
          "dir3",
          "dir4",
          "dir5",
          "index.js",
        ),
      ).text(),
    ).toBe("module.exports = 'hello from file-dep';");

    expect(readlinkSync(join(packageDir, "node_modules", "@scoped", "file-dep"))).toBe(
      join("..", ".bun", "@scoped+file-dep@file+scoped-file-dep", "node_modules", "@scoped", "file-dep"),
    );

    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@scoped+file-dep@file+scoped-file-dep",
          "node_modules",
          "@scoped",
          "file-dep",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@scoped/file-dep",
      version: "1.0.0",
    });
  });
}

describe("--linker flag", () => {
  test("can override linker from bunfig", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();
  });

  test("works as the only config option", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    let { exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();
  });
});
test("many transitive dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-many-transitive-deps",
      dependencies: {
        "alias-loop-1": "1.0.0",
        "alias-loop-2": "1.0.0",
        "1-peer-dep-a": "1.0.0",
        "basic-1": "1.0.0",
        "is-number": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
    ".bun",
    "1-peer-dep-a",
    "alias-loop-1",
    "alias-loop-2",
    "basic-1",
    "is-number",
  ]);
  expect(readlinkSync(join(packageDir, "node_modules", "alias-loop-1"))).toBe(
    join(".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "alias-loop-1"))).toBe(
    join("..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "alias-loop-2"))).toBe(
    join("..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-1",
    version: "1.0.0",
    dependencies: {
      "alias1": "npm:alias-loop-2@*",
    },
  });
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-2",
    version: "1.0.0",
    dependencies: {
      "alias2": "npm:alias-loop-1@*",
    },
  });
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules"))).toEqual([
    "alias-loop-1",
    "alias1",
  ]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules"))).toEqual([
    "alias-loop-2",
    "alias2",
  ]);
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias1"))).toBe(
    join("..", "..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias2"))).toBe(
    join("..", "..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
});

test("dependency names are preserved", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-dependency-names",
      dependencies: {
        "alias-loop-1": "1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "alias-loop-1"]);
  expect(readlinkSync(join(packageDir, "node_modules", "alias-loop-1"))).toBe(
    join(".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules"))).toEqual([
    "alias-loop-1",
    "alias1",
  ]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules"))).toEqual([
    "alias-loop-2",
    "alias2",
  ]);
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias1"))).toBe(
    join("..", "..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias2"))).toBe(
    join("..", "..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-1",
    version: "1.0.0",
    dependencies: {
      "alias1": "npm:alias-loop-2@*",
    },
  });
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-2",
    version: "1.0.0",
    dependencies: {
      "alias2": "npm:alias-loop-1@*",
    },
  });
});

test("same resolution, different dependency name", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-same-resolution",
      dependencies: {
        "no-deps-1": "npm:no-deps@1.0.0",
        "no-deps-2": "npm:no-deps@1.0.0",
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps-1", "no-deps-2"]);
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps-1"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps-2"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
    ).json(),
  ).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual(["no-deps@1.0.0", "node_modules"]);
});

test("successfully removes and corrects symlinks", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });
  await Promise.all([
    write(join(packageDir, "old-package", "package.json"), JSON.stringify({ name: "old-package", version: "1.0.0" })),
    mkdir(join(packageDir, "node_modules")),
  ]);
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-dangling-symlinks",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    ),
    symlink(join("..", "old-package"), join(packageDir, "node_modules", "no-deps"), "dir"),
  ]);

  await runBunInstall(bunEnv, packageDir);

  expect(existsSync(join(packageDir, "node_modules", "no-deps"))).toBeTrue();

  expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
});

test("runs lifecycle scripts correctly", async () => {
  // due to binary linking between preinstall and the remaining lifecycle scripts
  // there is special handling for preinstall scripts we should test.
  // 1. only preinstall
  // 2. only postinstall (or any other script that isn't preinstall)
  // 3. preinstall and any other script

  const { packageJson, packageDir } = await registry.createTestDir({ isolated: true });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-lifecycle-scripts",
      dependencies: {
        "lifecycle-preinstall": "1.0.0",
        "lifecycle-postinstall": "1.0.0",
        "all-lifecycle-scripts": "1.0.0",
      },
      trustedDependencies: ["lifecycle-preinstall", "lifecycle-postinstall", "all-lifecycle-scripts"],
    }),
  );

  await runBunInstall(bunEnv, packageDir);

  const [
    preinstallLink,
    postinstallLink,
    allScriptsLink,
    preinstallFile,
    postinstallFile,
    allScriptsPreinstallFile,
    allScriptsInstallFile,
    allScriptsPostinstallFile,
    bunDir,
    lifecyclePreinstallDir,
    lifecyclePostinstallDir,
    allLifecycleScriptsDir,
  ] = await Promise.all([
    readlink(join(packageDir, "node_modules", "lifecycle-preinstall")),
    readlink(join(packageDir, "node_modules", "lifecycle-postinstall")),
    readlink(join(packageDir, "node_modules", "all-lifecycle-scripts")),
    file(join(packageDir, "node_modules", "lifecycle-preinstall", "preinstall.txt")).text(),
    file(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "preinstall.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "install.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "postinstall.txt")).text(),
    readdirSorted(join(packageDir, "node_modules", ".bun")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "lifecycle-preinstall@1.0.0", "node_modules")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0", "node_modules")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "all-lifecycle-scripts@1.0.0", "node_modules")),
  ]);

  expect(preinstallLink).toBe(join(".bun", "lifecycle-preinstall@1.0.0", "node_modules", "lifecycle-preinstall"));
  expect(postinstallLink).toBe(join(".bun", "lifecycle-postinstall@1.0.0", "node_modules", "lifecycle-postinstall"));
  expect(allScriptsLink).toBe(join(".bun", "all-lifecycle-scripts@1.0.0", "node_modules", "all-lifecycle-scripts"));

  expect(preinstallFile).toBe("preinstall!");
  expect(postinstallFile).toBe("postinstall!");
  expect(allScriptsPreinstallFile).toBe("preinstall!");
  expect(allScriptsInstallFile).toBe("install!");
  expect(allScriptsPostinstallFile).toBe("postinstall!");

  expect(bunDir).toEqual([
    "all-lifecycle-scripts@1.0.0",
    "lifecycle-postinstall@1.0.0",
    "lifecycle-preinstall@1.0.0",
    "node_modules",
  ]);

  expect(lifecyclePreinstallDir).toEqual(["lifecycle-preinstall"]);
  expect(lifecyclePostinstallDir).toEqual(["lifecycle-postinstall"]);
  expect(allLifecycleScriptsDir).toEqual(["all-lifecycle-scripts"]);
});
