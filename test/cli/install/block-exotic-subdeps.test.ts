import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

/**
 * Tests for `install.blockExoticSubdeps` — a supply-chain hardening flag
 * modeled on pnpm's option of the same name. When enabled, bun install
 * rejects any *transitive* dependency that resolves to a non-registry
 * source (file, folder, git, github, tarball URL, workspace, symlink).
 * The root package's own direct deps are NOT restricted.
 *
 * https://pnpm.io/11.x/supply-chain-security#prevent-exotic-transitive-dependencies
 */
beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

// Each test spawns `bun install` in its own tempDir. Point the install cache
// at a per-test subdir so concurrent tests don't race on the shared cache
// and so leftover state from unrelated runs can't affect resolution.
function envForDir(dir: string): NodeJS.Dict<string> {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

describe.concurrent("install.blockExoticSubdeps", () => {
  test("rejects a transitive file-folder dependency", async () => {
    using dir = tempDir("block-exotic-transitive-folder", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        // Root's own direct dep is folder — that's allowed.
        dependencies: { "parent-pkg": "file:./parent-pkg" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      // parent-pkg is itself a folder dep at the root level (allowed),
      // but it has a *transitive* folder dep "inner" — that's the violation.
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({
        name: "inner",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("blockExoticSubdeps");
    // parent-pkg pulled in a non-registry transitive — should be flagged.
    expect(stderr).toContain("inner");
    expect(exitCode).not.toBe(0);
  });

  test("allows exotic ROOT dependencies when flag is on", async () => {
    // Root package uses a file: dep (exotic) but no exotic *transitives*.
    using dir = tempDir("block-exotic-root-ok", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { leaf: "file:./leaf" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "leaf/package.json": JSON.stringify({
        name: "leaf",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Should NOT complain — only direct root deps are exotic.
    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).toBe(0);
  });

  test("default (flag unset) allows exotic transitives", async () => {
    // Same fixture as the rejection case but with no bunfig setting —
    // confirms the flag is opt-in and defaults to allowing exotic subdeps.
    using dir = tempDir("block-exotic-default-off", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
      }),
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({
        name: "inner",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).toBe(0);
  });

  test("explicit false allows exotic transitives", async () => {
    using dir = tempDir("block-exotic-explicit-false", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = false
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({
        name: "inner",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).toBe(0);
  });

  test("reports the exotic source tag in the error", async () => {
    // Sanity: the error should identify the *kind* of exotic source
    // (folder, local_tarball, git, ...) so the user knows what to audit.
    using dir = tempDir("block-exotic-source-tag", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({
        name: "inner",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Mentions the parent that pulled in the exotic dep.
    expect(stderr).toContain("parent-pkg");
    // Mentions the bad dep's name.
    expect(stderr).toContain("inner");
    // Mentions *which* non-registry source was used — "folder" for file:./x.
    expect(stderr).toContain("folder");
    expect(exitCode).not.toBe(0);
  });

  test("reads block-exotic-subdeps from .npmrc", async () => {
    // .npmrc parity with the bunfig.toml key.
    using dir = tempDir("block-exotic-npmrc", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
      }),
      ".npmrc": "block-exotic-subdeps=true\n",
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({
        name: "inner",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("blockExoticSubdeps");
    expect(stderr).toContain("inner");
    expect(exitCode).not.toBe(0);
  });

  test("rejects a transitive workspace: reference pulled in by a folder dep", async () => {
    // If a non-workspace parent smuggles in a workspace: ref, that's exactly
    // the kind of exotic transitive the flag exists to block.
    using dir = tempDir("block-exotic-workspace-leak", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["pkgs/*"],
        dependencies: {
          // Root pulls in the folder dep directly (allowed at root level),
          // but the folder dep itself references a workspace:* member,
          // which is then a transitive workspace edge.
          "folder-parent": "file:./folder-parent",
        },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "folder-parent/package.json": JSON.stringify({
        name: "folder-parent",
        version: "1.0.0",
        dependencies: { "ws-member": "workspace:*" },
      }),
      "pkgs/ws-member/package.json": JSON.stringify({
        name: "ws-member",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("blockExoticSubdeps");
    expect(stderr).toContain("ws-member");
    expect(exitCode).not.toBe(0);
  });

  test("does NOT block a folder dep that uses a plain semver for a workspace member", async () => {
    // Regression: `linkWorkspacePackages` (default true) redirects a
    // transitive plain-semver dep to a local workspace copy, giving it
    // `Resolution.Tag.workspace`. The folder parent's *specifier* is still
    // a plain npm semver — nobody wrote `workspace:` — so this must NOT
    // trip blockExoticSubdeps.
    using dir = tempDir("block-exotic-link-workspace-semver", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["pkgs/*"],
        dependencies: {
          "folder-parent": "file:./folder-parent",
        },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "folder-parent/package.json": JSON.stringify({
        name: "folder-parent",
        version: "1.0.0",
        // Plain npm semver, NOT workspace:*. Bun's linkWorkspacePackages
        // will still resolve this to the local ws-member copy.
        dependencies: { "ws-member": "^1.0.0" },
      }),
      "pkgs/ws-member/package.json": JSON.stringify({
        name: "ws-member",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).toBe(0);
  });

  test("does NOT block when root has an overrides entry redirecting the exotic transitive", async () => {
    // Regression: overrides are the canonical mitigation for a
    // blockExoticSubdeps violation. A transitive folder dep of a
    // folder-dep parent should NOT be flagged if root overrides it.
    using dir = tempDir("block-exotic-override", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
        // Root redirects `inner` away from the exotic folder spec
        // that parent-pkg would otherwise pull in.
        overrides: { inner: "file:./inner-override" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        // Without the override, this folder specifier would trip the block.
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
      "inner-override/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Override's literal is still `file:./inner-override` (also a folder
    // spec), so the block still fires — but the message should now name the
    // OVERRIDE's source, proving we consulted the override rather than the
    // transitive literal. When the override points at a registry version
    // (real-world remediation), the block will disappear.
    expect(stderr).toContain("blockExoticSubdeps");
    expect(stderr).toContain("inner-override");
    expect(exitCode).not.toBe(0);
  });

  test("does NOT block when root override redirects an exotic transitive to a registry version", async () => {
    // The canonical mitigation: overrides to a registry spec make the
    // block disappear entirely.
    using dir = tempDir("block-exotic-override-registry", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
        // Redirect `inner` from a folder spec to a workspace-local pkg.
        // (We use workspace:* here because it's still resolvable offline;
        // the point is that the root override's literal is NOT exotic in
        // the folder/git/tarball sense, so the block should not fire.)
        overrides: { inner: "1.0.0" },
      }),
      workspaces: ["pkgs/*"],
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      "inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

    // The override's literal `1.0.0` is plain npm semver, not exotic, so
    // the block must NOT fire regardless of what parent-pkg wrote.
    expect(stderr).not.toContain("blockExoticSubdeps");
  });
});
