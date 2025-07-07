import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readlinkSync } from "fs";
import { VerdaccioRegistry, bunEnv, readdirSorted, runBunInstall } from "harness";
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
    const { packageJson, packageDir } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-1",
        workspaces: {
          nodeLinker: "isolated",
        },
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
    const { packageJson, packageDir } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-2",
        workspaces: {
          nodeLinker: "isolated",
        },
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
    const { packageJson, packageDir } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-3",
        workspaces: {
          nodeLinker: "isolated",
        },
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
  const { packageJson, packageDir } = await registry.createTestDir();

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-cyclic",
      workspaces: {
        nodeLinker: "isolated",
      },
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
  const { packageJson, packageDir } = await registry.createTestDir();

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-folder-deps",
      workspaces: {
        nodeLinker: "isolated",
      },
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
