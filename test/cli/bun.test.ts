import { spawnSync } from "bun";
import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isCanary,
  isDebug,
  isLinux,
  isMacOS,
  isMusl,
  isWindows,
  MAX_PATH_BYTES,
  tempDir,
} from "harness";
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

    // Puts a private copy of the executable at `exe`, so that the first candidate location, the
    // executable's own directory, is inside the temporary directory.
    function bunxInstaller(dir: string, exe: string | Buffer = join(dir, "bin", "bun")) {
      if (isMacOS) {
        // Not a hardlink: macOS resolves a path through fcntl(F_GETPATH), which names a file with
        // several links by whichever name was looked up last. Other tests run bunExe() all the time,
        // so the realpath of a link to it sometimes is bunExe() itself. A clone is a file of its own
        // and costs nothing on APFS.
        fs.copyFileSync(bunExe(), exe, fs.constants.COPYFILE_FICLONE);
      } else {
        // A hardlink avoids copying the binary; fall back to a copy when the temporary directory is
        // on another filesystem.
        try {
          fs.linkSync(fs.realpathSync(bunExe()), exe);
        } catch {
          fs.copyFileSync(bunExe(), exe);
        }
      }

      return async function installBunx(env: Record<string, string | undefined>, cmd = [String(exe), "completions"]) {
        await using proc = Bun.spawn({
          cmd,
          // No bunx on PATH, so the symlink gets installed. No SHELL, so the command stops right
          // after that step instead of writing shell completions.
          env: { ...bunEnv, PATH: join(dir, "empty-path"), SHELL: undefined, BUN_INSTALL: undefined, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toBe("");
        expect(stderr).toContain("Unknown or unsupported shell");
        expect(exitCode).toBe(1);
      };
    }

    // A JavaScript string cannot hold a lone 0xE9 byte. So a shell script, written as raw bytes,
    // sets $HOME and runs `exe completions`.
    function withRawHome(dir: string, home: Buffer, exe: string | Buffer) {
      const script = join(dir, "raw-home.sh");
      fs.writeFileSync(
        script,
        Buffer.concat([
          Buffer.from("HOME='"),
          home,
          Buffer.from("'; export HOME; exec '"),
          Buffer.from(exe),
          Buffer.from("' completions\n"),
        ]),
      );
      return ["/bin/sh", script];
    }

    // Makes a directory under `base` whose path is exactly `length` bytes long.
    function nestedDir(base: string, length: number) {
      let path = base;
      while (Buffer.byteLength(path) < length) {
        const room = length - Buffer.byteLength(path) - 1;
        // 101 bytes of room take a name of 99, so that a separator and a name are left.
        path += "/" + Buffer.alloc(room === 101 ? 99 : Math.min(100, room), "d").toString();
      }
      expect(Buffer.byteLength(path)).toBe(length);
      fs.mkdirSync(path, { recursive: true });
      return path;
    }

    test("installs a bunx symlink to the executable, falling back through the install directories", async () => {
      using dir = tempDir("completions-bunx", {
        "bin": {},
        "empty-path": {},
        "install": { bin: {} },
        "home-empty": {},
        "home-bun": { ".bun": { bin: {} } },
        "home-local": { ".local": { bin: {} } },
      });
      const installBunx = bunxInstaller(String(dir));
      // The link is created against the resolved executable path.
      const exeRealpath = fs.realpathSync(join(String(dir), "bin", "bun"));

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

    test("skips a bunx symlink location that is too long for a path", async () => {
      using dir = tempDir("completions-bunx-long", {
        "bin": {},
        "empty-path": {},
        "home": { ".bun": { bin: {} } },
      });
      const installBunx = bunxInstaller(String(dir));
      const exeRealpath = fs.realpathSync(join(String(dir), "bin", "bun"));
      // The executable's own directory has a bunx already, so the search goes on to $BUN_INSTALL/bin.
      fs.symlinkSync(exeRealpath, join(String(dir), "bin", bunxName));

      await installBunx({
        BUN_INSTALL: join(String(dir), Buffer.alloc(5000, "a").toString()),
        HOME: join(String(dir), "home"),
      });
      expect(fs.readlinkSync(join(String(dir), "home", ".bun", "bin", bunxName))).toBe(exeRealpath);
    });

    // A path and its NUL fit in MAX_PATH_BYTES: 4095 bytes on Linux, 1023 on macOS.
    test("installs the bunx symlink at the longest path, and skips a longer one", async () => {
      using dir = tempDir("completions-bunx-limit", { "bin": {}, "empty-path": {} });
      const installBunx = bunxInstaller(String(dir));
      const exeRealpath = fs.realpathSync(join(String(dir), "bin", "bun"));
      fs.symlinkSync(exeRealpath, join(String(dir), "bin", bunxName));
      const link = `/.local/bin/${bunxName}`;

      const fits = nestedDir(join(String(dir), "fits"), MAX_PATH_BYTES - 1 - link.length);
      fs.mkdirSync(join(fits, ".local", "bin"), { recursive: true });
      await installBunx({ HOME: fits });
      expect(fs.readlinkSync(fits + link)).toBe(exeRealpath);

      // One byte more.
      const tooLong = nestedDir(join(String(dir), "too-long"), MAX_PATH_BYTES - link.length);
      fs.mkdirSync(join(tooLong, ".local", "bin"), { recursive: true });
      await installBunx({ HOME: tooLong });
      expect(fs.readdirSync(join(tooLong, ".local", "bin"))).toEqual([]);
    });

    // This location needs no environment variable: the path is the executable's directory.
    test.each([
      ["is made when its path fits", 0],
      ["is skipped when its path is one byte too long", 1],
    ])("the bunx symlink beside the executable %s", async (_, extra) => {
      using dir = tempDir("completions-bunx-exe-limit", { "empty-path": {}, "home": { ".local": { bin: {} } } });
      const exeDir = nestedDir(join(String(dir), "x"), MAX_PATH_BYTES - 2 - bunxName.length + extra);
      const installBunx = bunxInstaller(String(dir), join(exeDir, "bun"));
      const exeRealpath = fs.realpathSync(join(exeDir, "bun"));
      const home = join(String(dir), "home");

      await installBunx({ HOME: home });
      expect({
        besideTheExecutable: fs.readdirSync(exeDir).sort(),
        inHome: fs.readdirSync(join(home, ".local", "bin")),
      }).toEqual(
        extra
          ? { besideTheExecutable: ["bun"], inHome: [bunxName] }
          : { besideTheExecutable: ["bun", bunxName], inHome: [] },
      );
      const made = extra ? join(home, ".local", "bin", bunxName) : join(exeDir, bunxName);
      expect(fs.readlinkSync(made)).toBe(exeRealpath);
    });

    // Linux accepts any bytes in a file name. macOS refuses a name that is not UTF-8.
    test.skipIf(!isLinux)("installs the bunx symlink in directories whose names are not valid UTF-8", async () => {
      using dir = tempDir("completions-bunx-raw", { "empty-path": {} });
      const under = (base: Buffer, path: string) => Buffer.concat([base, Buffer.from(path)]);
      const home = Buffer.concat([Buffer.from(join(String(dir), "jos")), Buffer.from([0xe9])]);
      fs.mkdirSync(under(home, "/.bun/bin"), { recursive: true });
      fs.mkdirSync(under(home, "/.local/bin"), { recursive: true });
      const exe = under(home, "/.bun/bin/bun");
      const installBunx = bunxInstaller(String(dir), exe);
      const exeRealpath = fs.realpathSync(exe, "buffer");

      // 1. Next to the executable, which is in $HOME/.bun/bin.
      await installBunx({}, withRawHome(String(dir), home, exe));
      expect(fs.readlinkSync(under(home, `/.bun/bin/${bunxName}`), "buffer")).toEqual(exeRealpath);

      // 2. $HOME/.local/bin, now that $HOME/.bun/bin has one.
      await installBunx({}, withRawHome(String(dir), home, exe));
      expect(fs.readlinkSync(under(home, `/.local/bin/${bunxName}`), "buffer")).toEqual(exeRealpath);

      // 3. A $HOME with 1400 such bytes. It fits in a path. With a 3-byte U+FFFD for each it does not.
      let long = Buffer.from(String(dir));
      for (let i = 0; i < 7; i++) long = Buffer.concat([long, Buffer.from("/"), Buffer.alloc(200, 0xe9)]);
      fs.mkdirSync(under(long, "/.bun/bin"), { recursive: true });
      await installBunx({}, withRawHome(String(dir), long, exe));
      expect(fs.readlinkSync(under(long, `/.bun/bin/${bunxName}`), "buffer")).toEqual(exeRealpath);
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
    async function installCompletions(
      args: string[],
      env: Record<string, string | undefined>,
      cmd = [bunExe(), "completions", ...args],
    ) {
      await using proc = Bun.spawn({
        cmd,
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
      // What the command appends to a .zshrc when the completions file is at `path`.
      const line = (path: string) => `\n# bun completions\n[ -s "${path}" ] && source "${path}"\n`;

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

      test.concurrent.each([
        ["is edited when its path fits", 0],
        ["is skipped when its path is one byte too long, and $HOME/.zshrc is edited", 1],
      ])("$ZDOTDIR/.zshrc %s", async (_, extra) => {
        const zshrc = 'export PATH="/usr/local/bin:$PATH"\n';
        using dir = tempDir("completions-zdotdir-limit", { ".bun/.keep": "", ".zshrc": zshrc });
        const home = fs.realpathSync(String(dir));
        const zdotdir = nestedDir(join(home, "z"), MAX_PATH_BYTES - 1 - "/.zshrc".length + extra);
        if (!extra) fs.writeFileSync(join(zdotdir, ".zshrc"), zshrc);

        const { exitCode } = await installCompletions([join(home, ".bun")], {
          HOME: home,
          ZDOTDIR: zdotdir,
          SHELL: "/bin/zsh",
        });
        const edited = zshrc + line(join(home, ".bun", "_bun"));
        expect(fs.readFileSync(join(home, ".zshrc"), "utf8")).toBe(extra ? edited : zshrc);
        if (!extra) expect(fs.readFileSync(join(zdotdir, ".zshrc"), "utf8")).toBe(edited);
        expect(exitCode).toBe(0);
      });

      // "/_bun" takes 5 of the bytes of a path. No shell can open a longer path, so that file gets
      // no line.
      test.concurrent.each([
        [MAX_PATH_BYTES - 6, true],
        [MAX_PATH_BYTES - 5, false],
        [MAX_PATH_BYTES - 1, false],
      ])("the file in a completions directory of %d bytes gets a line in .zshrc: %p", async (length, fits) => {
        const zshrc = 'export PATH="/usr/local/bin:$PATH"\n';
        using dir = tempDir("completions-zsh-deep", { ".zshrc": zshrc });
        const home = fs.realpathSync(String(dir));
        const deep = nestedDir(home, length);

        const { stderr, exitCode } = await installCompletions([deep], { HOME: home, ZDOTDIR: home, SHELL: "/bin/zsh" });
        expect(fs.readdirSync(deep)).toEqual(["_bun"]);
        expect(fs.readFileSync(join(home, ".zshrc"), "utf8")).toBe(fits ? zshrc + line(`${deep}/_bun`) : zshrc);
        expect(stderr).not.toContain("To enable completions");
        expect(exitCode).toBe(0);
      });

      // The path of the file is what the hint shows, and what stops a second edit of a .zshrc that
      // has the line without the "# bun completions" comment.
      test.concurrent.each([
        ["an argument", (comp: string) => ({ args: [comp], env: {} })],
        ["an argument with a trailing slash", (comp: string) => ({ args: [`${comp}/`], env: {} })],
        ["$BUN_INSTALL with a trailing slash", (comp: string) => ({ args: [], env: { BUN_INSTALL: `${comp}/` } })],
      ])("finds the line of the hint again when the directory is %s", async (_, given) => {
        using dir = tempDir("completions-zshrc-hint", { "comp": {} });
        const home = fs.realpathSync(String(dir));
        const { args, env } = given(join(home, "comp"));
        const run = () => installCompletions(args, { HOME: home, ZDOTDIR: home, SHELL: "/bin/zsh", ...env });
        const hint = `[ -s "${home}/comp/_bun" ] && source "${home}/comp/_bun"\n`;

        expect((await run()).stderr).toContain(`To enable completions, add this to your .zshrc:\n      ${hint}`);

        fs.writeFileSync(join(home, ".zshrc"), hint);
        const { stderr, exitCode } = await run();
        expect(stderr).not.toContain("To enable completions");
        expect(fs.readFileSync(join(home, ".zshrc"), "utf8")).toBe(hint);
        expect(exitCode).toBe(0);
      });

      // /dev/zero has no end. The read fills the buffer, so the end of the file is not known and
      // there is no room for the line.
      test.concurrent("tells the user what to add when the .zshrc does not end", async () => {
        using dir = tempDir("completions-zshrc-endless", { ".bun/.keep": "" });
        fs.symlinkSync("/dev/zero", join(String(dir), ".zshrc"));

        const { stderr, exitCode } = await zsh(String(dir));
        expect(stderr).toContain("To enable completions, add this to your .zshrc:");
        expect(exitCode).toBe(0);
      });

      // A .zshrc of over 64 KB leaves the line only the room that is reserved for it. With a 3-byte
      // U+FFFD for each byte that is not UTF-8, this path does not fit in that room.
      test.concurrent.skipIf(!isLinux)("writes a path that is not valid UTF-8 to .zshrc as it is", async () => {
        using dir = tempDir("completions-zshrc-raw", {});
        const zshrc = Buffer.alloc(72 * 1024, "# filler\n");
        const home = Buffer.concat([Buffer.from(join(fs.realpathSync(String(dir)), "zsh")), Buffer.alloc(200, 0xe9)]);
        const dotZshrc = Buffer.concat([home, Buffer.from("/.zshrc")]);
        fs.mkdirSync(Buffer.concat([home, Buffer.from("/.bun")]), { recursive: true });
        fs.writeFileSync(dotZshrc, zshrc);

        const { exitCode } = await installCompletions(
          [],
          { ZDOTDIR: undefined, SHELL: "/bin/zsh" },
          withRawHome(String(dir), home, bunExe()),
        );
        const written = fs.readFileSync(dotZshrc);
        // latin1 keeps every byte, and a failure prints a diff that a person can read.
        expect(written.subarray(zshrc.length).toString("latin1")).toBe(line(`${home.toString("latin1")}/.bun/_bun`));
        expect(written.subarray(0, zshrc.length).equals(zshrc)).toBe(true);
        expect(exitCode).toBe(0);
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

  describe.concurrent("bun lint is a command in canary builds only", () => {
    test("bun --help lists it there", async () => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "--help"], env: bunEnv, stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const listed = stdout.split(/\r?\n/).flatMap(line => /^ {2}(check|lint|fmt) /.exec(line)?.[1] ?? []);
      expect(listed).toEqual(isCanary ? ["check", "lint", "fmt"] : ["check", "fmt"]);
      expect(exitCode).toBe(0);
    });

    test("elsewhere bun lint looks for a script", async () => {
      using dir = tempDir("bun-lint-canary-only", { "package.json": "{}", "a.js": "debugger;\n" });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "lint", "a.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (isCanary) expect(stdout).toContain("no-debugger");
      else expect({ stdout, stderr }).toEqual({ stdout: "", stderr: 'error: Script not found "lint"\n' });
      expect(exitCode).toBe(1);
    });

    // test/cli/lint has more of these, but a release build skips it.
    test.each([
      ["a script in package.json", { "package.json": `{ "scripts": { "lint": "echo the script" } }` }, "the script"],
      ["lint.ts", { "lint.ts": `console.log("the file");` }, "the file"],
      ["lint/index.js", { "lint/index.js": `console.log("the index");` }, "the index"],
      // On Windows, an install creates different files for it.
      ...(isWindows
        ? []
        : [
            [
              "node_modules/.bin/lint",
              { "node_modules/.bin/lint": `#!/bin/sh\necho the executable\n` },
              "the executable",
            ],
          ]),
    ] as [string, Record<string, string>, string][])("everywhere bun lint runs %s", async (_, files, printed) => {
      using dir = tempDir("bun-lint-of-the-project", { "a.js": "debugger;\n", ...files });
      if ("node_modules/.bin/lint" in files) fs.chmodSync(join(String(dir), "node_modules/.bin/lint"), 0o755);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "lint"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe(printed);
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
});
