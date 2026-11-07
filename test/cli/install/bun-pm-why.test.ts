import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `bun why` reads only bun.lock, so every project here is a package.json plus a
// static lockfile. Nothing is installed and no registry is contacted. The
// packages come from test/cli/install/registry/packages.
const integrity: Record<string, string> = {
  "@types/no-deps@1.0.0":
    "sha512-quthzD2O04AlTaZLJGf4a6/6aD7lf4Qa4HS7ViRWnTFdSbRbof20GFoq9YRCD3YQxd/HKI83YBAAiZ4ewoy+0Q==",
  "a-dep@1.0.1": "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg==",
  "alias-loop-1@1.0.0":
    "sha512-qR/ExCSjkWfWCzTqKn0wZ3z/FoP+//pQghXYn+dHWLQ0SO9wf/IFiy+D0vT7UG565b4YYgiomMPyZaDBDwinhQ==",
  "alias-loop-2@1.0.0":
    "sha512-5422abBn4N5dTHw9c7qq+j1mA14UoVIeNQBM+MtemVKw2/S8/uFA3x7OvLyD7Dr7ZT7WMsSp4LC4+11NmzEPxA==",
  "dep-loop-entry@1.0.0":
    "sha512-XQR76R6M+i++Bl7qGqCU+aHLPNpFHvfGaH/fNrtVt24zhi/ahp6X7fWK+5JPh/2aHTPAXGndeyGnHAOsJ2DboQ==",
  "dep-loop-exit@1.0.0":
    "sha512-iI3zFvAvGK76XyH346CHeM7KqzhY46zMZ28P7VmsIgAeYKFK7wR/zTtl4sP8ETW4cF+3SCJWD58pm30VQHtDgQ==",
  "dev-deps@1.0.0": "sha512-e6ekSjPwd2fKE8hqV9EIBZnL/IZn2urf5S+y0Kz6g+3/9VcDQpByRy/OHJMVb2iH2vqLgB4FFUHeKm/l8yvWZg==",
  "dragon-test-1-a@1.0.0":
    "sha512-kztUHk7vRb6buxO34xezbi7nyXRhJjxLR39+Df5cQeE8QlOu9ppkjBkoahxkfxn7ceJZO0ukH8mpk4u0U6leeg==",
  "dragon-test-1-b@1.0.0":
    "sha512-/2YDfFmOLMlkV4AM9D5+EI51c9bwp+hOWfjcJBZHbqP+REymTiUGG5C/WE88ZTBM7qzE8eYSRJh7hGn7VESpHg==",
  "dragon-test-1-b@2.0.0":
    "sha512-vyF1LDVqd8QkDi8O5whlVrdEY7qEL140SKRpblOJ8WCtTrFkY4Xgdn3S/zRLPnZ17dBySRx1OtFSlBGf1yx1gA==",
  "dragon-test-1-c@1.0.0":
    "sha512-WzbUXSLRr59rYLLtsoB+RL2oHs/woy9gwxSVN/l5Bv/bNE+daUzEZjdYXjvJA5/6gnqwMh5lwtZNHQL8Hz67dw==",
  "dragon-test-1-d@1.0.0":
    "sha512-aI+kyXIUNwxP8ZTRJT3BK/Vzcwu9hmLDbS9gCABjpb/TkPlg3r+0133xoZ+3vMPcEVPzxJ++ZpNP7ACoZ/C75g==",
  "dragon-test-1-e@1.0.0":
    "sha512-kZqqdHWNkWNc4dJ43KjGpWkiuB6ywKPSU1zkl/JLl/6l8KkkzK0QyDu2B1147FWXuUzjkaJWxuIP0BoPC1h9Bg==",
  "no-deps@1.0.0": "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
  "no-deps@2.0.0": "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
  "one-fixed-dep@1.0.0":
    "sha512-eLc7J+EoM2ymMvC9QWxV6jWanghtKbM+BHzkwEdj+MwO2J58vNkDcmLN6FTIZqgA6dl9lt3XiMwV3/2b7wHz8w==",
  "peer-deps@1.0.0": "sha512-CHQ5sQXwUo38G++dkzJ/rJ9Ge98MeMTQjjC9UK2t0frp8Lrhm3zNooOLakFyHW4UcyD3vuTS3Qv324Bj6B5Tjw==",
  "peer-deps-fixed@1.0.0":
    "sha512-gVs9cSdy6TAQIEWu1tVEK1mAspCQxYziTGQlv4a2XQpzOBZvoQ/y6lOeu3tqNNrNQnLwdvwAQTlvazV5+HfV7g==",
  "provides-peer-deps-1-0-0@1.0.0":
    "sha512-DSOgqUXTkw06FqE/14D5KvaGbl3e3Rri71F9UeSRGV1CtQE84mO69ZXE1QhSed5zM0EQy1n/zkwDdtwsmOaFsA==",
};

type Manifest = Record<string, unknown>;

function npm(resolution: string, deps: Manifest = {}) {
  return [resolution, "", deps, integrity[resolution]];
}

function project(root: Manifest, packages: Record<string, unknown[]>, workspaces: Record<string, Manifest> = {}) {
  const { workspaces: _globs, ...rootEntry } = root;
  const files: Record<string, string> = {
    "package.json": JSON.stringify(root),
    "bun.lock": JSON.stringify({ lockfileVersion: 1, workspaces: { "": rootEntry, ...workspaces }, packages }),
  };
  for (const [path, manifest] of Object.entries(workspaces)) {
    files[`${path}/package.json`] = JSON.stringify(manifest);
  }
  return files;
}

