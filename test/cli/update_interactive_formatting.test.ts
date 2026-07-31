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
  it("should render the column header and align package names of varying lengths", async () => {
    await using dir = tempDir("update-interactive-name-lengths", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a-dep": "1.0.1",
          "no-deps": "1.0.0",
          "normal-dep-and-dev-dep": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    // Widest name is 22 chars; every row pads to the same Current column.
    expect(stdout).toContain("Current  Target  Latest");
    expect(stdout).toContain("a-dep                   1.0.1");
    expect(stdout).toContain("no-deps                 1.0.0");
    expect(stdout).toContain("normal-dep-and-dev-dep  1.0.0");
    expect(stdout).toContain("No packages selected");
    expect(exitCode).toBe(0);
  });

  it("should render version strings of varying lengths in aligned columns", async () => {
    await using dir = tempDir("update-interactive-version-lengths", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "a-dep": "1.0.1",
          "dep-with-tags": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    // Exact spacing so a regression in name_padding / current_padding /
    // target_padding fails here instead of slipping through a \s+ regex.
    expect(stdout).toContain("Current  Target  Latest");
    expect(stdout).toContain("a-dep          1.0.1    1.0.1   1.0.10");
    expect(stdout).toContain("dep-with-tags  1.0.0    1.0.0   3.0.0");
    expect(stdout).toContain("no-deps        1.0.0    1.0.0   2.0.0");
    expect(exitCode).toBe(0);
  });

  it("should render packages that exceed the default column width without wrapping", async () => {
    await using dir = tempDir("update-interactive-long-name", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "normal-dep-and-dev-dep": "1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    // The name column grows to fit; Current/Target/Latest stay on the same line.
    expect(stdout).toContain("normal-dep-and-dev-dep  1.0.0    1.0.0   1.0.2");
    expect(exitCode).toBe(0);
  });

  it("should list packages from multiple workspaces with --filter", async () => {
    await using dir = tempDir("update-interactive-workspace-col", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        dependencies: { "no-deps": "1.0.0" },
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
    expect(stdout).toContain("no-deps");
    expect(stdout).toContain("a-dep");
    expect(exitCode).toBe(0);
  });

  it("should render catalog dependencies in the interactive table", async () => {
    await using dir = tempDir("update-interactive-catalog-render", {
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
        dependencies: { "no-deps": "catalog:" },
      }),
    });

    await install(dir);
    const { stdout, stderr, exitCode } = await updateInteractive(dir, {
      args: ["--filter=*", "--latest", "--dry-run"],
      input: "\n",
    });

    expect(stderr).not.toContain("failed to resolve");
    expect(stdout).toContain("Select packages to update");
    expect(stdout).toContain("no-deps");
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

    expect(stdout).toContain("devDependencies");
    expect(stdout).toContain("peerDependencies");
    expect(stdout).toContain("optionalDependencies");
    expect(stdout).toContain("no-deps");
    expect(stdout).toContain("a-dep dev");
    expect(stdout).toContain("dep-with-tags peer");
    expect(stdout).toContain("normal-dep-and-dev-dep optional");
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
    const { stdout, stderr, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stderr + stdout).not.toContain("catalog: failed to resolve");
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
    const { stdout, stderr, exitCode } = await updateInteractive(dir, {
      args: ["-r", "--latest"],
      cwd: join(dir, "packages/app1"),
    });
    const combined = stdout + stderr;

    expect(combined).not.toContain("FileNotFound");
    expect(combined).not.toContain("Failed to update");
    expect(exitCode).toBe(0);

    const app1Json = await Bun.file(join(dir, "packages/app1/package.json")).json();
    const app2Json = await Bun.file(join(dir, "packages/app2/package.json")).json();

    expect(app1Json.dependencies["no-deps"]).toBe("2.0.0");
    expect(app2Json.dependencies["dep-with-tags"]).toBe("3.0.0");
  });

  it("should handle basic interactive update with select all", async () => {
    await using dir = tempDir("update-interactive-basic", {
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
    const { stdout, exitCode } = await updateInteractive(dir);

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("2.0.0");
  });

  it("should preserve version prefixes for all semver range types in catalogs", async () => {
    await using dir = tempDir("update-interactive-semver-prefixes", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
          "dep-with-tags": "~1.0.0",
          "a-dep": ">=1.0.5",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
          "dep-with-tags": "catalog:",
          "a-dep": "catalog:",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.catalog["no-deps"]).toMatch(/^\^/);
    expect(packageJson.catalog["dep-with-tags"]).toMatch(/^~/);
    expect(packageJson.catalog["a-dep"]).toMatch(/^>=/);
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
              "a-dep": "^1.0.5",
              "normal-dep-and-dev-dep": "^1.0.0",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:tools",
          "a-dep": "catalog:frameworks",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs.tools["no-deps"]).toMatch(/^\^/);
    expect(packageJson.workspaces.catalogs.tools["dep-with-tags"]).toMatch(/^~/);
  });

  it("should handle mixed workspace and catalog dependencies", async () => {
    await using dir = tempDir("update-interactive-mixed-deps", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "no-deps": "^1.0.0",
        },
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "@test/lib",
        version: "1.0.0",
        dependencies: {
          "a-dep": "^1.0.5",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "@test/lib": "workspace:*",
          "no-deps": "catalog:",
          "dep-with-tags": "~1.0.0",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    const libJson = await Bun.file(join(dir, "packages/lib/package.json")).json();

    expect(appJson.dependencies["@test/lib"]).toBe("workspace:*");
    expect(appJson.dependencies["dep-with-tags"]).toMatch(/^~/);
    expect(libJson.dependencies["a-dep"]).toMatch(/^\^/);
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

  it("should handle packages with pre-release versions correctly", async () => {
    await using dir = tempDir("update-interactive-prerelease", {
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
    expect(packageJson.dependencies["dep-with-tags"]).toMatch(/^\^/);
    expect(packageJson.dependencies["a-dep"]).toMatch(/^~/);
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
    expect(packageJson.workspaces.catalog["no-deps"]).toBe("^2.0.0");
    expect(packageJson.workspaces.catalog["dep-with-tags"]).toMatch(/^~/);
  });

  it("should handle scoped packages in catalogs correctly", async () => {
    await using dir = tempDir("update-interactive-scoped-catalog", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: {
          "@scoped/has-bin-entry": "^1.0.0",
          "no-deps": "~1.0.0",
          "dep-with-tags": ">=1.0.0",
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "@scoped/has-bin-entry": "catalog:",
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
    expect(packageJson.catalog["@scoped/has-bin-entry"]).toMatch(/^\^/);
    expect(packageJson.catalog["no-deps"]).toMatch(/^~/);
    expect(packageJson.catalog["dep-with-tags"]).toMatch(/^>=/);
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
    expect(packageJson.workspaces.catalogs.dev["no-deps"]).toBe("^2.0.0");
    expect(packageJson.workspaces.catalogs.prod["no-deps"]).toMatch(/^~/);
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
    expect(packageJson.catalog["no-deps"]).toBeDefined();
    expect(packageJson.catalog["dep-with-tags"]).toBeDefined();
  });

  it("should handle dry-run mode correctly", async () => {
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
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"] });

    expect(stdout).toContain("Selected");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
    expect(packageJson.dependencies["dep-with-tags"]).toBe("1.0.0");
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
    const { stdout, stderr, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });
    const combined = stdout + stderr;

    expect(combined).not.toContain("FileNotFound");
    expect(combined).not.toContain("Failed to update");
    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const rootPackageJson = await Bun.file(join(dir, "package.json")).json();
    expect(rootPackageJson.catalog["no-deps"]).toBe("^2.0.0");
    expect(rootPackageJson.catalog["dep-with-tags"]).toMatch(/^~/);
    expect(rootPackageJson.dependencies["a-dep"]).toMatch(/^\^/);
    expect(rootPackageJson.devDependencies["normal-dep-and-dev-dep"]).toMatch(/^\^/);

    const app1Json = await Bun.file(join(dir, "packages/app1/package.json")).json();
    expect(app1Json.dependencies["no-deps"]).toBe("catalog:");
    expect(app1Json.dependencies["dep-with-tags"]).toBe("catalog:");
    expect(app1Json.dependencies["a-dep"]).toMatch(/^\^/);
    expect(app1Json.devDependencies["normal-dep-and-dev-dep"]).toMatch(/^\^/);

    const app2Json = await Bun.file(join(dir, "packages/app2/package.json")).json();
    expect(app2Json.dependencies["no-deps"]).toBe("catalog:");
    expect(app2Json.dependencies["a-dep"]).toMatch(/^\^/);
    expect(app2Json.devDependencies["dep-with-tags"]).toMatch(/^\^/);

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
    expect(frontendJson.dependencies["a-dep"]).toMatch(/^\^/);

    const backendJson = await Bun.file(join(dir, "packages/backend/package.json")).json();
    expect(backendJson.dependencies["dep-with-tags"]).toBe("^1.0.0");
  });

  it("interactive update with workspaces.catalogs structure", async () => {
    await using dir = tempDir("update-interactive-workspaces-catalogs-2", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalogs: {
            "shared": {
              "no-deps": "^1.0.0",
              "dep-with-tags": "~1.0.0",
            },
            "tools": {
              "a-dep": ">=1.0.5",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:shared",
          "dep-with-tags": "catalog:shared",
          "a-dep": "catalog:tools",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs.shared["no-deps"]).not.toBe("^1.0.0");
    expect(packageJson.workspaces.catalogs.shared["dep-with-tags"]).not.toBe("~1.0.0");
    expect(packageJson.workspaces.catalogs.shared["no-deps"]).toMatch(/^\^/);
    expect(packageJson.workspaces.catalogs.shared["dep-with-tags"]).toMatch(/^~/);
    expect(packageJson.workspaces.catalogs.tools["a-dep"]).toMatch(/^>=/);

    const appJson = await Bun.file(join(dir, "packages/app/package.json")).json();
    expect(appJson.dependencies["no-deps"]).toBe("catalog:shared");
    expect(appJson.dependencies["dep-with-tags"]).toBe("catalog:shared");
    expect(appJson.dependencies["a-dep"]).toBe("catalog:tools");
  });

  it("interactive update dry run mode", async () => {
    await using dir = tempDir("update-interactive-dry-run-2", {
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

    expect(stdout).toContain("Dry run");
    expect(exitCode).toBe(0);

    const afterContent = await Bun.file(join(dir, "package.json")).text();
    expect(afterContent).toBe(originalContent);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.dependencies["no-deps"]).toBe("1.0.0");
    expect(packageJson.dependencies["dep-with-tags"]).toBe("1.0.0");
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
    expect(rootJson.catalog["a-dep"]).toMatch(/^\^/);
    expect(rootJson.dependencies["no-deps"]).toMatch(/^\^/);
    expect(rootJson.devDependencies["dep-with-tags"]).toMatch(/^~/);
    expect(rootJson.peerDependencies["a-dep"]).toMatch(/^>=/);
    expect(rootJson.optionalDependencies["normal-dep-and-dev-dep"]).toMatch(/^\^/);

    const ws1Json = await Bun.file(join(dir, "packages/workspace1/package.json")).json();
    expect(ws1Json.dependencies["a-dep"]).toBe("catalog:");
    expect(ws1Json.dependencies["@test/workspace2"]).toBe("workspace:*");
    expect(ws1Json.devDependencies["no-deps"]).toMatch(/^\^/);

    const ws2Json = await Bun.file(join(dir, "packages/workspace2/package.json")).json();
    expect(ws2Json.dependencies["a-dep"]).toBe("catalog:");
  });
});
