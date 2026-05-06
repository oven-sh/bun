import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

/**
 * Tests for `install.blockExoticSubdeps` — a supply-chain hardening flag
 * modeled on pnpm's option of the same name. When enabled, bun install
 * rejects any *transitive* dependency that resolves to a non-registry
 * source (file, folder, git, github, tarball URL, workspace, symlink).
 * The root package's own direct deps are NOT restricted.
 *
 * https://pnpm.io/11.x/supply-chain-security#prevent-exotic-transitive-dependencies
 */
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
      env: bunEnv,
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
      env: bunEnv,
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
      env: bunEnv,
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
      env: bunEnv,
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
      env: bunEnv,
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
});