// no-deps@2.0.0 and one-fixed-dep@1.0.0 (which needs no-deps@1.0.0) plus a scoped dev dependency.
const basic = project(
  {
    name: "basic-test",
    version: "1.0.0",
    dependencies: { "no-deps": "2.0.0", "one-fixed-dep": "1.0.0" },
    devDependencies: { "@types/no-deps": "1.0.0" },
  },
  {
    "@types/no-deps": npm("@types/no-deps@1.0.0"),
    "no-deps": npm("no-deps@2.0.0"),
    "one-fixed-dep": npm("one-fixed-dep@1.0.0", { dependencies: { "no-deps": "1.0.0" } }),
    "one-fixed-dep/no-deps": npm("no-deps@1.0.0"),
  },
);

// dragon-test-1-a <- b@1.0.0 <- c <- d <- root, and c <- e <- root. e also needs b@2.0.0.
const chain = project(
  {
    name: "chain-test",
    version: "1.0.0",
    dependencies: { "dragon-test-1-d": "1.0.0", "dragon-test-1-e": "1.0.0" },
  },
  {
    "dragon-test-1-a": npm("dragon-test-1-a@1.0.0"),
    "dragon-test-1-b": npm("dragon-test-1-b@2.0.0"),
    "dragon-test-1-c": npm("dragon-test-1-c@1.0.0", { dependencies: { "dragon-test-1-b": "1.0.0" } }),
    "dragon-test-1-d": npm("dragon-test-1-d@1.0.0", { dependencies: { "dragon-test-1-c": "1.0.0" } }),
    "dragon-test-1-e": npm("dragon-test-1-e@1.0.0", {
      dependencies: { "dragon-test-1-b": "2.0.0", "dragon-test-1-c": "1.0.0" },
    }),
    "dragon-test-1-c/dragon-test-1-b": npm("dragon-test-1-b@1.0.0", { dependencies: { "dragon-test-1-a": "1.0.0" } }),
  },
);

const workspace = project(
  { name: "workspace-root", version: "1.0.0", workspaces: ["packages/*", "apps/*"] },
  {
    "app-a": ["app-a@workspace:apps/app-a"],
    "no-deps": npm("no-deps@1.0.0"),
    "pkg-a": ["pkg-a@workspace:packages/pkg-a"],
    "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
  },
  {
    "apps/app-a": { name: "app-a", version: "1.0.0", dependencies: { "pkg-b": "workspace:*" } },
    "packages/pkg-a": { name: "pkg-a", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } },
    "packages/pkg-b": { name: "pkg-b", version: "1.0.0", dependencies: { "pkg-a": "workspace:*" } },
  },
);

// `my-alias` and `no-deps` are two versions of one package. alias-loop-1 depends on alias-loop-2 as `alias1`,
// which depends on alias-loop-1 as `alias2`.
const alias = project(
  {
    name: "alias-test",
    version: "1.0.0",
    dependencies: { "alias-loop-1": "1.0.0", "my-alias": "npm:no-deps@1.0.0", "no-deps": "2.0.0" },
  },
  {
    "alias-loop-1": npm("alias-loop-1@1.0.0", { dependencies: { alias1: "npm:alias-loop-2@*" } }),
    "alias1": npm("alias-loop-2@1.0.0", { dependencies: { alias2: "npm:alias-loop-1@*" } }),
    "alias2": npm("alias-loop-1@1.0.0", { dependencies: { alias1: "npm:alias-loop-2@*" } }),
    "my-alias": npm("no-deps@1.0.0"),
    "no-deps": npm("no-deps@2.0.0"),
  },
);

// A package.json with no name, which is what `bun add` writes in an empty directory.
const unnamedRoot = project(
  {
    dependencies: { "my-alias": "npm:no-deps@2.0.0", "one-fixed-dep": "1.0.0" },
    devDependencies: { "a-dep": "1.0.1" },
  },
  {
    "a-dep": npm("a-dep@1.0.1"),
    "my-alias": npm("no-deps@2.0.0"),
    "no-deps": npm("no-deps@1.0.0"),
    "one-fixed-dep": npm("one-fixed-dep@1.0.0", { dependencies: { "no-deps": "1.0.0" } }),
  },
);

// lib-c <- lib-a <- lib-b. The root depends on every workspace.
const libs = (name: string | undefined) =>
  project(
    { name, workspaces: ["lib-a", "lib-b", "lib-c"] },
    { "lib-a": ["lib-a@workspace:lib-a"], "lib-b": ["lib-b@workspace:lib-b"], "lib-c": ["lib-c@workspace:lib-c"] },
    {
      "lib-a": { name: "lib-a", version: "1.0.0", dependencies: { "lib-c": "workspace:*" } },
      "lib-b": { name: "lib-b", version: "1.0.0", dependencies: { "lib-a": "workspace:*" } },
      "lib-c": { name: "lib-c", version: "1.0.0" },
    },
  );

// Packages whose resolution is not a version: two workspaces, which have one in package.json, and a github package, which has none.
const notFromNpm = project(
  {
    name: "ws-root",
    version: "1.0.0",
    workspaces: ["packages/*"],
    dependencies: { "gh-pkg": "github:owner/repo#abc1234" },
  },
  {
    "gh-pkg": ["gh-pkg@github:owner/repo#abc1234", {}, "abc1234"],
    "pkg-a": ["pkg-a@workspace:packages/pkg-a"],
    "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
  },
  {
    "packages/pkg-a": { name: "pkg-a", version: "1.2.3" },
    "packages/pkg-b": { name: "pkg-b", version: "2.0.0" },
  },
);

