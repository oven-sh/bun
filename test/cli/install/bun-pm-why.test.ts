import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// `bun why` reads only bun.lock, so every project here is a package.json plus a
// static lockfile. Nothing is installed and no registry is contacted. The
// packages come from test/cli/install/registry/packages.
const integrity: Record<string, string> = {
  "@types/no-deps@1.0.0":
    "sha512-quthzD2O04AlTaZLJGf4a6/6aD7lf4Qa4HS7ViRWnTFdSbRbof20GFoq9YRCD3YQxd/HKI83YBAAiZ4ewoy+0Q==",
  "a-dep@1.0.1": "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg==",
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
  "peer-deps-fixed@1.0.0":
    "sha512-gVs9cSdy6TAQIEWu1tVEK1mAspCQxYziTGQlv4a2XQpzOBZvoQ/y6lOeu3tqNNrNQnLwdvwAQTlvazV5+HfV7g==",
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

const alias = project(
  { name: "alias-test", version: "1.0.0", dependencies: { "alias-pkg": "npm:no-deps@1.0.0" } },
  { "alias-pkg": npm("no-deps@1.0.0") },
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

describe.concurrent.each(["why", "pm why"])("bun %s", cmd => {
  let i = 0;

  async function why(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir(`why-${cmd.replace(" ", "-")}-${i++}`, files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd.split(" "), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    return { stdout, exitCode };
  }

  it("should show help when no package is specified", async () => {
    const { stdout, exitCode } = await why(basic);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun why <version> (<revision>)
      Explain why a package is installed

      Arguments:
      <package>     The package name to explain (supports glob patterns like '@org/*')

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
    // The workspace path in the resolution uses the OS path separator.
    expect(stdout.replaceAll("\\", "/")).toMatchInlineSnapshot(`
      "pkg-a@workspace:packages/pkg-a
        ├─ pkg-b@workspace (requires workspace:*)
        │  ├─ app-a@workspace (requires workspace:*)
        └─ workspace-root

      "
    `);
    expect(exitCode).toBe(0);
  });

  it("should handle npm aliases", async () => {
    // The lockfile stores an aliased package under its real name, so the alias itself is not a match.
    const realName = await why(alias, "no-deps");
    expect(realName.stdout).toMatchInlineSnapshot(`
      "no-deps@1.0.0
        └─ alias-test (requires npm:no-deps@1.0.0)

      "
    `);
    expect(realName.exitCode).toBe(0);

    const aliasName = await why(alias, "alias-pkg");
    expect(aliasName.stdout).toMatchInlineSnapshot(`
      "error: No packages matching 'alias-pkg' found in lockfile
      "
    `);
    expect(aliasName.exitCode).toBe(1);
  });

  it("should show error for non-existent package", async () => {
    const { stdout, exitCode } = await why(basic, "non-existent-package");
    expect(stdout).toMatchInlineSnapshot(`
      "error: No packages matching 'non-existent-package' found in lockfile
      "
    `);
    expect(exitCode).toBe(1);
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
        └─ multi-version-test (requires npm:no-deps@1.0.0)

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
           │  └─ dep-loop-entry@1.0.0 (requires 1.0.0)
           │     └─ *circular
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

    const unmatched = await why(basic, "no-dep*@^3.0.0");
    expect(unmatched.stdout).toMatchInlineSnapshot(`
      "error: No packages matching 'no-dep*@^3.0.0' found in lockfile
      "
    `);
    expect(unmatched.exitCode).toBe(1);
  });

  // An exact name with a version is compared as one string against the package name, so it
  // never matches. #43284 fixes this.
  it.todo("should support version constraints on an exact name", async () => {
    const { stdout, exitCode } = await why(basic, "no-deps@^1.0.0");
    expect(stdout).toBe(
      "no-deps@1.0.0\n  └─ one-fixed-dep@1.0.0 (requires 1.0.0)\n     └─ basic-test (requires 1.0.0)\n\n",
    );
    expect(exitCode).toBe(0);
  });

  it("should handle nested workspaces", async () => {
    const { stdout, exitCode } = await why(workspace, "no-deps");
    expect(stdout).toMatchInlineSnapshot(`
      "no-deps@1.0.0
        └─ pkg-a@workspace (requires 1.0.0)
           ├─ pkg-b@workspace (requires workspace:*)
           │  ├─ app-a@workspace (requires workspace:*)

      "
    `);
    expect(exitCode).toBe(0);
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
          │
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
          │
          └─ pkg-c@workspace (requires workspace:*)
             └─ pkg-d@workspace (requires workspace:*)
                └─ pkg-f@workspace (requires workspace:*)"
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
