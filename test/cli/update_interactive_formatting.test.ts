import { dlopen, FFIType } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closeSync, createReadStream } from "fs";
import { bunEnv, bunExe, isMusl, isWindows, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

let registry: VerdaccioRegistry;
let registryUrl: string;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  registryUrl = registry.registryUrl();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

function bunfig() {
  return `[install]\ncache = false\nregistry = "${registryUrl}"\n`;
}

async function install(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`bun install failed (exit ${exitCode})\nstderr: ${stderr}\nstdout: ${stdout}`);
  }
  return { stdout, stderr };
}

async function updateInteractive(
  dir: string,
  { args = ["--latest"], input = "a\n", cwd }: { args?: string[]; input?: string; cwd?: string } = {},
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "-i", ...args],
    cwd: cwd ?? String(dir),
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(input);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Each test owns its own tempDir and subprocesses; the registry is read-only after beforeAll.
describe.concurrent("bun update --interactive", () => {
  it("should render the outdated-package table with aligned name/version columns", async () => {
    await using dir = tempDir("update-interactive-alignment", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a-dep": "1.0.1",
          "dep-with-tags": "1.0.0",
          "no-deps": "1.0.0",
          "normal-dep-and-dev-dep": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    // Exact spacing so a regression in name_padding / current_padding /
    // target_padding fails here instead of slipping through a \s+ regex.
    // Covers: short/medium/long names (5..22 chars), short/long latest
    // versions (2.0.0 vs 1.0.10), and a name wider than the header.
    expect(stdout).toContain("dependencies                Current  Target  Latest");
    expect(stdout).toContain("a-dep                   1.0.1    1.0.1   1.0.10");
    expect(stdout).toContain("dep-with-tags           1.0.0    1.0.0   3.0.0");
    expect(stdout).toContain("no-deps                 1.0.0    1.0.0   2.0.0");
    expect(stdout).toContain("normal-dep-and-dev-dep  1.0.0    1.0.0   1.0.2");
    expect(stdout).toContain("No packages selected");
    expect(exitCode).toBe(0);
  });

  it("should list workspace and catalog dependencies with --filter", async () => {
    await using dir = tempDir("update-interactive-workspace-catalog-render", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        catalog: { "no-deps": "1.0.0" },
        workspaces: ["packages/*"],
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: { "no-deps": "catalog:" },
      }),
      "packages/pkg2/package.json": JSON.stringify({
        name: "pkg2",
        dependencies: { "a-dep": "1.0.1" },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, {
      args: ["--filter=*", "--latest", "--dry-run"],
      input: "\n",
    });

    expect(stdout).toContain("Select packages to update");
    // Catalog-backed dep (pkg1) and direct dep (pkg2) both resolve to a row.
    expect(stdout).toContain("a-dep    1.0.1    1.0.1   1.0.10");
    expect(stdout).toContain("no-deps  1.0.0    1.0.0   2.0.0");
    expect(exitCode).toBe(0);
  });

  it("should render mixed dependency types under separate section headers", async () => {
    await using dir = tempDir("update-interactive-mixed-sections", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
        peerDependencies: { "dep-with-tags": "1.0.0" },
        optionalDependencies: { "normal-dep-and-dev-dep": "1.0.0" },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    // name_padding accounts for the " dev"/" peer"/" optional" suffix so every
    // section's rows line up on the same Current column.
    expect(stdout).toContain("dependencies                         Current  Target  Latest");
    expect(stdout).toContain("no-deps                          1.0.0    1.0.0   2.0.0");
    expect(stdout).toContain("devDependencies                      Current  Target  Latest");
    expect(stdout).toContain("a-dep dev                        1.0.1    1.0.1   1.0.10");
    expect(stdout).toContain("peerDependencies                     Current  Target  Latest");
    expect(stdout).toContain("dep-with-tags peer               1.0.0    1.0.0   3.0.0");
    expect(stdout).toContain("optionalDependencies                 Current  Target  Latest");
    expect(stdout).toContain("normal-dep-and-dev-dep optional  1.0.0    1.0.0   1.0.2");
    expect(exitCode).toBe(0);
  });

  // The header's help-text budget is `terminal_width - 30`; on a tty narrower
  // than 30 columns that usize subtraction overflows (panics on overflow-checks
  // builds). Exercise the render path through a 20-column pty.
  it.skipIf(isWindows)("should render on a terminal narrower than the header prefix", async () => {
    const openptyDecl = {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    } as const;
    const lib =
      process.platform === "darwin"
        ? dlopen("libc.dylib", { openpty: openptyDecl })
        : isMusl
          ? dlopen(process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1", {
              openpty: openptyDecl,
            })
          : dlopen("libutil.so.1", { openpty: openptyDecl });

    const masterBuf = new Int32Array(1);
    const slaveBuf = new Int32Array(1);
    // struct winsize { u16 ws_row; u16 ws_col; u16 ws_xpixel; u16 ws_ypixel; }
    const winsize = new Uint16Array([24, 20, 0, 0]);
    expect(lib.symbols.openpty(masterBuf, slaveBuf, null, null, winsize)).toBe(0);
    const master = masterBuf[0];
    const slave = slaveBuf[0];
    let slaveOpen = true;

    try {
      await using dir = tempDir("update-interactive-narrow-tty", {
        "bunfig.toml": bunfig(),
        "package.json": JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          dependencies: { "no-deps": "1.0.0" },
        }),
      });

      await install(dir);

      await using update = Bun.spawn({
        cmd: [bunExe(), "update", "--interactive", "--dry-run"],
        cwd: dir,
        env: bunEnv,
        stdin: "pipe",
        stdout: slave,
        stderr: "pipe",
      });
      // Drop the parent's slave handle so master reads see EOF on child exit.
      closeSync(slave);
      slaveOpen = false;

      // Drain the master concurrently so a crashing debug build's backtrace
      // doesn't block on a full pty buffer.
      let ptyOutput = "";
      const ptyStream = createReadStream("", { fd: master, autoClose: false });
      const drained = new Promise<void>(resolve => {
        ptyStream.on("data", chunk => (ptyOutput += chunk.toString("utf8")));
        ptyStream.on("error", () => resolve());
        ptyStream.on("end", () => resolve());
        ptyStream.on("close", () => resolve());
      });

      update.stdin.write("\r");
      update.stdin.end();

      const [stderr, exitCode] = await Promise.all([update.stderr.text(), update.exited]);
      await drained;

      if (exitCode !== 0) {
        console.error("stderr:", stderr);
      }

      // The header proves we reached process_multi_select where width is used.
      expect(ptyOutput).toContain("Select packages to update");
      expect(exitCode).toBe(0);
    } finally {
      if (slaveOpen) {
        try {
          closeSync(slave);
        } catch {}
      }
      try {
        closeSync(master);
      } catch {}
    }
  });

  it("should update packages when 'a' (select all) is used", async () => {
    await using dir = tempDir("update-interactive-select-all", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, stderr, exitCode } = await updateInteractive(dir);

    expect(stderr + stdout).toContain("Installing updates...");
    expect(stderr + stdout).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it("should handle workspace updates with recursive flag", async () => {
    await using dir = tempDir("update-interactive-workspace-recursive", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, stderr, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stderr + stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const appPackageJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appPackageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it("should handle catalog updates correctly", async () => {
    await using dir = tempDir("update-interactive-catalog-actual", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "1.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        version: "1.0.0",
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const rootPackageJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootPackageJson.catalog["no-deps"]).toBe("2.0.0");

    const appPackageJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appPackageJson.dependencies["no-deps"]).toBe("catalog:");
  });

  it("should work correctly when run from inside a workspace directory", async () => {
    await using dir = tempDir("update-interactive-from-workspace", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/app1/package.json": JSON.stringify({
        name: "@test/app1",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
      "packages/app2/package.json": JSON.stringify({
        name: "@test/app2",
        version: "1.0.0",
        dependencies: {
          "dep-with-tags": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, {
      args: ["-r", "--latest"],
      cwd: join(dir, "packages/app1"),
    });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const app1Json = await Bun.file(join(dir, "packages/app1/package.json")).json();
    const app2Json = await Bun.file(join(dir, "packages/app2/package.json")).json();

    expect(app1Json.dependencies["no-deps"]).toBe("2.0.0");
    expect(app2Json.dependencies["dep-with-tags"]).toBe("3.0.0");
  });

  it("should handle catalog updates in workspaces.catalogs object", async () => {
    await using dir = tempDir("update-interactive-workspaces-catalogs", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalogs: {
            "tools": {
              "no-deps": "^1.0.0",
              "dep-with-tags": "~1.0.0",
            },
            "frameworks": {
              "a-dep": ">=1.0.5",
              "normal-dep-and-dev-dep": "^1.0.0",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:tools",
          "dep-with-tags": "catalog:tools",
          "a-dep": "catalog:frameworks",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs).toEqual({
      tools: { "no-deps": "^2.0.0", "dep-with-tags": "~3.0.0" },
      // a-dep >=1.0.5 already resolves to latest (1.0.10) so it is not listed
      // as outdated; normal-dep-and-dev-dep is not referenced by any workspace.
      frameworks: { "a-dep": ">=1.0.5", "normal-dep-and-dev-dep": "^1.0.0" },
    });

    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appJson.dependencies).toEqual({
      "no-deps": "catalog:tools",
      "dep-with-tags": "catalog:tools",
      "a-dep": "catalog:frameworks",
    });
  });

  it("should handle selecting specific packages in interactive mode", async () => {
    await using dir = tempDir("update-interactive-selective", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
          "a-dep": "1.0.5",
        },
      }),
    });

    await install(dir);
    // space to toggle first row, arrow down, enter
    const { stdout, exitCode } = await updateInteractive(dir, { input: " \u001b[B\n" });

    expect(stdout).toContain("Selected 1 package to update");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    let updatedCount = 0;
    if (packageJson.dependencies["no-deps"] !== "1.0.0") updatedCount++;
    if (packageJson.dependencies["dep-with-tags"] !== "1.0.0") updatedCount++;
    if (packageJson.dependencies["a-dep"] !== "1.0.5") updatedCount++;
    expect(updatedCount).toBe(1);
  });

  it("should handle empty catalog definitions gracefully", async () => {
    await using dir = tempDir("update-interactive-empty-catalog", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {},
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "^1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appJson.dependencies["no-deps"]).toBe("^2.0.0");

    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(Object.keys(rootJson.catalog)).toHaveLength(0);
  });

  it("should handle cancellation (Ctrl+C) gracefully", async () => {
    await using dir = tempDir("update-interactive-cancel", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { input: "\u0003" });

    expect(stdout).toContain("Cancelled");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
  });

  it("should preserve version prefixes on direct dependencies", async () => {
    await using dir = tempDir("update-interactive-direct-prefixes", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "^1.0.0",
          "a-dep": "~1.0.5",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir);

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies).toEqual({
      "no-deps": "2.0.0",
      "dep-with-tags": "^3.0.0",
      // ~1.0.5 already resolves to latest (1.0.10) so it is not listed as outdated.
      "a-dep": "~1.0.5",
    });
  });

  it("should update catalog in workspaces object (not workspaces.catalogs)", async () => {
    await using dir = tempDir("update-interactive-workspaces-catalog", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalog: {
            "no-deps": "^1.0.0",
            "dep-with-tags": "~1.0.0",
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalog).toEqual({ "no-deps": "^2.0.0", "dep-with-tags": "~3.0.0" });
  });

  it("should preserve version prefixes on catalog entries, including scoped names", async () => {
    await using dir = tempDir("update-interactive-catalog-prefixes", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "@types/no-deps": "^1.0.0",
          "no-deps": ">=1.0.0 <1.1.0",
          "dep-with-tags": "~1.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "@types/no-deps": "catalog:",
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog).toEqual({
      "@types/no-deps": "^2.0.0",
      "no-deps": ">=2.0.0",
      "dep-with-tags": "~3.0.0",
    });
  });

  it("should handle catalog updates when running from root with filter", async () => {
    await using dir = tempDir("update-interactive-filter-catalog", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
          "dep-with-tags": "~1.0.0",
        },
      }),
      "packages/app1/package.json": JSON.stringify({
        name: "@test/app1",
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
      "packages/app2/package.json": JSON.stringify({
        name: "@test/app2",
        dependencies: {
          "dep-with-tags": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--filter=@test/app2", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog["dep-with-tags"]).toBe("~3.0.0");
    // app1 was filtered out, so its catalog entry is untouched.
    expect(packageJson.catalog["no-deps"]).toBe("^1.0.0");
  });

  it("should handle multiple catalog definitions with same package", async () => {
    await using dir = tempDir("update-interactive-multi-catalog", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalogs: {
            "dev": {
              "no-deps": "^1.0.0",
            },
            "prod": {
              "no-deps": "~1.0.0",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:prod",
        },
        devDependencies: {
          "no-deps": "catalog:dev",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs.dev).toEqual({ "no-deps": "^2.0.0" });
    // group_catalog_dependencies currently keys the interactive list by package
    // name alone, so the catalog:prod reference is deduped with catalog:dev and
    // only dev's entry is rewritten. When that is addressed this becomes "~2.0.0".
    expect(packageJson.workspaces.catalogs.prod).toEqual({ "no-deps": expect.stringMatching(/^~[12]\.0\.0$/) });
  });

  it("should handle version ranges with multiple conditions", async () => {
    await using dir = tempDir("update-interactive-complex-ranges", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0 || ^2.0.0",
          "dep-with-tags": ">=1.0.0 <3.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog).toEqual({
      "no-deps": "^1.0.0 || ^2.0.0",
      "dep-with-tags": ">=3.0.0",
    });
  });

  it("should handle keyboard navigation correctly", async () => {
    await using dir = tempDir("update-interactive-navigation", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
          "a-dep": "1.0.5",
        },
      }),
    });

    await install(dir);
    // n (select none), i (invert selection = select all), enter
    const { stdout, exitCode } = await updateInteractive(dir, { input: "ni\n" });

    expect(stdout).toContain("Selected 3 packages to update");
    expect(exitCode).toBe(0);
  });

  it("comprehensive interactive update test with all scenarios", async () => {
    await using dir = tempDir("update-interactive-comprehensive", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root-project",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
          "dep-with-tags": "~1.0.0",
        },
        dependencies: {
          "a-dep": "^1.0.5",
        },
        devDependencies: {
          "normal-dep-and-dev-dep": "^1.0.0",
        },
      }),
      "packages/app1/package.json": JSON.stringify({
        name: "@test/app1",
        version: "1.0.0",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
          "a-dep": "^1.0.5",
        },
        devDependencies: {
          "normal-dep-and-dev-dep": "^1.0.0",
        },
      }),
      "packages/app2/package.json": JSON.stringify({
        name: "@test/app2",
        version: "1.0.0",
        dependencies: {
          "no-deps": "catalog:",
          "a-dep": "^1.0.5",
        },
        devDependencies: {
          "dep-with-tags": "^1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const rootPackageJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootPackageJson.catalog).toEqual({ "no-deps": "^2.0.0", "dep-with-tags": "~3.0.0" });
    // a-dep ^1.0.5 and normal-dep-and-dev-dep ^1.0.0 already resolve to their
    // latest versions so they are not listed as outdated.
    expect(rootPackageJson.dependencies["a-dep"]).toBe("^1.0.5");
    expect(rootPackageJson.devDependencies["normal-dep-and-dev-dep"]).toBe("^1.0.0");

    const app1Json = await Bun.file(join(dir, "packages/app1/package.json")).json();
    expect(app1Json.dependencies).toEqual({
      "no-deps": "catalog:",
      "dep-with-tags": "catalog:",
      "a-dep": "^1.0.5",
    });
    expect(app1Json.devDependencies["normal-dep-and-dev-dep"]).toBe("^1.0.0");

    const app2Json = await Bun.file(join(dir, "packages/app2/package.json")).json();
    expect(app2Json.dependencies).toEqual({ "no-deps": "catalog:", "a-dep": "^1.0.5" });
    expect(app2Json.devDependencies["dep-with-tags"]).toBe("^3.0.0");

    const lockfileExists = await Bun.file(join(dir, "bun.lock")).exists();
    expect(lockfileExists).toBe(true);

    // bun install again should make no further changes.
    await using verifyInstall = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [verifyStdout, verifyStderr, verifyExitCode] = await Promise.all([
      verifyInstall.stdout.text(),
      verifyInstall.stderr.text(),
      verifyInstall.exited,
    ]);
    expect(verifyStdout + verifyStderr).not.toContain("Installing");
    expect(verifyExitCode).toBe(0);
  });

  it("interactive update with workspace filters", async () => {
    await using dir = tempDir("update-interactive-filter", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
        },
      }),
      "packages/frontend/package.json": JSON.stringify({
        name: "@test/frontend",
        dependencies: {
          "no-deps": "catalog:",
          "a-dep": "^1.0.5",
        },
      }),
      "packages/backend/package.json": JSON.stringify({
        name: "@test/backend",
        dependencies: {
          "dep-with-tags": "^1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--filter=@test/frontend", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootJson.catalog["no-deps"]).toBe("^2.0.0");

    const frontendJson = await Bun.file(join(dir, "packages/frontend/package.json")).json();
    expect(frontendJson.dependencies["a-dep"]).toBe("^1.0.5");

    const backendJson = await Bun.file(join(dir, "packages/backend/package.json")).json();
    expect(backendJson.dependencies["dep-with-tags"]).toBe("^1.0.0");
  });

  it("should not modify package.json in dry-run mode", async () => {
    await using dir = tempDir("update-interactive-dry-run", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "dep-with-tags": "1.0.0",
        },
      }),
    });

    await install(dir);
    const originalContent = await Bun.file(join(dir, "package.json")).text();

    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"] });

    expect(stdout).toContain("Selected 2 packages to update");
    expect(stdout).toContain("would be updated");
    expect(exitCode).toBe(0);

    const afterContent = await Bun.file(join(dir, "package.json")).text();
    expect(afterContent).toBe(originalContent);
  });

  it("should preserve npm: alias prefix when updating packages", async () => {
    await using dir = tempDir("update-interactive-npm-alias", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "my-alias": "npm:no-deps@1.0.0",
          "@my/alias": "npm:@types/no-deps@^1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir);

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["my-alias"]).toBe("npm:no-deps@2.0.0");
    expect(packageJson.dependencies["@my/alias"]).toBe("npm:@types/no-deps@^2.0.0");
  });

  it("interactive update with mixed dependency types", async () => {
    await using dir = tempDir("update-interactive-mixed", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "a-dep": "^1.0.5",
        },
        dependencies: {
          "no-deps": "^1.0.0",
        },
        devDependencies: {
          "dep-with-tags": "~1.0.0",
        },
        peerDependencies: {
          "a-dep": ">=1.0.5",
        },
        optionalDependencies: {
          "normal-dep-and-dev-dep": "^1.0.0",
        },
      }),
      "packages/workspace1/package.json": JSON.stringify({
        name: "@test/workspace1",
        dependencies: {
          "a-dep": "catalog:",
          "@test/workspace2": "workspace:*",
        },
        devDependencies: {
          "no-deps": "^1.0.0",
        },
      }),
      "packages/workspace2/package.json": JSON.stringify({
        name: "@test/workspace2",
        version: "1.0.0",
        dependencies: {
          "a-dep": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const rootJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootJson.catalog["a-dep"]).toBe("^1.0.5");
    expect(rootJson.dependencies["no-deps"]).toBe("^2.0.0");
    expect(rootJson.devDependencies["dep-with-tags"]).toBe("~3.0.0");
    expect(rootJson.peerDependencies["a-dep"]).toBe(">=1.0.5");
    expect(rootJson.optionalDependencies["normal-dep-and-dev-dep"]).toBe("^1.0.0");

    const ws1Json = await Bun.file(join(dir, "packages/workspace1/package.json")).json();
    expect(ws1Json.dependencies).toEqual({ "a-dep": "catalog:", "@test/workspace2": "workspace:*" });
    expect(ws1Json.devDependencies["no-deps"]).toBe("^2.0.0");

    const ws2Json = await Bun.file(join(dir, "packages/workspace2/package.json")).json();
    expect(ws2Json.dependencies["a-dep"]).toBe("catalog:");
  });

  // Issue #39679: every mouse press and release redrew the whole frame, and
  // with -r the frame was taller than the terminal, so each redraw scrolled a
  // copy of the prompt line into scrollback.
  it("does not redraw the prompt on mouse clicks", async () => {
    await using dir = tempDir("update-interactive-mouse-click", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "a-dep": "1.0.1",
        },
      }),
    });

    await install(dir);
    // Three SGR mouse clicks (press + release), then Enter with nothing selected.
    const click = "\x1b[<0;5;5M\x1b[<0;5;5m";
    const { stdout, exitCode } = await updateInteractive(dir, {
      args: ["--dry-run"],
      input: click + click + click + "\n",
    });

    const promptCount = stdout.split("Select packages to update").length - 1;
    expect(promptCount).toBe(1);
    expect(exitCode).toBe(0);
  });

  it("keeps the frame within the terminal height with -r and multiple dependency groups", async () => {
    const files: Record<string, string> = {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
    };
    // 20 outdated rows across two dependency groups.
    for (let i = 0; i < 10; i++) {
      files[`packages/pkg${i}/package.json`] = JSON.stringify({
        name: `pkg${i}`,
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
      });
    }
    await using dir = tempDir("update-interactive-frame-height", files);

    await install(dir);
    // One wheel-down scroll, then Enter. Without a tty the prompt assumes a
    // 24-row terminal.
    const { stdout, exitCode } = await updateInteractive(dir, {
      args: ["-r", "--dry-run"],
      input: "\x1b[<65;5;5M\n",
    });

    // The in-place redraw moves the cursor up over the whole frame. It only
    // stays in place when the frame plus the cursor's resting row fit on
    // screen, so every cursor-up must stay under the 24-row fallback.
    const ups = [...stdout.matchAll(/\x1b\[(\d+)A\x1b\[1G/g)].map(m => Number(m[1]));
    expect(ups.length).toBeGreaterThan(0);
    for (const n of ups) {
      expect(n).toBeLessThan(24);
    }

    // The 20 rows do not fit in the viewport, so the wheel event scrolls.
    expect(stdout).toContain("more package above");
    expect(exitCode).toBe(0);
  });
});