const dependencyTypes = project(
  {
    name: "types-test",
    version: "1.0.0",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "dev-deps": "1.0.0" },
    peerDependencies: { "peer-deps-fixed": "1.0.0" },
    optionalDependencies: { "a-dep": "1.0.1" },
  },
  {
    "a-dep": npm("a-dep@1.0.1"),
    "dev-deps": npm("dev-deps@1.0.0"),
    "no-deps": npm("no-deps@1.0.0"),
    "peer-deps-fixed": npm("peer-deps-fixed@1.0.0", { peerDependencies: { "no-deps": "^1.0.0" } }),
  },
);

const multiVersion = project(
  {
    name: "multi-version-test",
    version: "1.0.0",
    dependencies: { "no-deps": "2.0.0", "old-no-deps": "npm:no-deps@1.0.0" },
  },
  { "no-deps": npm("no-deps@2.0.0"), "old-no-deps": npm("no-deps@1.0.0") },
);

const loop = project(
  { name: "loop-test", version: "1.0.0", dependencies: { "dep-loop-entry": "1.0.0" } },
  {
    "dep-loop-entry": npm("dep-loop-entry@1.0.0", { dependencies: { "dep-loop-exit": "1.0.0" } }),
    "dep-loop-exit": npm("dep-loop-exit@1.0.0", { dependencies: { "dep-loop-entry": "1.0.0" } }),
  },
);

// The no-deps@1.0.0 nested under one-fixed-dep satisfies peer-deps-fixed's `^1.0.0`, and the resolver binds the
// peer to it. But peer-deps-fixed is installed next to the root's no-deps@2.0.0 and loads that, with either linker.
const peerNextToAnotherCopy = project(
  { name: "app", dependencies: { "no-deps": "2.0.0", "one-fixed-dep": "1.0.0", "peer-deps-fixed": "1.0.0" } },
  {
    "no-deps": npm("no-deps@2.0.0"),
    "one-fixed-dep": npm("one-fixed-dep@1.0.0", { dependencies: { "no-deps": "1.0.0" } }),
    "peer-deps-fixed": npm("peer-deps-fixed@1.0.0", { peerDependencies: { "no-deps": "^1.0.0" } }),
    "one-fixed-dep/no-deps": npm("no-deps@1.0.0"),
  },
);

// peer-deps (peer `no-deps@*`) is reached from the root, next to no-deps@2.0.0, and from provides-peer-deps-1-0-0,
// which brings no-deps@1.0.0. The isolated linker gives it one store entry for each; the hoisted tree has one copy.
const peerInTwoContexts = project(
  { name: "app", dependencies: { "no-deps": "2.0.0", "peer-deps": "1.0.0", "provides-peer-deps-1-0-0": "1.0.0" } },
  {
    "no-deps": npm("no-deps@2.0.0"),
    "peer-deps": npm("peer-deps@1.0.0", { peerDependencies: { "no-deps": "*" } }),
    "provides-peer-deps-1-0-0": npm("provides-peer-deps-1-0-0@1.0.0", {
      dependencies: { "no-deps": "1.0.0", "peer-deps": "1.0.0" },
    }),
    "provides-peer-deps-1-0-0/no-deps": npm("no-deps@1.0.0"),
  },
);

const withLinker = (files: Record<string, string>, linker: "hoisted" | "isolated") => ({
  ...files,
  "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
});

