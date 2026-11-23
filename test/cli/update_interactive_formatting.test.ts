import { dlopen, FFIType } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closeSync, createReadStream } from "fs";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

let registry: TestRegistry;
let registryUrl: string;

beforeAll(() => {
  registry = new TestRegistry().start();
  registryUrl = registry.registryUrl();
});

afterAll(() => {
  registry.stop();
});

function bunfig() {
  return `[install]\ncache = false\nregistry = "${registryUrl}"\n`;
}

async function install(dir: string, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
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

// The test registry has no package with a name that is not ASCII. This one has versions 1.0.0 and
// 2.0.0 of every name, or the versions listed for a name. It serves no tarballs, so the tests
// that use it install with --lockfile-only and update with --dry-run.
function manifestRegistry(
  versionsOf: Record<string, string[]> = {},
  tagsOf: Record<string, Record<string, string>> = {},
) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const name = decodeURIComponent(pathname.slice(1));
      const versions = versionsOf[name] ?? ["1.0.0", "2.0.0"];
      return Response.json({
        name,
        "dist-tags": { latest: versions.at(-1), ...tagsOf[name] },
        versions: Object.fromEntries(
          versions.map(version => [version, { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` } }]),
        ),
      });
    },
  });
}

// Every name has 1.0.0 in bun.lock, and 1.1.0 and 2.0.0 are published too. Declares `ranges` in `list`,
// selects every row, and returns what `list` declares and what bun.lock holds afterwards.
async function updateEveryRange(list: "dependencies" | "catalog", ranges: Record<string, string>, args: string[]) {
  const names = Object.keys(ranges);
  await using server = manifestRegistry(Object.fromEntries(names.map(name => [name, ["1.0.0", "1.1.0", "2.0.0"]])));
  const packageJson = (versions: Record<string, string>) =>
    JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      workspaces: [],
      dependencies: Object.fromEntries(names.map(name => [name, "catalog:"])),
      [list]: versions,
    });
  await using dir = tempDir("update-interactive-ranges", {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
    "package.json": packageJson(Object.fromEntries(names.map(name => [name, "1.0.0"]))),
  });
  await install(dir, ["--lockfile-only"]);
  await Bun.write(join(dir, "package.json"), packageJson(ranges));

  const { exitCode } = await updateInteractive(dir, { args: ["--lockfile-only", ...args] });
  const lockfile = await Bun.file(join(dir, "bun.lock")).text();
  return {
    declared: (await Bun.file(join(dir, "package.json")).json())[list],
    locked: Object.fromEntries(names.map(name => [name, lockfile.match(`"${name}@([^"]+)"`)?.[1]])),
    exitCode,
  };
}

// Runs `bun update -i` on a pty. Once the table is drawn it types `keys` (one byte and one new
// frame each), waits for their frames, and confirms with Enter.
async function updateInteractiveOnPty(
  dir: string,
  { cols, rows = 24, args, keys = "" }: { cols: number; rows?: number; args: string[]; keys?: string },
) {
  const decoder = new TextDecoder();
  let output = "";
  // The end of a synchronized update closes every frame, before the prompt blocks on input.
  const frames = () => output.split("\x1b[?2026l").length - 1;
  const drawn = Promise.withResolvers<void>();
  const typed = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "-i", ...args],
    cwd: String(dir),
    env: bunEnv,
    terminal: {
      cols,
      rows,
      data(_terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
        if (frames() >= 1) drawn.resolve();
        if (frames() >= 1 + keys.length) typed.resolve();
        if (output.includes("No packages selected")) done.resolve();
      },
      exit() {
        const error = new Error(`bun update -i exited early:\n${output}`);
        drawn.reject(error);
        typed.reject(error);
        done.reject(error);
      },
    },
  });

  try {
    await drawn.promise;
    proc.terminal!.write(keys);
    await typed.promise;
    proc.terminal!.write("\r");
    await done.promise;
    return { output, exitCode: await proc.exited };
  } finally {
    proc.terminal!.close();
  }
}

