import { spawnSync } from "bun";
import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isMusl, isWindows, tempDir, unwritableFd } from "harness";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("bun", () => {
  describe("NO_COLOR", () => {
    for (const value of ["1", "0", "foo", " "]) {
      test(`respects NO_COLOR=${JSON.stringify(value)} to disable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env: {
            NO_COLOR: value,
          },
        });
        expect(stdout.toString()).not.toMatch(/\u001b\[\d+m/);
      });
    }
    for (const value of ["", undefined]) {
      // TODO: need a way to fake a tty in order to test this,
      // and cannot use FORCE_COLOR since that will always override NO_COLOR.
      test.todo(`respects NO_COLOR=${JSON.stringify(value)} to enable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env:
            value === undefined
              ? {}
              : {
                  NO_COLOR: value,
                },
        });
        expect(stdout.toString()).toMatch(/\u001b\[\d+m/);
      });
    }
  });

  // #39762: a piped stream must not get ANSI codes because the other stream
  // is a TTY. `bun test | pbcopy` copied raw escape codes to the clipboard
  // since stderr (a TTY) forced colors onto the piped stdout.
  //
  // openpty via bun:ffi so one stdio fd can be a real TTY while the other is
  // a pipe. glibc keeps openpty in libutil; musl and macOS keep everything in
  // libc. Same pattern as test/js/bun/terminal/terminal-spawn.test.ts.
  describe.skipIf(isWindows)("per-stream color detection", () => {
    const colorEnv = {
      ...bunEnv,
      NO_COLOR: undefined,
      FORCE_COLOR: undefined,
      TERM: "xterm-256color",
    };

    const openptyDecl = {
      openpty: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
    } as const;
    const closeDecl = {
      close: { args: [FFIType.i32], returns: FFIType.i32 },
    } as const;

    function openPty(): { slave: number; close(): void } {
      const lib =
        process.platform === "darwin"
          ? dlopen("libc.dylib", { ...openptyDecl, ...closeDecl })
          : isMusl
            ? dlopen(process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1", {
                ...openptyDecl,
                ...closeDecl,
              })
            : dlopen("libutil.so.1", openptyDecl);
      const libc = process.platform === "darwin" || isMusl ? lib : dlopen("libc.so.6", closeDecl);

      const masterBuf = new Int32Array(1);
      const slaveBuf = new Int32Array(1);
      expect((lib.symbols as any).openpty(masterBuf, slaveBuf, null, null, null)).toBe(0);
      return {
        slave: slaveBuf[0],
        close() {
          (libc.symbols as any).close(masterBuf[0]);
          (libc.symbols as any).close(slaveBuf[0]);
        },
      };
    }

    test.concurrent("piped stdout stays plain when stderr is a tty", async () => {
      const pty = openPty();
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", "console.log({ a: 1 })"],
          env: colorEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: pty.slave,
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect(stdout).not.toMatch(/\u001b\[/);
        expect(stdout).toContain("a: 1");
        expect(exitCode).toBe(0);
      } finally {
        pty.close();
      }
    });

    test.concurrent("piped stderr stays plain when stdout is a tty", async () => {
      const pty = openPty();
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", "console.error({ a: 1 })"],
          env: colorEnv,
          stdin: "ignore",
          stdout: pty.slave,
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).not.toMatch(/\u001b\[/);
        expect(stderr).toContain("a: 1");
        expect(exitCode).toBe(0);
      } finally {
        pty.close();
      }
    });

    // Guard against overcorrection: a stream that is itself a TTY keeps
    // colors.
    test.concurrent("a tty stdout still gets colors", async () => {
      let output = "";
      const decoder = new TextDecoder();
      await using terminal = new Bun.Terminal({
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
        },
      });
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "console.log({ a: 1 })"],
        env: colorEnv,
        terminal,
      });
      await proc.exited;
      // PTY data can still be in flight after waitpid. Poll with a deadline
      // (below the 5s test timeout) so a regression fails here with the
      // captured output, not by timeout.
      const deadline = Date.now() + 2_000;
      while (!/\u001b\[\d+m/.test(output) && Date.now() < deadline) {
        await Bun.sleep(10);
      }
      expect(output).toMatch(/\u001b\[\d+m/);
    });
  });

  describe("revision", () => {
    test("revision generates version numbers correctly", () => {
      var { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--version"],
        env: bunEnv,
        stderr: "inherit",
      });
      var version = stdout.toString().trim();

      var { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--revision"],
        env: bunEnv,
        stderr: "inherit",
      });
      var revision = stdout.toString().trim();

      expect(exitCode).toBe(0);
      expect(revision).toStartWith(version);
      // https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
      expect(revision).toMatch(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
      );
    });
  });
  describe("getcompletes", () => {
    test("getcompletes should not panic and should not be empty", () => {
      const { stdout, exitCode } = spawnSync({
        cmd: [bunExe(), "getcompletes"],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      expect(stdout.toString()).not.toBeEmpty();
    });

    // https://github.com/oven-sh/bun/issues/30086
    test("getcompletes keeps scripts whose names start with 'pre'/'post' when no sibling script exists", () => {
      using dir = tempDir("getcompletes-pre-post", {
        "package.json": JSON.stringify({
          name: "test",
          scripts: {
            // standalone scripts — nothing named `ttier`, `pare-release`, `gres`, `css`, `view`
            "prettier": "echo prettier",
            "prettier:fix": "echo prettier:fix",
            "prepare-release": "echo prepare-release",
            "postgres": "echo postgres",
            "postcss": "echo postcss",
            "preview": "echo preview",
            // plain scripts
            "build": "echo build",
            "dev": "echo dev",
            "lint": "echo lint",
            "lint:fix": "echo lint:fix",
            "fix": "echo fix",
            "test": "echo test",
            // real lifecycle hooks — these SHOULD be hidden (sibling exists)
            "prebuild": "echo prebuild",
            "postbuild": "echo postbuild",
            "pretest": "echo pretest",
          },
        }),
      });

      for (const filter of ["s", "i", "r", "g", "z"]) {
        const { stdout, exitCode } = spawnSync({
          cmd: [bunExe(), "getcompletes", filter],
          env: bunEnv,
          cwd: String(dir),
        });
        const lines = stdout
          .toString()
          .split("\n")
          .map(l => l.split("\t")[0]) // "z" filter emits "name\tdescription"
          .filter(Boolean);

        // standalone pre/post-prefixed scripts must be present
        expect(lines).toContain("prettier");
        expect(lines).toContain("prettier:fix");
        expect(lines).toContain("prepare-release");
        expect(lines).toContain("postgres");
        expect(lines).toContain("postcss");
        expect(lines).toContain("preview");

        // real npm lifecycle hooks (sibling `build`/`test` exists) must still be hidden
        expect(lines).not.toContain("prebuild");
        expect(lines).not.toContain("postbuild");
        expect(lines).not.toContain("pretest");

        expect(exitCode).toBe(0);
      }
    });
  });
  // On Windows `bun completions` installs bunx as a hardlink (or a .cmd shim) instead of a symlink.
  describe.skipIf(isWindows)("completions", () => {
    const bunxName = isDebug ? "bunx-debug" : "bunx";

    test("installs a bunx symlink to the executable, falling back through the install directories", async () => {
      using dir = tempDir("completions-bunx", {
        "bin": {},
        "empty-path": {},
        "install": { bin: {} },
        "home-empty": {},
        "home-bun": { ".bun": { bin: {} } },
        "home-local": { ".local": { bin: {} } },
      });
      // Run a private copy of the executable so that the first candidate location, the executable's
      // own directory, is inside the temporary directory. A hardlink avoids copying the binary; fall
      // back to a copy when the temporary directory is on another filesystem.
      const exe = join(String(dir), "bin", "bun");
      try {
        fs.linkSync(fs.realpathSync(bunExe()), exe);
      } catch {
        fs.copyFileSync(bunExe(), exe);
      }
      // The link is created against the resolved executable path.
      const exeRealpath = fs.realpathSync(exe);

      async function installBunx(env: Record<string, string | undefined>) {
        await using proc = Bun.spawn({
          cmd: [exe, "completions"],
          // No bunx on PATH, so the symlink gets installed. No SHELL, so the command stops right
          // after that step instead of writing shell completions.
          env: { ...bunEnv, PATH: join(String(dir), "empty-path"), SHELL: undefined, BUN_INSTALL: undefined, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toBe("");
        expect(stderr).toContain("Unknown or unsupported shell");
        expect(exitCode).toBe(1);
      }

      // 1. Next to the executable.
      await installBunx({ HOME: join(String(dir), "home-empty") });
      expect(fs.readlinkSync(join(String(dir), "bin", bunxName))).toBe(exeRealpath);

      // That link now exists, so every following run falls through to the next location.
      // 2. $BUN_INSTALL/bin
      await installBunx({ HOME: join(String(dir), "home-empty"), BUN_INSTALL: join(String(dir), "install") });
      expect(fs.readlinkSync(join(String(dir), "install", "bin", bunxName))).toBe(exeRealpath);

      // 3. $HOME/.bun/bin
      await installBunx({ HOME: join(String(dir), "home-bun") });
      expect(fs.readlinkSync(join(String(dir), "home-bun", ".bun", "bin", bunxName))).toBe(exeRealpath);

      // 4. $HOME/.local/bin, once $HOME/.bun/bin does not exist.
      await installBunx({ HOME: join(String(dir), "home-local") });
      expect(fs.readlinkSync(join(String(dir), "home-local", ".local", "bin", bunxName))).toBe(exeRealpath);
    });

    test("reports that PowerShell completions do not exist when $SHELL is pwsh", async () => {
      // An empty home keeps the bunx symlink fallbacks ($HOME/.bun/bin, $HOME/.local/bin) out of the
      // real home directory. The first candidate, the executable's own directory, is unaffected.
      using home = tempDir("completions-pwsh-home", {});

      async function run(env: Record<string, string>) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "completions"],
          env: { ...bunEnv, HOME: String(home), BUN_INSTALL: undefined, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toBe("");
        expect(stderr).toContain("PowerShell completions are not yet written for Bun.");
        expect(stderr).toContain("https://github.com/oven-sh/bun/issues/8939");
        return exitCode;
      }

      expect(await run({ SHELL: "/usr/local/bin/pwsh" })).toBe(1);
      expect(await run({ SHELL: "/usr/bin/powershell" })).toBe(1);

      // `bun upgrade` runs `bun completions` with IS_BUN_AUTO_UPDATE=true. That skips the "stdout is a
      // pipe" shortcut and makes a failure exit 0. Without the Pwsh arm this path went on to the
      // directory search and its `unreachable!()`.
      expect(await run({ SHELL: "/usr/local/bin/pwsh", IS_BUN_AUTO_UPDATE: "true" })).toBe(0);

      // When getcwd fails, the "stdout is a pipe" shortcut runs before the shell check. For a shell
      // without a script it must report the failure instead of writing nothing and exiting 0. The cwd
      // has to go away after the process starts, so a shell wrapper removes it and then execs bun.
      using cwdDir = tempDir("completions-pwsh-gone-cwd", {});
      const gone = String(cwdDir);
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `cd "${gone}" && rmdir "${gone}" && exec "${bunExe()}" completions`],
        env: { ...bunEnv, HOME: String(home), BUN_INSTALL: undefined, SHELL: "/usr/local/bin/pwsh" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(stderr).toContain("Could not get current working directory");
      expect(exitCode).toBe(1);
    });

    // IS_BUN_AUTO_UPDATE is what `bun upgrade` sets: the file is installed although stdout is a pipe.
    async function installCompletions(args: string[], env: Record<string, string | undefined>) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "completions", ...args],
        env: {
          ...bunEnv,
          BUN_INSTALL: undefined,
          XDG_CONFIG_HOME: undefined,
          XDG_DATA_HOME: undefined,
          fpath: undefined,
          IS_BUN_AUTO_UPDATE: "true",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      return { stderr, exitCode };
    }

    // A fresh fish setup has `fish/` and no `fish/completions/`. The search then ended at /etc/fish/completions.
    test.concurrent.each([
      ["$HOME/.config", { ".config": { fish: {} } }, [".config", "fish", "completions"], "HOME"],
      ["$XDG_CONFIG_HOME", { fish: {} }, ["fish", "completions"], "XDG_CONFIG_HOME"],
    ])("fish: makes the completions directory of the fish config in %s", async (_, files, path, variable) => {
      using dir = tempDir("completions-fish", files);
      using empty = tempDir("completions-fish-home", {});
      const completions = join(String(dir), ...path);

      const { stderr, exitCode } = await installCompletions([], {
        SHELL: "/usr/bin/fish",
        HOME: String(empty),
        [variable]: String(dir),
      });
      expect(stderr).toContain(`Installed completions to ${completions}/bun.fish`);
      expect(fs.readFileSync(join(completions, "bun.fish"), "utf8")).toContain("bun");
      expect(exitCode).toBe(0);
    });

    describe("zsh", () => {
      const zsh = (home: string) =>
        installCompletions([join(home, ".bun")], { HOME: home, ZDOTDIR: home, SHELL: "/bin/zsh" });

      test.concurrent.each([
        '[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"',
        '[ -s "${HOME}/.bun/_bun" ] && source "${HOME}/.bun/_bun"',
        '[ -s "~/.bun/_bun" ] && source "~/.bun/_bun"',
        '# bun completions\r\n[ -s "$BUN_INSTALL/_bun" ] && source "$BUN_INSTALL/_bun"\r',
      ])("leaves a .zshrc alone that already has %j", async snippet => {
        const zshrc = `export PATH="/usr/local/bin:$PATH"\n\n${snippet}\n`;
        using dir = tempDir("completions-zshrc", { ".bun/.keep": "", ".zshrc": zshrc });

        const { exitCode } = await zsh(String(dir));
        expect(fs.readFileSync(join(String(dir), ".zshrc"), "utf8")).toBe(zshrc);
        expect(exitCode).toBe(0);
      });

      test.concurrent("adds its line to a .zshrc once", async () => {
        const zshrc = 'export PATH="/usr/local/bin:$PATH"\n';
        using dir = tempDir("completions-zshrc-fresh", { ".bun/.keep": "", ".zshrc": zshrc });
        const path = join(fs.realpathSync(String(dir)), ".bun", "_bun");
        const added = `${zshrc}\n# bun completions\n[ -s "${path}" ] && source "${path}"\n`;

        expect((await zsh(String(dir))).exitCode).toBe(0);
        expect(fs.readFileSync(join(String(dir), ".zshrc"), "utf8")).toBe(added);
        expect((await zsh(String(dir))).exitCode).toBe(0);
        expect(fs.readFileSync(join(String(dir), ".zshrc"), "utf8")).toBe(added);
      });
    });
  });
  describe("--help preserves <placeholder> text", () => {
    const env = { ...bunEnv, NO_COLOR: "1" };
    const usage: [string, string][] = [
      ["install", "bun install [flags] <name>@<version>"],
      ["add", "bun add [flags] <package><@version>"],
      ["remove", "bun remove [flags] [<packages>]"],
      ["update", "bun update [flags] <name>@<version>"],
      ["link", "bun link [flags] [<packages>]"],
      ["patch", "bun patch [flags or options] <package>@<version>"],
      ["patch-commit", "bun patch-commit [flags or options] <directory>"],
      ["info", "bun info [flags] <package>[@<version>] [<property>...]"],
    ];
    test.concurrent.each(usage)("bun %s --help usage line", async (cmd, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), cmd, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = (stdout + stderr).split(/\r?\n/).find(l => l.startsWith("Usage:")) ?? "";
      expect(line).toBe(`Usage: ${expected}`);
      expect(exitCode).toBe(0);
    });

    const flags: [string, string, string][] = [
      ["audit", "--audit-level", "greater than or equal to <level> (low,"],
      ["test", "--rerun-each", "Re-run each test file <NUMBER> times"],
      ["test", "--bail", "Exit the test suite after <NUMBER> failures"],
      ["build", "--allow-unresolved", "Use '<empty>' for opaque specifiers"],
      ["add", "-F, --filter", "Add the package(s) to the matching workspaces instead of the current package"],
      ["add", "--catalog", 'depend on it as "catalog:" (use --catalog=NAME for a named catalog)'],
      ["remove", "-F, --filter", "Remove the package(s) from the matching workspaces instead of the current package"],
      ["install", "-F, --filter", "Install packages for the matching workspaces"],
      ["install", "--catalog", 'depend on it as "catalog:" (use --catalog=NAME for a named catalog)'],
      ["audit", "--ignore", "Ignore advisories by GHSA or numeric advisory ID (repeatable)"],
      ["audit", "-L, --latest", "Also apply fixes your declared ranges exclude, rewriting package.json"],
      ["update", "-p, --production", "Only update dependencies and optionalDependencies (alias: --prod)"],
      ["install", "-p, --production", "Don't install devDependencies"],
    ];
    test.concurrent.each(flags)("bun %s --help keeps placeholder in %s description", async (cmd, flag, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), cmd, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = (stdout + stderr).split(/\r?\n/).find(l => l.includes(flag)) ?? "";
      expect(line).toContain(expected);
      expect(exitCode).toBe(0);
    });

    test("bun add --help usage line is intact with FORCE_COLOR=1", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "add", "--help"],
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = stdout + stderr;
      // <blue>\<package\><r> renders to \x1b[34m<package>\x1b[0m, not \x1b[34m\x1b[0m
      expect(out).toContain("\x1b[34m<package>\x1b[0m");
      // raw tag markup must not leak through
      expect(out).not.toContain("<blue>");
      expect(exitCode).toBe(0);
    });
  });

  describe("--help lists package manager commands and examples", () => {
    const env = { ...bunEnv, NO_COLOR: "1" };
    const lines: [string, string[], RegExp[]][] = [
      [
        "bun --help",
        [],
        [
          /^ {2}dedupe +Remove duplicate versions from the lockfile$/m,
          /^ {2}prune +Remove packages that are not in the lockfile from node_modules$/m,
        ],
      ],
      [
        "bun pm --help",
        ["pm"],
        [
          /^ {2}bun pm ls +list the tree of installed dependencies$/m,
          /^ {2}bun pm licenses +list installed packages grouped by license$/m,
        ],
      ],
      [
        "bun add --help",
        ["add"],
        [
          /^ {2}Add a dependency to a specific workspace in a monorepo\n {2}bun add zod --filter api$/m,
          /^ {2}Add to the workspace catalog instead of pinning a version\n {2}bun add --catalog react\n {2}bun add --catalog=testing vitest$/m,
        ],
      ],
      // The bare form only installs the symlink; package.json is written with --save (see the --save
      // flag row), so the examples must say which form does what.
      [
        "bun link --help",
        ["link"],
        [
          /^ {2}Link a previously-registered linkable package into the current project's node_modules\.\n {2}bun link <package>$/m,
          /^ {2}Also add it to the current project's package\.json as a link: dependency\.\n {2}bun link --save <package>$/m,
        ],
      ],
      [
        "bun audit --help",
        ["audit"],
        [
          /^ {2}bun audit fix upgrades vulnerable packages to the lowest safe version that still satisfies every dependent's range\.$/m,
          /^ {2}Upgrade vulnerable packages in bun\.lock and node_modules; package\.json is only changed when an exact pin has to be bumped\.\n {2}bun audit fix$/m,
          /^ {2}Show what bun audit fix would change without changing anything\.\n {2}bun audit fix --dry-run$/m,
          /^ {2}Also apply fixes that your package\.json ranges exclude, rewriting those ranges\.\n {2}bun audit fix --latest$/m,
        ],
      ],
    ];
    test.concurrent.each(lines)("%s", async (_, args, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), ...args, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = (stdout + stderr).replaceAll("\r\n", "\n");
      for (const re of expected) expect(out).toMatch(re);
      expect(out).not.toContain("bun list ");
      expect(exitCode).toBe(0);
    });
  });

  describe("test command line arguments", () => {
    test("test --config, issue #4128", () => {
      const path = `${tmpdir()}/bunfig-${Date.now()}.toml`;
      fs.writeFileSync(path, "[debug]");

      const p = Bun.spawnSync({
        cmd: [bunExe(), "--config=" + path],
        env: {},
        stderr: "inherit",
      });
      try {
        expect(p.exitCode).toBe(0);
      } finally {
        fs.unlinkSync(path);
      }
    });
  });

  // A command that exists to print (a bundle on stdout, `bun pm hash`, `bun --version`) declares that stdout
  // holds its result. When stdout does not take it (a full disk behind `> file`), the command says so on
  // stderr and exits 1. Every other command keeps its exit code: what it prints is a log of work that is done.
  describe.concurrent("a result that does not reach stdout", () => {
    const dep = "github:example/repo#abc1234";
    const files = {
      "package.json": JSON.stringify({
        name: "failed-stdout",
        version: "1.2.3",
        dependencies: { dep },
        scripts: { a: "echo out-a && echo err-a 1>&2", b: "echo out-b && echo err-b 1>&2" },
      }),
      // A lockfile and a node_modules folder by hand: no command here installs or leaves the machine.
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "failed-stdout", dependencies: { dep } } },
        packages: { dep: [`dep@${dep}`, {}, "example-repo-abc1234"] },
      }),
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", license: "MIT" }),
      "old/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "new/package.json": JSON.stringify({ name: "x", version: "1.0.1" }),
      "entry.js": `import "./shared.js";\nconsole.log("the bundle");\n`,
      "other.js": `import "./shared.js";\nconsole.log("the other bundle");\n`,
      "shared.js": `console.log("shared");\n`,
      "entry.ts": `const n: number = 1;\nconsole.log(n);\n`,
      // More than the 4096 bytes that stdout buffers: the bundle is written at once, not at exit.
      "big.js": `console.log("${Buffer.alloc(8192, "x").toString()}");\n`,
      "pass.test.ts": `import { test } from "bun:test";\ntest("passes", () => console.log("from the test"));\n`,
    };
    const lockb = join(import.meta.dir, "..", "integration", "sharp", "bun.lockb");
    const failedToWrite = "failed to write to stdout (write)\n";

    async function run(
      args: string[],
      stdio: { stdin?: Buffer; stdout: number | Bun.BunFile; stderr?: number },
      dir: string,
      env?: Record<string, string | undefined>,
    ) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: dir,
        // `bun repl` and `bun completions` write below the home directory.
        env: { ...bunEnv, HOME: dir, USERPROFILE: dir, ...env },
        stdin: stdio.stdin ?? "ignore",
        stdout: stdio.stdout,
        stderr: stdio.stderr ?? "pipe",
      });
      const [stderr, exitCode] = await Promise.all([
        stdio.stderr === undefined ? (proc.stderr as ReadableStream).text() : "",
        proc.exited,
      ]);
      return { stderr, exitCode };
    }

    for (const args of [
      ["--version"],
      ["--revision"],
      ["build", "entry.js"],
      ["build", "--no-bundle", "entry.ts"],
      ["build", "big.js"],
      ["pm", "pkg", "get", "version"],
      ["pm", "pack", "--quiet"],
      ["pm", "hash"],
      ["pm", "hash-string"],
      ["pm", "hash-print"],
      ["pm", "bin"],
      ["pm", "cache"],
      ["pm", "ls"],
      ["pm", "licenses"],
      ["pm", "default-trusted"],
      ["pm", "why", "dep"],
      ["why", "dep"],
      ["pm", "diff", "./old", "./new"],
      [lockb],
    ]) {
      test(`bun ${args.join(" ").replace(lockb, "bun.lockb")} reports it and exits 1`, async () => {
        using dir = tempDir("failed-stdout", files);
        using stdout = unwritableFd();
        expect(await run(args, { stdout: stdout.fd }, String(dir))).toEqual({
          stderr: "EBADF: Bad file descriptor: " + failedToWrite,
          exitCode: 1,
        });
      });
    }

    test("bun pm untrusted reports it and exits 1", async () => {
      using dir = tempDir("failed-stdout", files);
      using stdout = unwritableFd();
      const { stderr, exitCode } = await run(["pm", "untrusted"], { stdout: stdout.fd }, String(dir));
      // After the header that it prints on stderr.
      expect(stderr).toEndWith("\nEBADF: Bad file descriptor: " + failedToWrite);
      expect(exitCode).toBe(1);
    });

    test.skipIf(isWindows)("bun completions reports it and exits 1", async () => {
      using dir = tempDir("failed-stdout", files);
      using stdout = unwritableFd();
      const env = { SHELL: "/bin/bash", BUN_INSTALL: undefined };
      expect(await run(["completions"], { stdout: stdout.fd }, String(dir), env)).toEqual({
        stderr: "EBADF: Bad file descriptor: " + failedToWrite,
        exitCode: 1,
      });
    });

    test.skipIf(!isLinux)("a full disk is reported as ENOSPC", async () => {
      using dir = tempDir("failed-stdout", files);
      expect(await run(["build", "entry.js"], { stdout: Bun.file("/dev/full") }, String(dir))).toEqual({
        stderr: "ENOSPC: No space left on device: " + failedToWrite,
        exitCode: 1,
      });
    });

    // The file size limit stands for a disk that fills up in the middle of the bundle.
    test.skipIf(isWindows)("a bundle that is cut in the middle of the file is reported", async () => {
      using dir = tempDir("failed-stdout-cut", {
        "big.js": `console.log("${Buffer.alloc(200 * 1024, "x").toString()}");\n`,
      });
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'ulimit -f 16 && exec "$0" build big.js > out.js', bunExe()],
        cwd: String(dir),
        env: bunEnv,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("EFBIG: File too large: " + failedToWrite);
      const written = fs.statSync(join(String(dir), "out.js")).size;
      expect(written).toBeGreaterThan(0);
      expect(written).toBeLessThan(200 * 1024);
      expect(exitCode).toBe(1);
    });

    // `bun build big.js | head -c 1`: the reader has what it wants. A pipe fails a write only for that reason.
    test("a reader that hangs up is not an error", async () => {
      using dir = tempDir("failed-stdout-hang-up", {
        "big.js": `console.log("${Buffer.alloc(8 * 1024 * 1024, "x").toString()}");\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "big.js"],
        cwd: String(dir),
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Take one chunk, then close the read end while most of the bundle is still to be written.
      const reader = proc.stdout.getReader();
      await reader.read();
      await reader.cancel();

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    // `bun pm untrusted` prints its header on stderr and its result on stdout.
    test("a failed write to stderr is not reported", async () => {
      using dir = tempDir("failed-stdout", files);
      using stderr = unwritableFd();
      const out = join(String(dir), "out.txt");
      const { exitCode } = await run(["pm", "untrusted"], { stdout: Bun.file(out), stderr: stderr.fd }, String(dir));
      expect(fs.readFileSync(out, "utf8")).toContain("Found 0 untrusted dependencies");
      expect(exitCode).toBe(0);
    });

    // Not a result: stdout of a script belongs to the script (as in Node, a console.log that fails is
    // not an exit code), and the rest is a log.
    for (const [args, stdin] of [
      [["-e", "console.log('from the script')"]],
      [["-p", "1 + 1"]],
      [["-e", "alert('from the script')"]],
      [["test", "pass.test.ts"]],
      [["repl"], Buffer.from("1 + 1\n")],
      [["--help"]],
      [["pm", "pack"]],
    ] as [string[], Buffer?][]) {
      test(`bun ${args.join(" ")} does not report it and exits 0`, async () => {
        using dir = tempDir("failed-stdout", files);
        using stdout = unwritableFd();
        const { stderr, exitCode } = await run(args, { stdin, stdout: stdout.fd }, String(dir));
        expect(stderr).not.toContain("failed to write");
        expect(exitCode).toBe(0);
      });
    }

    test("bun build --outdir writes every output file and exits 0", async () => {
      using dir = tempDir("failed-stdout", files);
      using stdout = unwritableFd();
      const args = ["build", "./entry.js", "./other.js", "--outdir=out", "--splitting"];
      expect(await run(args, { stdout: stdout.fd }, String(dir))).toEqual({ stderr: "", exitCode: 0 });
      // Two entry points and the shared chunk.
      const written = fs.readdirSync(join(String(dir), "out"));
      expect(written).toHaveLength(3);
      expect(written).toContain("entry.js");
      expect(written).toContain("other.js");
    });

    test.each(["--parallel", "--sequential"])("bun run %s runs every script and exits 0", async mode => {
      using dir = tempDir("failed-stdout", files);
      using stdout = unwritableFd();
      const env = { NO_COLOR: "1" };
      const { stderr, exitCode } = await run(["run", mode, "a", "b"], { stdout: stdout.fd }, String(dir), env);
      // Both scripts ran to their end and their status is on stderr.
      expect(stderr).toContain("err-a");
      expect(stderr).toContain("err-b");
      expect(stderr.match(/Done in/g)).toHaveLength(2);
      expect(stderr).not.toContain("failed to write");
      expect(exitCode).toBe(0);
    });
  });
});