describe.concurrent.each(["why", "pm why"])("bun %s", cmd => {
  let i = 0;

  async function run(files: Record<string, string | Buffer>, ...args: string[]) {
    using dir = tempDir(`why-${cmd.replace(" ", "-")}-${i++}`, files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd.split(" "), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function why(files: Record<string, string | Buffer>, ...args: string[]) {
    const { stdout, stderr, exitCode } = await run(files, ...args);
    expect(stderr).toBe("");
    return { stdout, exitCode };
  }

  // This is what `run` returns when the query matches nothing.
  const notFound = (query: string) => ({
    stdout: "",
    stderr: `error: No packages matching '${query}' found in lockfile\n`,
    exitCode: 1,
  });

  it("should show help when no package is specified", async () => {
    const { stdout, exitCode } = await why(basic);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun why <version> (<revision>)
      Explain why a package is installed

      Arguments:
        <package>     The package name or alias to explain (supports glob patterns like '@org/*')

      Options:
        --top         Show only the top dependency tree instead of nested ones
        --depth <NUM> Maximum depth of the dependency tree to display

      Examples:
        $ bun why react
        $ bun why "@types/*" --depth 2
        $ bun why "*-lodash" --top"
    `);
    expect(exitCode).toBe(1);
  });

  it("should show direct dependency", async () => {
    const { stdout, exitCode } = await why(basic, "one-fixed-dep");
    expect(stdout).toMatchInlineSnapshot(`
      "one-fixed-dep@1.0.0
        └─ basic-test (requires 1.0.0)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should show nested dependencies", async () => {
    const { stdout, exitCode } = await why(basic, "no-deps");
    expect(stdout).toMatchInlineSnapshot(`
      "no-deps@2.0.0
        └─ basic-test (requires 2.0.0)

      no-deps@1.0.0
        └─ one-fixed-dep@1.0.0 (requires 1.0.0)
           └─ basic-test (requires 1.0.0)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should handle workspace dependencies", async () => {
    const { stdout, exitCode } = await why(workspace, "pkg-a");
    // The root also depends on pkg-b, but it is not listed below a workspace, so app-a closes that branch.
    // The workspace path in the resolution uses the OS path separator.
    expect(stdout.replaceAll("\\", "/")).toMatchInlineSnapshot(`
      "pkg-a@workspace:packages/pkg-a
        ├─ pkg-b@workspace (requires workspace:*)
        │  └─ app-a@workspace (requires workspace:*)
        └─ workspace-root

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should find a package by its own name and by the alias that a dependent gives it", async () => {
    const viaAlias = "no-deps@1.0.0\n  └─ alias-test (requires my-alias@npm:no-deps@1.0.0)\n\n";
    const viaName = "no-deps@2.0.0\n  └─ alias-test (requires 2.0.0)\n\n";
    const [byPackageName, byAlias, byAliasGlob, byAliasAndVersion, byAliasAndOtherVersion, byTransitiveAlias] =
      await Promise.all([
        run(alias, "no-deps"),
        run(alias, "my-alias"),
        run(alias, "my-*"),
        run(alias, "my-alias@1.0.0"),
        run(alias, "my-alias@2.0.0"),
        run(alias, "alias1"),
      ]);
    expect({
      byPackageName,
      byAlias,
      byAliasGlob,
      byAliasAndVersion,
      byAliasAndOtherVersion,
      byTransitiveAlias,
    }).toEqual({
      byPackageName: { stdout: viaAlias + viaName, stderr: "", exitCode: 0 },
      byAlias: { stdout: viaAlias, stderr: "", exitCode: 0 },
      byAliasGlob: { stdout: viaAlias, stderr: "", exitCode: 0 },
      byAliasAndVersion: { stdout: viaAlias, stderr: "", exitCode: 0 },
      byAliasAndOtherVersion: notFound("my-alias@2.0.0"),
      byTransitiveAlias: {
        stdout: [
          "alias-loop-2@1.0.0",
          "  └─ alias-loop-1@1.0.0 (requires alias1@npm:alias-loop-2@*)",
          "     ├─ alias-test (requires 1.0.0)",
          "     └─ alias-loop-2@1.0.0 (requires alias2@npm:alias-loop-1@*)",
          "        └─ *circular",
          "",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      },
    });
  });

  it("should escape control characters in an alias", async () => {
    // `bun install` refuses such a name, so it can only come from a bun.lock that another tool or person wrote.
    const erasesTheLine = "e\x1b[2Kvil";
    const { stdout, exitCode } = await why(
      project(
        { name: "escape-test", dependencies: { [erasesTheLine]: "npm:no-deps@1.0.0" } },
        { [erasesTheLine]: npm("no-deps@1.0.0") },
      ),
      "no-deps",
    );
    expect(stdout).toBe("no-deps@1.0.0\n  └─ escape-test (requires e\\x1b[2Kvil@npm:no-deps@1.0.0)\n\n");
    expect(exitCode).toBe(0);
  });

  it("should show error for non-existent package on stderr", async () => {
    expect(await run(basic, "non-existent-package")).toEqual(notFound("non-existent-package"));
  });

  it("should list a root package.json with no name as a dependent", async () => {
    // `*` matches every name. The root has no name, so it is a dependent but not a match.
    const { stdout, exitCode } = await why(unnamedRoot, "*");
    expect(stdout).toMatchInlineSnapshot(`
      "a-dep@1.0.1
        └─ dev the root package (requires 1.0.1)

      no-deps@2.0.0
        └─ the root package (requires my-alias@npm:no-deps@2.0.0)

      no-deps@1.0.0
        └─ one-fixed-dep@1.0.0 (requires 1.0.0)
           └─ the root package (requires 1.0.0)

      one-fixed-dep@1.0.0
        └─ the root package (requires 1.0.0)

      "
    `);
    expect(exitCode).toBe(0);

    const byAlias = await why(unnamedRoot, "my-alias");
    expect(byAlias.stdout).toBe("no-deps@2.0.0\n  └─ the root package (requires my-alias@npm:no-deps@2.0.0)\n\n");
    expect(byAlias.exitCode).toBe(0);
  });

  // bun.lock cannot hold a package with no name, but an old bun.lockb can. `bun install` wrote this one with
  // `saveTextLockfile = false` for the package.json below. `anon/package.json` has no name and depends on
  // `leaf` with `file:../leaf`.
  it("should not list a folder package with no name as the root package", async () => {
    const { stdout, exitCode } = await why(
      {
        "package.json": JSON.stringify({ dependencies: { anon: "file:./anon" } }),
        "bun.lockb": readFileSync(join(import.meta.dir, "fixtures", "unnamed-folder-dependency.lockb")),
      },
      "*",
    );
    expect(stdout).toMatchInlineSnapshot(`
      "leaf@leaf
        └─ @anon (requires file:../leaf)
           └─ the root package (requires anon@file:./anon)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it.each([
    { title: "no name", name: undefined, label: "the root package" },
    { title: "a name", name: "my-app", label: "my-app" },
  ])("should list a workspace root with $title as a dependent of its workspaces", async ({ name, label }) => {
    const { stdout, exitCode } = await why(libs(name), "lib-c");
    // The root depends on lib-a too. It is not listed below a workspace, so lib-b is the last line there.
    expect(stdout).toBe(
      [
        "lib-c@workspace:lib-c",
        "  ├─ lib-a@workspace (requires workspace:*)",
        "  │  └─ lib-b@workspace (requires workspace:*)",
        `  └─ ${label}`,
        "",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  it("should show dependency types correctly", async () => {
    const dev = await why(dependencyTypes, "dev-deps");
    expect(dev.stdout).toMatchInlineSnapshot(`
      "dev-deps@1.0.0
        └─ dev types-test (requires 1.0.0)

      "
    `);
    expect(dev.exitCode).toBe(0);

    const peer = await why(dependencyTypes, "peer-deps-fixed");
    expect(peer.stdout).toMatchInlineSnapshot(`
      "peer-deps-fixed@1.0.0
        └─ peer types-test (requires 1.0.0)

      "
    `);
    expect(peer.exitCode).toBe(0);

    const optional = await why(dependencyTypes, "a-dep");
    expect(optional.stdout).toMatchInlineSnapshot(`
      "a-dep@1.0.1
        └─ optional types-test (requires 1.0.1)

      "
    `);
    expect(optional.exitCode).toBe(0);

    const prod = await why(dependencyTypes, "no-deps");
    expect(prod.stdout).toMatchInlineSnapshot(`
      "no-deps@1.0.0
        ├─ types-test (requires 1.0.0)
        └─ peer peer-deps-fixed@1.0.0 (requires ^1.0.0)
           └─ peer types-test (requires 1.0.0)

      "
    `);
    expect(prod.exitCode).toBe(0);
  });

  it("should handle packages with multiple versions", async () => {
    const { stdout, exitCode } = await why(multiVersion, "no-deps");
    expect(stdout).toMatchInlineSnapshot(`
      "no-deps@2.0.0
        └─ multi-version-test (requires 2.0.0)

      no-deps@1.0.0
        └─ multi-version-test (requires old-no-deps@npm:no-deps@1.0.0)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should handle deeply nested dependencies", async () => {
    const { stdout, exitCode } = await why(chain, "dragon-test-1-a");
    expect(stdout).toMatchInlineSnapshot(`
      "dragon-test-1-a@1.0.0
        └─ dragon-test-1-b@1.0.0 (requires 1.0.0)
           └─ dragon-test-1-c@1.0.0 (requires 1.0.0)
              ├─ dragon-test-1-d@1.0.0 (requires 1.0.0)
              │  └─ chain-test (requires 1.0.0)
              └─ dragon-test-1-e@1.0.0 (requires 1.0.0)
                 └─ chain-test (requires 1.0.0)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should mark circular dependencies", async () => {
    const { stdout, exitCode } = await why(loop, "dep-loop-exit");
    expect(stdout).toMatchInlineSnapshot(`
      "dep-loop-exit@1.0.0
        └─ dep-loop-entry@1.0.0 (requires 1.0.0)
           ├─ dep-loop-exit@1.0.0 (requires 1.0.0)
           │  └─ *circular
           └─ loop-test (requires 1.0.0)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should support glob patterns for package names", async () => {
    const scoped = await why(basic, "@types/*");
    expect(scoped.stdout).toMatchInlineSnapshot(`
      "@types/no-deps@1.0.0
        └─ dev basic-test (requires 1.0.0)

      "
    `);
    expect(scoped.exitCode).toBe(0);

    const suffix = await why(chain, "*-1-b");
    expect(suffix.stdout).toMatchInlineSnapshot(`
      "dragon-test-1-b@2.0.0
        └─ dragon-test-1-e@1.0.0 (requires 2.0.0)
           └─ chain-test (requires 1.0.0)

      dragon-test-1-b@1.0.0
        └─ dragon-test-1-c@1.0.0 (requires 1.0.0)
           ├─ dragon-test-1-d@1.0.0 (requires 1.0.0)
           │  └─ chain-test (requires 1.0.0)
           └─ dragon-test-1-e@1.0.0 (requires 1.0.0)
              └─ chain-test (requires 1.0.0)

      "
    `);
    expect(suffix.exitCode).toBe(0);

    const contains = await why(chain, "*test-1-c*");
    expect(contains.stdout).toMatchInlineSnapshot(`
      "dragon-test-1-c@1.0.0
        ├─ dragon-test-1-d@1.0.0 (requires 1.0.0)
        │  └─ chain-test (requires 1.0.0)
        └─ dragon-test-1-e@1.0.0 (requires 1.0.0)
           └─ chain-test (requires 1.0.0)

      "
    `);
    expect(contains.exitCode).toBe(0);
  });

  it("should support version constraints in the query", async () => {
    const caret = await why(basic, "no-dep*@^1.0.0");
    expect(caret.stdout).toMatchInlineSnapshot(`
      "no-deps@1.0.0
        └─ one-fixed-dep@1.0.0 (requires 1.0.0)
           └─ basic-test (requires 1.0.0)

      "
    `);
    expect(caret.exitCode).toBe(0);

    const major = await why(basic, "no-dep*@2");
    expect(major.stdout).toMatchInlineSnapshot(`
      "no-deps@2.0.0
        └─ basic-test (requires 2.0.0)

      "
    `);
    expect(major.exitCode).toBe(0);

    expect(await run(basic, "no-dep*@^3.0.0")).toEqual(notFound("no-dep*@^3.0.0"));
  });

  describe("version constraints on exact, scoped and glob names", () => {
    const noDeps1 = "no-deps@1.0.0\n  └─ one-fixed-dep@1.0.0 (requires 1.0.0)\n     └─ basic-test (requires 1.0.0)\n\n";
    const noDeps2 = "no-deps@2.0.0\n  └─ basic-test (requires 2.0.0)\n\n";
    const typesNoDeps = "@types/no-deps@1.0.0\n  └─ dev basic-test (requires 1.0.0)\n\n";

    it.each([
      { query: "no-deps", expected: noDeps2 + noDeps1 },
      { query: "no-deps@1.0.0", expected: noDeps1 },
      { query: "no-deps@^1.0.0", expected: noDeps1 },
      { query: "no-deps@2", expected: noDeps2 },
      { query: "no-deps@>=1.0.0", expected: noDeps2 + noDeps1 },
      { query: "no-deps@*", expected: noDeps2 + noDeps1 },
      { query: "no-deps@latest", expected: noDeps2 + noDeps1 },
      { query: "no-deps@", expected: noDeps2 + noDeps1 },
      { query: "no-deps@^3.0.0", expected: null },
      { query: "no-deps@beta", expected: null },
      { query: "no-dep*@1.0.0", expected: noDeps1 },
      { query: "no-dep*@beta", expected: null },
      { query: "@types/no-deps@1.0.0", expected: typesNoDeps },
      { query: "@types/no-deps@2.0.0", expected: null },
      { query: "@types/*@1.0.0", expected: typesNoDeps },
    ])("$query", async ({ query, expected }) => {
      expect(await run(basic, query)).toEqual(
        expected === null ? notFound(query) : { stdout: expected, stderr: "", exitCode: 0 },
      );
    });
  });

  describe("version constraints on a package that is not from npm", () => {
    const explained = (name: string) => `${name}@workspace:packages/${name}\n  └─ ws-root\n\n`;
    const ghPkg = "gh-pkg@github:owner/repo#abc1234\n  └─ ws-root (requires github:owner/repo#abc1234)\n\n";

    it.each([
      // A workspace has the version in its package.json.
      { query: "pkg-*@1.2.3", expected: explained("pkg-a") },
      { query: "pkg-a@1.2.3", expected: explained("pkg-a") },
      { query: "pkg-*@^1", expected: explained("pkg-a") },
      { query: "pkg-*@>=1.0.0 <2", expected: explained("pkg-a") },
      { query: "pkg-*@2.0.0", expected: explained("pkg-b") },
      { query: "pkg-*@*", expected: explained("pkg-a") + explained("pkg-b") },
      { query: "pkg-*@^3", expected: null },
      { query: "pkg-*@1.2.4", expected: null },
      { query: "pkg-*@beta", expected: null },
      // It isn't a range, so it's compared with the printed resolution, which uses the OS path separator.
      { query: `pkg-*@workspace:packages${isWindows ? "\\" : "/"}pkg-a`, expected: explained("pkg-a") },
      // A github package has no version, so only `*` (or no version) matches it.
      { query: "gh-*@*", expected: ghPkg },
      { query: "gh-*@^1", expected: null },
    ])("$query", async ({ query, expected }) => {
      const { stdout, stderr, exitCode } = await run(notFromNpm, query);
      expect({ stdout: stdout.replaceAll("\\", "/"), stderr, exitCode }).toEqual(
        expected === null ? notFound(query) : { stdout: expected, stderr: "", exitCode: 0 },
      );
    });
  });

  it("should handle nested workspaces", async () => {
    const { stdout, exitCode } = await why(workspace, "no-deps");
    expect(stdout).toMatchInlineSnapshot(`
      "no-deps@1.0.0
        └─ pkg-a@workspace (requires 1.0.0)
           └─ pkg-b@workspace (requires workspace:*)
              └─ app-a@workspace (requires workspace:*)

      "
    `);
    expect(exitCode).toBe(0);
  });

  // A peer dependency leads to the copy its owner resolves from where it is installed, which `bun why` reads from
  // the layout the linker builds: the hoisted tree, or the isolated store's peer contexts.
  describe("peer dependents follow the installed layout", () => {
    it.each(["hoisted", "isolated"] as const)(
      "a peer dependent is listed under the copy it loads (%s linker)",
      async linker => {
        const { stdout, exitCode } = await why(withLinker(peerNextToAnotherCopy, linker), "no-deps");
        expect(stdout).toMatchInlineSnapshot(`
          "no-deps@2.0.0
            ├─ app (requires 2.0.0)
            └─ peer peer-deps-fixed@1.0.0 (requires ^1.0.0)
               └─ app (requires 1.0.0)

          no-deps@1.0.0
            └─ one-fixed-dep@1.0.0 (requires 1.0.0)
               └─ app (requires 1.0.0)

          "
        `);
        expect(exitCode).toBe(0);
      },
    );

    it("a peer dependent is listed, and expanded, under every copy the isolated store wires it to", async () => {
      const { stdout, exitCode } = await why(withLinker(peerInTwoContexts, "isolated"), "no-deps");
      expect(stdout).toMatchInlineSnapshot(`
        "no-deps@2.0.0
          ├─ app (requires 2.0.0)
          └─ peer peer-deps@1.0.0 (requires *)
             ├─ app (requires 1.0.0)
             └─ provides-peer-deps-1-0-0@1.0.0 (requires 1.0.0)
                └─ app (requires 1.0.0)

        no-deps@1.0.0
          ├─ provides-peer-deps-1-0-0@1.0.0 (requires 1.0.0)
          │  └─ app (requires 1.0.0)
          └─ peer peer-deps@1.0.0 (requires *)
             ├─ app (requires 1.0.0)
             └─ provides-peer-deps-1-0-0@1.0.0 (requires 1.0.0)
                └─ app (requires 1.0.0)

        "
      `);
      expect(exitCode).toBe(0);
    });

    it("a peer dependent is listed under the one copy that the hoisted tree gives it", async () => {
      const { stdout, exitCode } = await why(withLinker(peerInTwoContexts, "hoisted"), "no-deps");
      expect(stdout).toMatchInlineSnapshot(`
        "no-deps@2.0.0
          ├─ app (requires 2.0.0)
          └─ peer peer-deps@1.0.0 (requires *)
             ├─ app (requires 1.0.0)
             └─ provides-peer-deps-1-0-0@1.0.0 (requires 1.0.0)
                └─ app (requires 1.0.0)

        no-deps@1.0.0
          └─ provides-peer-deps-1-0-0@1.0.0 (requires 1.0.0)
             └─ app (requires 1.0.0)

        "
      `);
      expect(exitCode).toBe(0);
    });
  });

  it("should support the --top flag to limit dependency tree depth", async () => {
    const { stdout, exitCode } = await why(chain, "dragon-test-1-a", "--top");
    expect(stdout).toMatchInlineSnapshot(`
      "dragon-test-1-a@1.0.0
        └─ dragon-test-1-b@1.0.0 (requires 1.0.0)

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should support the --depth flag to limit dependency tree depth", async () => {
    const depth2 = await why(chain, "dragon-test-1-a", "--depth", "2");
    expect(depth2.stdout).toMatchInlineSnapshot(`
      "dragon-test-1-a@1.0.0
        └─ dragon-test-1-b@1.0.0 (requires 1.0.0)
           └─ dragon-test-1-c@1.0.0 (requires 1.0.0)
              └─ (deeper dependencies hidden)

      "
    `);
    expect(depth2.exitCode).toBe(0);

    const depth0 = await why(chain, "dragon-test-1-a", "--depth", "0");
    expect(depth0.stdout).toMatchInlineSnapshot(`
      "dragon-test-1-a@1.0.0
        └─ (deeper dependencies hidden)

      "
    `);
    expect(depth0.exitCode).toBe(0);
  });

  describe("packages reachable through more than one path", () => {
    // Workspace packages that only depend on each other, so `bun install` never
    // contacts a registry. The root sorts before the `pkg-*`/`w*` names.
    function workspaceFixture(name: string, dependencies: Record<string, string[]>) {
      const files: Record<string, string> = {
        "package.json": JSON.stringify({ name: "monorepo", private: true, workspaces: ["p/*"] }),
      };
      for (const [pkg, deps] of Object.entries(dependencies)) {
        files[`p/${pkg}/package.json`] = JSON.stringify({
          name: pkg,
          version: "1.0.0",
          dependencies: Object.fromEntries(deps.map(dep => [dep, "workspace:*"])),
        });
      }
      return tempDir(name, files);
    }

    async function installAndWhy(cwd: string, args: string[]) {
      await using install = Bun.spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, installStderr, installExitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      expect(installStderr).toContain("Saved lockfile");
      expect(installExitCode).toBe(0);

      await using why = Bun.spawn({
        cmd: [bunExe(), ...cmd.split(" "), ...args],
        cwd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([why.stdout.text(), why.stderr.text(), why.exited]);
      return {
        // The tree prints spacer lines that are only a trailing prefix.
        stdout: normalizeBunSnapshot(stdout)
          .split("\n")
          .map(line => line.trimEnd())
          .join("\n"),
        stderr,
        exitCode,
      };
    }

    // pkg-c is listed under pkg-x twice: it depends on pkg-x directly and on
    // pkg-a, which depends on pkg-x.
    const diamond = {
      "pkg-x": [],
      "pkg-a": ["pkg-x"],
      "pkg-c": ["pkg-x", "pkg-a"],
      "pkg-d": ["pkg-c"],
      "pkg-f": ["pkg-d"],
    };

    it("prints the dependents of a package once and marks later occurrences as deduped", async () => {
      using dir = workspaceFixture("why-deduped", diamond);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-a@workspace (requires workspace:*)
          │  └─ pkg-c@workspace (requires workspace:*)
          │     └─ pkg-d@workspace (requires workspace:*)
          │        └─ pkg-f@workspace (requires workspace:*)
          └─ pkg-c@workspace (requires workspace:*)
             └─ *deduped"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("expands a deduped package again when --depth cut it off at a deeper occurrence", async () => {
      using dir = workspaceFixture("why-deduped-depth", diamond);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x", "--depth", "3"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-a@workspace (requires workspace:*)
          │  └─ pkg-c@workspace (requires workspace:*)
          │     └─ pkg-d@workspace (requires workspace:*)
          │        └─ (deeper dependencies hidden)
          └─ pkg-c@workspace (requires workspace:*)
             └─ pkg-d@workspace (requires workspace:*)
                └─ pkg-f@workspace (requires workspace:*)"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    // pkg-x and pkg-a depend on each other, so walking up from pkg-x comes back to it. pkg-b is listed under
    // both of them.
    const cycleThroughTheQuery = {
      "pkg-x": ["pkg-a"],
      "pkg-a": ["pkg-x"],
      "pkg-b": ["pkg-x", "pkg-a"],
      "pkg-c": ["pkg-b"],
      "pkg-d": ["pkg-c"],
    };

    it("marks the queried package as circular at its first repeat and still dedupes the packages listed next to it", async () => {
      using dir = workspaceFixture("why-cycle-through-query", cycleThroughTheQuery);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-a@workspace (requires workspace:*)
          │  ├─ pkg-b@workspace (requires workspace:*)
          │  │  └─ pkg-c@workspace (requires workspace:*)
          │  │     └─ pkg-d@workspace (requires workspace:*)
          │  └─ pkg-x@workspace (requires workspace:*)
          │     └─ *circular
          │
          └─ pkg-b@workspace (requires workspace:*)
             └─ *deduped"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("marks the queried package as circular with --depth and expands again what the limit cut off", async () => {
      using dir = workspaceFixture("why-cycle-through-query-depth", cycleThroughTheQuery);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x", "--depth", "3"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-a@workspace (requires workspace:*)
          │  ├─ pkg-b@workspace (requires workspace:*)
          │  │  └─ pkg-c@workspace (requires workspace:*)
          │  │     └─ (deeper dependencies hidden)
          │  └─ pkg-x@workspace (requires workspace:*)
          │     └─ *circular
          │
          └─ pkg-b@workspace (requires workspace:*)
             └─ pkg-c@workspace (requires workspace:*)
                └─ pkg-d@workspace (requires workspace:*)"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    // pkg-a and pkg-p depend on each other. Walking up from pkg-x, the cycle is
    // first reached through pkg-l1 -> pkg-l2 -> pkg-a, where pkg-p's only
    // dependent (pkg-a) is cut off as circular, and again through pkg-p itself,
    // three levels closer to pkg-x.
    const cycle = {
      "pkg-x": [],
      "pkg-l1": ["pkg-x"],
      "pkg-l2": ["pkg-l1"],
      "pkg-a": ["pkg-l2", "pkg-p"],
      "pkg-p": ["pkg-a", "pkg-x"],
      "pkg-q1": ["pkg-a"],
      "pkg-q2": ["pkg-q1"],
      "pkg-q3": ["pkg-q2"],
    };

    it("does not dedupe a package whose circular branch hides what --depth would show closer to the root", async () => {
      using dir = workspaceFixture("why-deduped-cycle-depth", cycle);

      // pkg-q3 only fits within the depth limit under the shorter chain.
      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x", "--depth", "5"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-l1@workspace (requires workspace:*)
          │  └─ pkg-l2@workspace (requires workspace:*)
          │     └─ pkg-a@workspace (requires workspace:*)
          │        ├─ pkg-p@workspace (requires workspace:*)
          │        │  └─ pkg-a@workspace (requires workspace:*)
          │        │     └─ *circular
          │        └─ pkg-q1@workspace (requires workspace:*)
          │           └─ pkg-q2@workspace (requires workspace:*)
          │              └─ (deeper dependencies hidden)
          │
          └─ pkg-p@workspace (requires workspace:*)
             └─ pkg-a@workspace (requires workspace:*)
                ├─ pkg-p@workspace (requires workspace:*)
                │  └─ *circular
                └─ pkg-q1@workspace (requires workspace:*)
                   └─ pkg-q2@workspace (requires workspace:*)
                      └─ pkg-q3@workspace (requires workspace:*)"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("dedupes a package inside a cycle once its dependents were printed in full", async () => {
      using dir = workspaceFixture("why-deduped-cycle", cycle);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-l1@workspace (requires workspace:*)
          │  └─ pkg-l2@workspace (requires workspace:*)
          │     └─ pkg-a@workspace (requires workspace:*)
          │        ├─ pkg-p@workspace (requires workspace:*)
          │        │  └─ pkg-a@workspace (requires workspace:*)
          │        │     └─ *circular
          │        └─ pkg-q1@workspace (requires workspace:*)
          │           └─ pkg-q2@workspace (requires workspace:*)
          │              └─ pkg-q3@workspace (requires workspace:*)
          │
          └─ pkg-p@workspace (requires workspace:*)
             └─ *deduped"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("keeps the output linear when every package depends on the next two", async () => {
      // w00 depends on w01 and w02, w01 on w02 and w03, and so on, so the
      // number of dependency paths between w15 and any one package grows like
      // the Fibonacci sequence.
      const count = 16;
      const name = (i: number) => `w${String(i).padStart(2, "0")}`;
      const ladder: Record<string, string[]> = {};
      for (let i = 0; i < count; i++) {
        ladder[name(i)] = [i + 1, i + 2].filter(j => j < count).map(name);
      }
      using dir = workspaceFixture("why-ladder", ladder);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), [name(count - 1)]);
      const lines = stdout.split("\n");
      expect({
        // w08 depends on w09 and w10, so it is listed under each of them, and
        // each of those is expanded exactly once.
        w08: lines.filter(line => line.includes("w08@workspace")).length,
        // One marker each for w02 through w13. w00 and w01 have at most one line
        // below them, so they are repeated instead, and w14 is only listed once
        // because it only depends on w15.
        deduped: lines.filter(line => line.endsWith("*deduped")).length,
        stderr,
        exitCode,
      }).toEqual({ w08: 2, deduped: count - 4, stderr: "", exitCode: 0 });
    });
  });
});