// The header line and the package lines of the table, without escape sequences.
function tableLines(output: string) {
  return Bun.stripANSI(output)
    .split(/\r?\n/)
    .filter(line => line.includes("Current") || line.includes("□"));
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

  it("should offer what package.json declares now, not what bun.lock recorded", async () => {
    await using dir = tempDir("update-interactive-edited-package-json", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "a-dep": "1.0.1", "dep-with-tags": "1.0.0", "no-deps": "1.0.0" },
      }),
    });
    await install(dir);
    const lockfile = await Bun.file(join(dir, "bun.lock")).text();

    // Edited after the install, no reinstall: ranges widened, `a-dep` moved to
    // devDependencies, `dep-with-tags` removed. bun.lock still has the old list.
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "no-deps": "^1.0.0" },
        devDependencies: { "a-dep": "^1.0.1" },
      }),
    );
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--dry-run"], input: "\n" });

    // Name, Current, Target, Latest: Target follows the new ranges, not the exact pins bun.lock still has.
    expect(stdout).toMatch(/no-deps\s+1\.0\.0\s+1\.1\.0\s+2\.0\.0/);
    expect(stdout).toMatch(/a-dep dev\s+1\.0\.1\s+1\.0\.10\s/);
    expect(stdout).not.toContain("dep-with-tags");
    expect(await Bun.file(join(dir, "bun.lock")).text()).toBe(lockfile);
    expect(exitCode).toBe(0);
  });

  it("should not offer a dependency for which only an older `latest` is left", async () => {
    // The last version listed is `latest`.
    const versions = ["2.0.0", "2.1.0", "1.9.0"];
    await using server = manifestRegistry(
      {
        ahead: versions,
        behind: versions,
        beta: ["2.0.0-beta.1", "2.0.0-beta.5", "1.0.0"],
        channel: ["2.0.0-canary.7", "1.0.0"],
      },
      { channel: { canary: "2.0.0-canary.7" } },
    );
    const packageJson = (dependencies: Record<string, string>) =>
      JSON.stringify({ name: "test-project", version: "1.0.0", dependencies });
    await using dir = tempDir("update-interactive-ahead-of-latest", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": packageJson({ ahead: "2.1.0", behind: "2.0.0", beta: "2.0.0-beta.5", channel: "canary" }),
    });
    await install(dir, ["--lockfile-only"]);
    const upToDate = { ahead: "^2.0.0", beta: "^2.0.0-beta.5", channel: "canary" };
    await Bun.write(join(dir, "package.json"), packageJson({ ...upToDate, behind: "^2.0.0" }));

    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--lockfile-only"] });
    const rows = tableLines(stdout)
      .filter(line => line.includes("□"))
      .map(line => line.slice(line.indexOf("□") + 1).trim());
    expect(rows.map(row => row.split(/\s+/))).toEqual([["behind", "2.0.0", "2.1.0", "1.9.0"]]);
    expect((await Bun.file(join(dir, "package.json")).json()).dependencies).toEqual({ ...upToDate, behind: "^2.1.0" });
    expect(exitCode).toBe(0);
  });

  it.each([
    ["--latest", ["--latest"], "a\n"],
    ["the l key", [], "al\n"],
  ])("should not downgrade a dependency to an older `latest` with %s", async (_, args, input) => {
    // The last version listed is `latest`.
    await using server = manifestRegistry({
      lts: ["2.0.0", "2.1.0", "1.9.0"],
      plain: ["1.0.0", "1.1.0", "2.0.0"],
    });
    const packageJson = (dependencies: Record<string, string>) =>
      JSON.stringify({ name: "test-project", version: "1.0.0", dependencies });
    await using dir = tempDir("update-interactive-latest-is-older", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": packageJson({ lts: "2.0.0", plain: "1.0.0" }),
    });
    await install(dir, ["--lockfile-only"]);
    await Bun.write(join(dir, "package.json"), packageJson({ lts: "^2.0.0", plain: "^1.0.0" }));

    const { stdout, exitCode } = await updateInteractive(dir, { args: [...args, "--dry-run"], input });
    expect(
      Bun.stripANSI(stdout)
        .split(/\r?\n/)
        .filter(line => line.startsWith("^ ")),
    ).toEqual(["^ lts 2.0.0 -> 2.1.0", "^ plain 1.0.0 -> 2.0.0"]);
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

  // With colors on, each version is printed as a diff against the current
  // version. The latest build-metadata-1 is 1.1.0-rc.1+build.20240101, whose
  // build tag is longer than the 8 bytes a semver string stores inline, so it
  // has to be read from the latest version's own string, not the current one's.
  // Needs a real terminal: colors, and a width at which a 25 character version
  // is not truncated (truncated versions are printed without the diff). Skipped
  // on Windows because ConPTY rewrites the escape sequences this asserts on.
  it.skipIf(isWindows)("should keep the build tag of the latest version when rendering with colors", async () => {
    await using dir = tempDir("update-interactive-build-tag", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "build-metadata-1": "1.0.0" },
      }),
    });

    await install(dir);

    const decoder = new TextDecoder();
    let output = "";
    const tableRendered = Promise.withResolvers<void>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "-i", "--latest", "--dry-run"],
      cwd: String(dir),
      env: { ...bunEnv, FORCE_COLOR: "1" },
      terminal: {
        cols: 200,
        rows: 50,
        data(_terminal, chunk) {
          output += decoder.decode(chunk, { stream: true });
          // Every frame ends with a clear-to-end-of-screen before the prompt
          // blocks on input, so once that follows the row the row is complete.
          const row = output.indexOf("build-metadata-1");
          if (row !== -1 && output.includes("\x1b[0J", row)) tableRendered.resolve();
        },
        exit() {
          tableRendered.reject(new Error(`exited before rendering the table:\n${output}`));
        },
      },
    });

    let exitCode: number;
    try {
      await tableRendered.promise;
      proc.terminal!.write("\r");
      exitCode = await proc.exited;
    } finally {
      proc.terminal!.close();
    }

    const row = output.split(/\r?\n/).find(line => line.includes("build-metadata-1"))!;
    expect(Bun.stripANSI(row)).toMatch(/build-metadata-1 +1\.0\.0 +1\.0\.0 +1\.1\.0-rc\.1\+build\.20240101/);
    // "1." dim, "1.0" yellow (minor bump), then the whole tag red because
    // 1.0.0 has no prerelease.
    expect(row).toContain("\x1b[2m1.\x1b[0m\x1b[1m\x1b[33m1.0\x1b[0m\x1b[1m\x1b[31m-rc.1+build.20240101\x1b[0m");
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

  // The table measures text in terminal columns. A CJK character or an emoji takes two columns
  // and three or four bytes. "é" takes one column and two bytes.
  it("should align the columns after a package name that is not ASCII", async () => {
    await using server = manifestRegistry();
    await using dir = tempDir("update-interactive-wide-name", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "dep": "1.0.0", "café": "1.0.0", "日本語パッケージ": "1.0.0", "😀-emoji": "1.0.0" },
      }),
    });

    await install(dir, ["--lockfile-only"]);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    expect(tableLines(stdout)).toEqual([
      "  dependencies          Current  Target  Latest",
      "  ❯ □ café              1.0.0    1.0.0   2.0.0",
      "    □ dep               1.0.0    1.0.0   2.0.0",
      "    □ 日本語パッケージ  1.0.0    1.0.0   2.0.0",
      "    □ 😀-emoji          1.0.0    1.0.0   2.0.0",
    ]);
    expect(exitCode).toBe(0);
  });

  // Piped stdout counts as 80 columns, which limits a name to 35 columns: 17 on each side of the
  // ellipsis. Eight wide characters fit in 17 columns, and the padding takes the two columns that
  // are left. A combining accent takes no column and stays with its letter.
  it("should truncate a package name on a character boundary", async () => {
    // "e" and a combining acute accent: 3 bytes and 1 column each time.
    const accentedLetters = (count: number) => Buffer.alloc(count * 3, "e\u0301").toString();
    await using server = manifestRegistry();
    await using dir = tempDir("update-interactive-wide-name-truncated", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "a-long-ascii-package-name-that-needs-an-ellipsis": "1.0.0",
          [accentedLetters(40)]: "1.0.0",
          "日本語パッケージ名前テスト長い名前のパッケージです": "1.0.0",
        },
      }),
    });

    await install(dir, ["--lockfile-only"]);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    expect(tableLines(stdout)).toEqual([
      "  dependencies                             Current  Target  Latest",
      "  ❯ □ a-long-ascii-pack…needs-an-ellipsis  1.0.0    1.0.0   2.0.0",
      `    □ ${accentedLetters(17)}…${accentedLetters(17)}  1.0.0    1.0.0   2.0.0`,
      "    □ 日本語パッケージ…のパッケージです    1.0.0    1.0.0   2.0.0",
    ]);
    expect(exitCode).toBe(0);
  });

  // Piped stdout limits a version to 15 columns. These two versions are one and two columns over.
  it("should truncate a version that is one column wider than its cell", async () => {
    await using server = manifestRegistry({ "long-version": ["1.0.0-canary.123", "2.0.0-canary.4567"] });
    await using dir = tempDir("update-interactive-version-truncated", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "dep": "1.0.0", "long-version": "1.0.0-canary.123" },
      }),
    });

    await install(dir, ["--lockfile-only"]);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["--latest", "--dry-run"], input: "\n" });

    expect(tableLines(stdout)).toEqual([
      "  dependencies      Current          Target           Latest",
      "  ❯ □ dep           1.0.0            1.0.0            2.0.0",
      "    □ long-version  1.0.0-c…ary.123  1.0.0-c…ary.123  2.0.0-c…ry.4567",
    ]);
    expect(exitCode).toBe(0);
  });

  // The Workspace column shows on a terminal wider than 100 columns. Below 120 columns it limits
  // a workspace name to 15 columns. The first wide name takes 14 columns and 21 bytes, so it fits.
  // Not on Windows: ConPTY redraws the screen with its own escape sequences, so the bytes that
  // the pty delivers are not the bytes that bun wrote.
  it.skipIf(isWindows)("should size and truncate the Workspace column in terminal columns", async () => {
    await using server = manifestRegistry();
    await using dir = tempDir("update-interactive-wide-workspace", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: { "dep-cat": "1.0.0" },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "plain",
        version: "1.0.0",
        dependencies: { "dep-a": "1.0.0" },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "工作区-文档-😀",
        version: "1.0.0",
        dependencies: { "dep-b": "1.0.0", "dep-cat": "catalog:" },
      }),
      "packages/c/package.json": JSON.stringify({
        name: "工作区-文档-文档-文档",
        version: "1.0.0",
        dependencies: { "dep-c": "1.0.0", "dep-cat": "catalog:" },
      }),
    });

    await install(dir, ["--lockfile-only"]);
    const { output, exitCode } = await updateInteractiveOnPty(dir, {
      cols: 110,
      args: ["-r", "--latest", "--dry-run"],
    });

    expect(tableLines(output)).toEqual([
      "  dependencies Current  Target  Latest  Workspace",
      "  ❯ □ dep-a    1.0.0    1.0.0   2.0.0   plain",
      "    □ dep-b    1.0.0    1.0.0   2.0.0   工作区-文档-😀",
      "    □ dep-c    1.0.0    1.0.0   2.0.0   工作区-文档-文…",
      "    □ dep-cat  1.0.0    1.0.0   2.0.0   catalog (工作…",
    ]);
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("should escape control characters in a cell and size it by the escaped text", async () => {
    await using server = manifestRegistry();
    await using dir = tempDir("update-interactive-escape", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalogs: { "\x1b[2Kx": { "dep-cat": "1.0.0" } },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        version: "1.0.0",
        dependencies: { "dep-a": "1.0.0", "dep-cat": "catalog:\x1b[2Kx" },
      }),
    });

    await install(dir, ["--lockfile-only"]);
    const { output, exitCode } = await updateInteractiveOnPty(dir, {
      cols: 200,
      args: ["-r", "--latest", "--dry-run"],
    });

    expect(tableLines(output)).toEqual([
      "  dependencies Current  Target  Latest  Workspace",
      "  ❯ □ dep-a    1.0.0    1.0.0   2.0.0   a",
      "    □ dep-cat  1.0.0    1.0.0   2.0.0   catalog:\\x1b[2Kx (a)",
    ]);
    expect(exitCode).toBe(0);
  });

  // 9 rows leave 4 for packages: help line, blank + header, bottom indicator, the cursor's own row.
  it.skipIf(isWindows)("should scroll two catalog rows of a wide name on a short terminal", async () => {
    await using server = manifestRegistry();
    await using dir = tempDir("update-interactive-short-terminal", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url}"\n`,
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        catalog: { "日本語パッケージ": "1.0.0" },
        catalogs: { "固定": { "日本語パッケージ": "1.0.0" } },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        version: "1.0.0",
        dependencies: { "dep-a": "1.0.0", "dep-b": "1.0.0", "dep-c": "1.0.0", "日本語パッケージ": "catalog:" },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
        version: "1.0.0",
        dependencies: { "日本語パッケージ": "catalog:固定" },
      }),
    });

    await install(dir, ["--lockfile-only"]);
    const { output, exitCode } = await updateInteractiveOnPty(dir, {
      cols: 110,
      rows: 9,
      args: ["-r", "--latest", "--dry-run"],
      keys: "jjjj",
    });

    const frames = Bun.stripANSI(output).split("? Select packages to update").slice(1);
    expect(frames[0]).toContain("↓ 1 more package below");
    expect(frames.at(-1)).toContain("↑ 1 more package above");
    expect(tableLines(frames.at(-1)!)).toEqual([
      "  dependencies          Current  Target  Latest  Workspace",
      "    □ dep-b             1.0.0    1.0.0   2.0.0   a",
      "    □ dep-c             1.0.0    1.0.0   2.0.0   a",
      "    □ 日本語パッケージ  1.0.0    1.0.0   2.0.0   catalog (a)",
      "  ❯ □ 日本語パッケージ  1.0.0    1.0.0   2.0.0   catalog:固定 (…",
    ]);
    const ups = [...output.matchAll(/\x1b\[(\d+)A\x1b\[1G/g)].map(m => Number(m[1]));
    expect(ups.length).toBeGreaterThan(0);
    expect(Math.max(...ups)).toBeLessThan(9);
    expect(exitCode).toBe(0);
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
      "no-deps": "^2.0.0",
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

    // Each catalog gets its own selectable row.
    expect(stdout).toContain("Selected 2 packages to update");
    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalogs).toEqual({
      dev: { "no-deps": "^2.0.0" },
      prod: { "no-deps": "~2.0.0" },
    });

    const appJson = await Bun.file(join(dir, "packages", "app", "package.json")).json();
    expect(appJson.dependencies).toEqual({ "no-deps": "catalog:prod" });
    expect(appJson.devDependencies).toEqual({ "no-deps": "catalog:dev" });
  });

  it("should update default and named catalogs independently for the same package", async () => {
    await using dir = tempDir("update-interactive-default-and-named-catalog", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalog: {
            "no-deps": "^1.0.0",
          },
          catalogs: {
            pinned: {
              "no-deps": "~1.0.0",
            },
          },
        },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@test/app",
        dependencies: {
          "no-deps": "catalog:",
        },
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "@test/lib",
        dependencies: {
          "no-deps": "catalog:pinned",
        },
      }),
      "packages/other/package.json": JSON.stringify({
        name: "@test/other",
        dependencies: {
          "no-deps": "catalog:pinned",
        },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    // Two rows: the default catalog first, then the named one (lib and other share `catalog:pinned`).
    expect(stdout).toContain("Selected 2 packages to update");
    expect(stdout).toContain("Installing updates...");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
    expect(packageJson.workspaces.catalogs).toEqual({ pinned: { "no-deps": "~2.0.0" } });

    const appJson = await Bun.file(join(dir, "packages", "app", "package.json")).json();
    const libJson = await Bun.file(join(dir, "packages", "lib", "package.json")).json();
    const otherJson = await Bun.file(join(dir, "packages", "other", "package.json")).json();
    expect(appJson.dependencies).toEqual({ "no-deps": "catalog:" });
    expect(libJson.dependencies).toEqual({ "no-deps": "catalog:pinned" });
    expect(otherJson.dependencies).toEqual({ "no-deps": "catalog:pinned" });
  });

  it("should not change the catalog whose row wasn't selected", async () => {
    await using dir = tempDir("update-interactive-one-of-two-catalogs", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalog: { "no-deps": "^1.0.0" },
          catalogs: { pinned: { "no-deps": "~1.0.0" } },
        },
      }),
      "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "catalog:" } }),
      "packages/lib/package.json": JSON.stringify({ name: "lib", dependencies: { "no-deps": "catalog:pinned" } }),
    });

    await install(dir);
    // Down to the second row (`catalog:pinned`), select it, confirm.
    const { stdout, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"], input: "j \n" });

    expect(stdout).toContain("Selected 1 package to update");
    expect(exitCode).toBe(0);

    const packageJson = await Bun.file(join(dir, "package.json")).json();
    expect(packageJson.workspaces.catalog).toEqual({ "no-deps": "^1.0.0" });
    expect(packageJson.workspaces.catalogs).toEqual({ pinned: { "no-deps": "~2.0.0" } });
  });

  // `catalog:` and `catalog:default` name one catalog, which is written as `catalog` or as `catalogs.default`.
  it.each([
    ["catalog:default", (entries: object) => ({ catalog: entries })],
    ["catalog:", (entries: object) => ({ catalogs: { default: entries } })],
  ])("should update the default catalog where it is defined when members write %s", async (spec, catalogs) => {
    await using dir = tempDir("update-interactive-default-catalog-spelling", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: { packages: ["packages/*"], ...catalogs({ "no-deps": "^1.0.0" }) },
      }),
      "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": spec } }),
      "packages/lib/package.json": JSON.stringify({ name: "lib", dependencies: { "no-deps": spec } }),
    });

    await install(dir);
    const { stderr, exitCode } = await updateInteractive(dir, { args: ["-r", "--latest"] });

    expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
      name: "root",
      version: "1.0.0",
      workspaces: { packages: ["packages/*"], ...catalogs({ "no-deps": "^2.0.0" }) },
    });
    expect(await Bun.file(join(dir, "bun.lock")).text()).toContain('"no-deps@2.0.0"');
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
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
      "dep-with-tags": "^3.0.0",
    });
  });

  it.each(["dependencies", "catalog"] as const)(
    "should leave a range in %s that allows the chosen version",
    async list => {
      const ranges = {
        "above": ">0.9.0",
        "below": "<2",
        "between": ">=1.0.0 <2",
        "x-range": "1.x",
        "star": "*",
        "either": "^1.0.0 || ^2.0.0",
        "hyphen": "1.0.0 - 1.9.9",
        "tag": "latest",
      };
      expect(await updateEveryRange(list, { ...ranges, "caret": "^1.0.0" }, [])).toEqual({
        declared: { ...ranges, "caret": "^1.1.0" },
        locked: {
          "above": "2.0.0",
          "below": "1.1.0",
          "between": "1.1.0",
          "x-range": "1.1.0",
          "star": "2.0.0",
          "either": "2.0.0",
          "hyphen": "1.1.0",
          "tag": "2.0.0",
          "caret": "1.1.0",
        },
        exitCode: 0,
      });
    },
  );

  it.each(["dependencies", "catalog"] as const)(
    "should replace a range in %s that shuts out the chosen version",
    async list => {
      const ranges = {
        "below": "<2",
        "between": ">=1.0.0 <2",
        "x-range": "1.x",
        "hyphen": "1.0.0 - 1.9.9",
        "tilde": "~1.0.0",
        "exact": "1.0.0",
        "above": ">0.9.0",
        "either": "^1.0.0 || ^2.0.0",
      };
      expect(await updateEveryRange(list, ranges, ["--latest"])).toEqual({
        // This is what `bun update --latest` writes.
        declared: {
          "below": "^2.0.0",
          "between": "^2.0.0",
          "x-range": "^2.0.0",
          "hyphen": "^2.0.0",
          "tilde": "~2.0.0",
          "exact": "2.0.0",
          "above": ">0.9.0",
          "either": "^1.0.0 || ^2.0.0",
        },
        locked: Object.fromEntries(Object.keys(ranges).map(name => [name, "2.0.0"])),
        exitCode: 0,
      });
    },
  );

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

  // Every mouse press and release redrew the whole frame, and with -r the frame was taller than
  // the terminal, so each redraw scrolled a copy of the prompt line into scrollback.
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

  it("redraws after the key that follows a mouse click", async () => {
    await using dir = tempDir("update-interactive-click-then-key", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    await install(dir);
    const { stdout, exitCode } = await updateInteractive(dir, {
      args: ["--latest", "--dry-run"],
      input: "\x1b[<0;5;5M\x1b[<0;5;5m \n",
    });

    expect(stdout.split("Select packages to update").length - 1).toBe(2);
    expect(stdout).toContain("■ no-deps");
    expect(stdout).toContain("Selected 1 package to update");
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
    // One wheel-down scroll, then Enter. Without a tty the prompt assumes a 24-row terminal.
    const { stdout, exitCode } = await updateInteractive(dir, {
      args: ["-r", "--dry-run"],
      input: "\x1b[<65;5;5M\n",
    });

    // The in-place redraw moves the cursor up over the whole frame. It only stays in place when
    // the frame plus the cursor's resting row fit on screen.
    const ups = [...stdout.matchAll(/\x1b\[(\d+)A\x1b\[1G/g)].map(m => Number(m[1]));
    expect(ups.length).toBeGreaterThan(0);
    expect(Math.max(...ups)).toBeLessThan(24);

    // The 20 rows do not fit in the viewport, so the wheel event scrolls.
    expect(stdout).toContain("more package above");
    expect(exitCode).toBe(0);
  });
});
