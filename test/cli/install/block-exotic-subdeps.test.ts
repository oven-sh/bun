import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

/**
 * Tests for `install.blockExoticSubdeps` — a supply-chain hardening flag
 * modeled on pnpm's option of the same name. When enabled, bun install
 * rejects any *transitive* dependency that is specified with a non-registry
 * source (file, folder, git, github, tarball URL, workspace, symlink).
 * The root package's own direct deps are NOT restricted.
 *
 * https://pnpm.io/11.x/supply-chain-security#prevent-exotic-transitive-dependencies
 */

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).toBe(0);
  });

  test("still blocks when root override is also exotic, and reports the override literal", async () => {
    // An exotic-to-exotic override still trips the flag — and crucially the
    // error message names the OVERRIDE's literal (not the transitive
    // parent's), proving `enforceBlockExoticSubdeps` consulted the
    // override map rather than the stale transitive spec.
    using dir = tempDir("block-exotic-override-still-exotic", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
        overrides: { inner: "file:./inner-override" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
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

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("blockExoticSubdeps");
    // The override's literal — NOT the transitive parent's `file:../inner` —
    // is what must appear, proving we routed through the override.
    expect(stderr).toContain("inner-override");
    expect(exitCode).not.toBe(0);
  });

  test("does NOT block when root override redirects an exotic transitive to a registry version", async () => {
    // The canonical mitigation path: override `inner` from its exotic
    // folder specifier to a plain semver. With `linkWorkspacePackages`
    // (default true) and a matching workspace member, the semver resolves
    // locally — no network, no registry required — and the block does not
    // fire because the override's literal (`^1.0.0`) is non-exotic.
    using dir = tempDir("block-exotic-override-registry", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["pkgs/*"],
        dependencies: { "parent-pkg": "file:./parent-pkg" },
        overrides: { inner: "^1.0.0" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "file:../inner" },
      }),
      // Workspace member that `^1.0.0` satisfies. linkWorkspacePackages
      // redirects the semver here offline.
      "pkgs/inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
      // Original exotic target — left in place to prove that even though
      // parent-pkg's literal still points here, the override wins.
      "inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The override's literal `^1.0.0` is plain npm semver, not exotic, so
    // the block must NOT fire regardless of what parent-pkg wrote.
    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).toBe(0);
  });

  test("blocks exotic specifiers that have attacker-controlled leading whitespace", async () => {
    // `Dependency::parse` trims leading whitespace before classifying a
    // specifier but stores the *untrimmed* string as `.literal`. classify()
    // re-infers from that literal for `.workspace` resolutions, so it must
    // trim the same way: untrimmed `" workspace:*"` mis-infers as a git
    // SCP shorthand. The block must fire AND carry the correct `workspace`
    // source label (asserted below), which pins the trim.
    using dir = tempDir("block-exotic-whitespace-bypass", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["pkgs/*"],
        dependencies: { "folder-parent": "file:./folder-parent" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      // One leading space before `workspace:` — JSON.stringify preserves
      // whitespace inside string values verbatim, which is exactly the
      // attacker vector this test exercises.
      "folder-parent/package.json": JSON.stringify({
        name: "folder-parent",
        version: "1.0.0",
        dependencies: { "ws-member": " workspace:*" },
      }),
      "pkgs/ws-member/package.json": JSON.stringify({ name: "ws-member", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("blockExoticSubdeps");
    expect(stderr).toContain("ws-member");
    // The source label must be `workspace`, not the git SCP shorthand the
    // untrimmed literal would infer as — this is what pins the trim.
    expect(stderr).toContain("via workspace source");
    expect(exitCode).not.toBe(0);
  });

  test("does not claim a transitive 'catalog:' reference that fails to resolve", async () => {
    // `catalog:` is only usable by workspace packages (pnpm parity), so a
    // non-workspace folder parent writing `catalog:` fails resolution
    // upstream of this flag. The flag must not mislabel that resolve
    // failure as an exotic-subdep violation. classify() also keeps a
    // catalog short-circuit as defense in case a catalog-dereferenced
    // resolution ever reaches a checked edge again.
    using dir = tempDir("block-exotic-catalog-transitive", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
        workspaces: {
          catalog: { shared: "file:./shared" },
        },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { shared: "catalog:" },
      }),
      "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The failure is the resolver's, not this flag's.
    expect(stderr).toContain("failed to resolve");
    expect(stderr).not.toContain("blockExoticSubdeps");
    expect(exitCode).not.toBe(0);
  });

  test("blocks when a root override redirects a registry transitive to an exotic source", async () => {
    // The transitive wrote a plain registry semver; the root's override is
    // what introduces the non-registry source. The override literal is the
    // effective specifier (it replaces the nested one before the check), so
    // the block fires and the error names the override's own literal.
    using dir = tempDir("block-exotic-override-introduces-exotic", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        dependencies: { "parent-pkg": "file:./parent-pkg" },
        overrides: { inner: "file:./my-fork" },
      }),
      "bunfig.toml": `[install]
blockExoticSubdeps = true
`,
      "parent-pkg/package.json": JSON.stringify({
        name: "parent-pkg",
        version: "1.0.0",
        dependencies: { inner: "^1.0.0" },
      }),
      "my-fork/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: envForDir(String(dir)),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("blockExoticSubdeps");
    // Names the override's literal, making clear the user's own override
    // is the non-registry source.
    expect(stderr).toContain("my-fork");
    expect(exitCode).not.toBe(0);
  });
});
