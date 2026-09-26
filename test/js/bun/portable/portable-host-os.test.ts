/**
 * The portable image (`--portable`) is one executable that is compiled for Linux and runs on Linux, macOS and
 * Windows. What JavaScript can see of the operating system has to be that of the host, decided when the
 * program runs (src/bun_core/host.rs, src/jsc/bindings/BunHostOS.h, src/codegen/replacements.ts).
 *
 * These tests run the image on this machine with the test hook BUN_PORTABLE_HOST_OS, which makes bun take the
 * decisions of another host. The hook does not change what the kernel does: a script under `win32` here cannot
 * open a file by a path that bun made, so every script is given with `-e` and touches no file.
 *
 * BUN_PORTABLE_IMAGE is the path of a portable bun. Without it the tests are skipped.
 *
 * The expected values are those of Node.js on each OS (https://nodejs.org/api/os.html, path.html, url.html,
 * process.html), not what the image printed.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";

const image = process.env.BUN_PORTABLE_IMAGE;

type Host = "linux" | "darwin" | "win32";
const hosts: Host[] = ["linux", "darwin", "win32"];

/** Runs `source` in the image as if `host` ran it; the script prints one JSON value. */
async function run(host: Host, source: string, env: Record<string, string> = {}, cwd?: string): Promise<any> {
  await using proc = Bun.spawn({
    cmd: [image!, "-e", source],
    env: { ...bunEnv, ...env, BUN_PORTABLE_HOST_OS: host },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

describe.skipIf(!image)("portable image", () => {
  describe.each(hosts)("host %s: identity", host => {
    test.concurrent("process, os and navigator name the host", async () => {
      const actual = await run(
        host,
        `const os = require("node:os");
         console.log(JSON.stringify({
           platform: process.platform,
           osPlatform: os.platform(),
           type: os.type(),
           EOL: os.EOL,
           devNull: os.devNull,
           navigatorPlatform: navigator.platform,
           arch: process.arch,
           osArch: os.arch(),
         }));`,
      );
      expect(actual).toEqual({
        platform: host,
        osPlatform: host,
        // os.type(): "Returns 'Linux' on Linux, 'Darwin' on macOS, and 'Windows_NT' on Windows."
        type: { linux: "Linux", darwin: "Darwin", win32: "Windows_NT" }[host],
        // os.EOL: "\n on POSIX, \r\n on Windows"
        EOL: host === "win32" ? "\r\n" : "\n",
        // os.devNull: "\\.\nul on Windows, /dev/null on POSIX"
        devNull: host === "win32" ? "\\\\.\\nul" : "/dev/null",
        // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform, bun's values per OS
        navigatorPlatform: { linux: "Linux x86_64", darwin: "MacIntel", win32: "Win32" }[host],
        // The image is machine code of one architecture: the one that runs this test.
        arch: process.arch,
        osArch: process.arch,
      });
    });

    test.concurrent("the user agent does not name an OS", async () => {
      const actual = await run(host, `console.log(JSON.stringify(navigator.userAgent))`);
      expect(actual).toMatch(/^Bun\/\d+\.\d+\.\d+$/);
    });

    test.concurrent("the names of environment variables", async () => {
      const actual = await run(
        host,
        `const env = process.env;
         const out = {
           sameObject: Bun.env === process.env,
           exact: env.Portable_Test_Var,
           upper: env.PORTABLE_TEST_VAR,
           lower: env.portable_test_var,
           inUpper: "PORTABLE_TEST_VAR" in env,
           keyListed: Object.keys(env).filter(k => k.toLowerCase() === "portable_test_var"),
           bunEnvLower: Bun.env.portable_test_var,
         };
         env.portable_Written = "1";
         out.writtenOtherCase = env.PORTABLE_WRITTEN;
         out.writtenKeys = Object.keys(env).filter(k => k.toLowerCase() === "portable_written");
         env.PORTABLE_written = "2";
         out.overwrittenKeys = Object.keys(env).filter(k => k.toLowerCase() === "portable_written").sort();
         out.overwrittenValue = env.portable_Written;
         delete env.PORTABLE_WRITTEN;
         out.afterDelete = env.portable_Written;
         console.log(JSON.stringify(out));`,
        { Portable_Test_Var: "value" },
      );
      // process.env: "On Windows operating systems, environment variables are case-insensitive."
      const windows = {
        sameObject: true,
        exact: "value",
        upper: "value",
        lower: "value",
        inUpper: true,
        keyListed: ["Portable_Test_Var"],
        bunEnvLower: "value",
        writtenOtherCase: "1",
        writtenKeys: ["portable_Written"],
        overwrittenKeys: ["portable_Written"],
        overwrittenValue: "2",
      };
      const posix = {
        sameObject: true,
        exact: "value",
        inUpper: false,
        keyListed: ["Portable_Test_Var"],
        writtenKeys: ["portable_Written"],
        overwrittenKeys: ["PORTABLE_written", "portable_Written"],
        overwrittenValue: "1",
        afterDelete: "1",
      };
      expect(actual).toEqual(host === "win32" ? windows : posix);
    });
  });

  describe.each(hosts)("host %s: paths", host => {
    const windows = host === "win32";

    test.concurrent("node:path is the flavour of the host", async () => {
      const actual = await run(
        host,
        `const path = require("node:path");
         console.log(JSON.stringify({
           isWin32: path === path.win32,
           isPosix: path === path.posix,
           sep: path.sep,
           delimiter: path.delimiter,
           join: path.join("a", "b", "..", "c.txt"),
           joinDrive: path.join("C:\\\\a", "..", "b", "c.txt"),
           normalize: path.normalize("C:/a//b/../c/"),
           isAbsolute: ["C:\\\\a", "/a", "a", "\\\\\\\\server\\\\share", "C:a"].map(p => path.isAbsolute(p)),
           resolveDrive: path.resolve("C:\\\\a\\\\b", "..\\\\c"),
           resolvePosix: path.posix.resolve("/a/b", "../c"),
           resolveWin32: path.win32.resolve("C:\\\\a\\\\b", "..\\\\c"),
           relative: path.relative("C:\\\\a\\\\b", "C:\\\\a\\\\c\\\\d"),
           parse: path.parse("C:\\\\a\\\\b.txt"),
           format: path.format({ dir: "x", base: "y.txt" }),
           basename: path.basename("C:\\\\a\\\\b.txt", ".txt"),
           dirname: path.dirname("C:\\\\a\\\\b.txt"),
           extname: path.extname("C:\\\\a\\\\b.txt"),
           toNamespacedPath: path.toNamespacedPath("C:\\\\a\\\\b"),
           matchesGlob: path.matchesGlob("a\\\\b\\\\c.txt", "a/*/c.txt"),
         }));`,
      );
      // path: "The default operation of the node:path module varies based on the operating system on which a
      // Node.js application is running."; the values are those of path.win32 and path.posix.
      expect(actual).toEqual(
        windows
          ? {
              isWin32: true,
              isPosix: false,
              sep: "\\",
              delimiter: ";",
              join: "a\\c.txt",
              joinDrive: "C:\\b\\c.txt",
              normalize: "C:\\a\\c\\",
              isAbsolute: [true, true, false, true, false],
              resolveDrive: "C:\\a\\c",
              resolvePosix: "/a/c",
              resolveWin32: "C:\\a\\c",
              relative: "..\\c\\d",
              parse: { root: "C:\\", dir: "C:\\a", base: "b.txt", ext: ".txt", name: "b" },
              format: "x\\y.txt",
              basename: "b",
              dirname: "C:\\a",
              extname: ".txt",
              toNamespacedPath: "\\\\?\\C:\\a\\b",
              matchesGlob: true,
            }
          : {
              isWin32: false,
              isPosix: true,
              sep: "/",
              delimiter: ":",
              join: "a/c.txt",
              joinDrive: "b/c.txt",
              normalize: "C:/a/c/",
              isAbsolute: [false, true, false, false, false],
              resolveDrive: process.cwd() + "/C:\\a\\b/..\\c",
              resolvePosix: "/a/c",
              resolveWin32: "C:\\a\\c",
              relative: "../C:\\a\\c\\d",
              parse: { root: "", dir: "", base: "C:\\a\\b.txt", ext: ".txt", name: "C:\\a\\b" },
              format: "x/y.txt",
              basename: "C:\\a\\b",
              dirname: ".",
              extname: ".txt",
              toNamespacedPath: "C:\\a\\b",
              matchesGlob: false,
            },
      );
    });

    test.concurrent("file URLs", async () => {
      const actual = await run(
        host,
        `const url = require("node:url");
         const attempt = f => { try { return f(); } catch (e) { return { code: e.code, message: e.message }; } };
         console.log(JSON.stringify({
           drive: attempt(() => url.fileURLToPath("file:///C:/a/b%20c.txt")),
           noDrive: attempt(() => url.fileURLToPath("file:///a/b%20c.txt")),
           noDriveCode: attempt(() => url.fileURLToPath("file:///a/b%20c.txt")).code,
           unc: attempt(() => url.fileURLToPath("file://server/share/a.txt")),
           encodedSlash: attempt(() => url.fileURLToPath("file:///C:/a%2Fb")).code,
           encodedBackslash: attempt(() => url.fileURLToPath("file:///C:/a%5Cb")),
           bunDrive: attempt(() => Bun.fileURLToPath("file:///C:/a/b%20c.txt")),
           bunUnc: attempt(() => Bun.fileURLToPath("file://server/share/a.txt")),
           toUrlDrive: url.pathToFileURL("C:\\\\a\\\\b c#d.txt").href,
           toUrlUnc: url.pathToFileURL("\\\\\\\\server\\\\share\\\\a.txt").href,
           toUrlPosix: url.pathToFileURL("/a/b c.txt").href,
           bunToUrl: Bun.pathToFileURL(process.platform === "win32" ? "C:\\\\a\\\\b c#d.txt" : "/a/b c#d.txt").href,
           bunToUrlUnc: process.platform === "win32" ? Bun.pathToFileURL("\\\\\\\\server\\\\share\\\\a.txt").href : "",
         }));`,
      );
      // url.fileURLToPath and url.pathToFileURL: the examples of the documentation, per OS.
      if (windows) {
        expect(actual).toEqual({
          drive: "C:\\a\\b c.txt",
          noDrive: actual.noDrive,
          noDriveCode: "ERR_INVALID_FILE_URL_PATH",
          unc: "\\\\server\\share\\a.txt",
          encodedSlash: "ERR_INVALID_FILE_URL_PATH",
          encodedBackslash: {
            code: "ERR_INVALID_FILE_URL_PATH",
            message: "File URL path must not include encoded \\ or / characters",
          },
          bunDrive: "C:\\a\\b c.txt",
          bunUnc: "\\\\server\\share\\a.txt",
          toUrlDrive: "file:///C:/a/b%20c%23d.txt",
          toUrlUnc: "file://server/share/a.txt",
          toUrlPosix: actual.toUrlPosix,
          bunToUrl: "file:///C:/a/b%20c%23d.txt",
          bunToUrlUnc: "file://server/share/a.txt",
        });
        // A path without a drive is one of the current drive: the URL names a drive or, with the working
        // directory of this machine, none.
        expect(actual.toUrlPosix).toEndWith("/a/b%20c.txt");
      } else {
        const cwdUrl = "file://" + process.cwd();
        expect(actual).toEqual({
          drive: "/C:/a/b c.txt",
          noDrive: "/a/b c.txt",
          unc: {
            code: "ERR_INVALID_FILE_URL_HOST",
            message: `File URL host must be "localhost" or empty on ${host}`,
          },
          encodedSlash: "ERR_INVALID_FILE_URL_PATH",
          encodedBackslash: "/C:/a\\b",
          bunDrive: "/C:/a/b c.txt",
          bunUnc: {
            code: "ERR_INVALID_FILE_URL_HOST",
            message: `File URL host must be "localhost" or empty on ${host}`,
          },
          toUrlDrive: cwdUrl + "/C:%5Ca%5Cb%20c%23d.txt",
          toUrlUnc: cwdUrl + "/%5C%5Cserver%5Cshare%5Ca.txt",
          toUrlPosix: "file:///a/b%20c.txt",
          bunToUrl: "file:///a/b%20c%23d.txt",
          bunToUrlUnc: "",
        });
      }
    });

    test.concurrent("import.meta of the entry point", async () => {
      const actual = await run(
        host,
        `console.log(JSON.stringify({
           dir: import.meta.dir,
           dirname: import.meta.dirname,
           file: import.meta.file,
           path: import.meta.path,
           filename: import.meta.filename,
           url: import.meta.url,
           main: import.meta.main,
         }));`,
      );
      const cwd = process.cwd();
      if (windows) {
        // The working directory of this machine has no drive, and a file URL of Windows without a drive names
        // no absolute path: what is made of the URL is not checked here. "file URLs" above has paths with a
        // drive, which is what every module has on Windows.
        expect({ file: actual.file, url: actual.url }).toEqual({
          file: "[eval]",
          url: "file://" + cwd + "/%5Beval%5D",
        });
      } else {
        expect(actual).toEqual({
          dir: cwd,
          dirname: cwd,
          file: "[eval]",
          path: cwd + "/[eval]",
          filename: cwd + "/[eval]",
          url: "file://" + cwd + "/%5Beval%5D",
          main: true,
        });
      }
    });
  });

  describe.each(hosts)("host %s: numbers of the OS", host => {
    test.concurrent("os.constants", async () => {
      const actual = await run(
        host,
        `const { errno, signals, dlopen, priority } = require("node:os").constants;
         const pick = (from, names) => Object.fromEntries(names.map(name => [name, from[name] ?? null]));
         console.log(JSON.stringify({
           errno: pick(errno, ["ENOENT", "EAGAIN", "EADDRINUSE", "ECONNREFUSED", "ETIMEDOUT", "ENOTEMPTY", "ELOOP", "ENAMETOOLONG", "WSAEINTR", "WSAEADDRINUSE"]),
           signals: pick(signals, ["SIGHUP", "SIGINT", "SIGABRT", "SIGBUS", "SIGKILL", "SIGUSR1", "SIGUSR2", "SIGCHLD", "SIGSTOP", "SIGTERM", "SIGWINCH", "SIGBREAK", "SIGPWR"]),
           dlopen: pick(dlopen, ["RTLD_LAZY", "RTLD_NOW", "RTLD_GLOBAL", "RTLD_LOCAL", "RTLD_DEEPBIND"]),
           priority: pick(priority, ["PRIORITY_LOW", "PRIORITY_HIGHEST"]),
           sameAsBinding: JSON.stringify(process.binding("constants").os.errno) === JSON.stringify(errno),
         }));`,
      );
      // os.constants: "Not all constants will be available on every operating system". The numbers are those
      // of <errno.h>, <signal.h> and <dlfcn.h> of each OS: Linux (asm-generic), macOS (sys/errno.h,
      // sys/signal.h), Windows (the Universal CRT, Winsock, and the signals that libuv adds).
      expect(actual).toEqual(
        {
          linux: {
            errno: {
              ENOENT: 2,
              EAGAIN: 11,
              EADDRINUSE: 98,
              ECONNREFUSED: 111,
              ETIMEDOUT: 110,
              ENOTEMPTY: 39,
              ELOOP: 40,
              ENAMETOOLONG: 36,
              WSAEINTR: null,
              WSAEADDRINUSE: null,
            },
            signals: {
              SIGHUP: 1,
              SIGINT: 2,
              SIGABRT: 6,
              SIGBUS: 7,
              SIGKILL: 9,
              SIGUSR1: 10,
              SIGUSR2: 12,
              SIGCHLD: 17,
              SIGSTOP: 19,
              SIGTERM: 15,
              SIGWINCH: 28,
              SIGBREAK: null,
              SIGPWR: 30,
            },
            dlopen: { RTLD_LAZY: 1, RTLD_NOW: 2, RTLD_GLOBAL: 256, RTLD_LOCAL: 0, RTLD_DEEPBIND: null },
            priority: { PRIORITY_LOW: 19, PRIORITY_HIGHEST: -20 },
            sameAsBinding: true,
          },
          darwin: {
            errno: {
              ENOENT: 2,
              EAGAIN: 35,
              EADDRINUSE: 48,
              ECONNREFUSED: 61,
              ETIMEDOUT: 60,
              ENOTEMPTY: 66,
              ELOOP: 62,
              ENAMETOOLONG: 63,
              WSAEINTR: null,
              WSAEADDRINUSE: null,
            },
            signals: {
              SIGHUP: 1,
              SIGINT: 2,
              SIGABRT: 6,
              SIGBUS: 10,
              SIGKILL: 9,
              SIGUSR1: 30,
              SIGUSR2: 31,
              SIGCHLD: 20,
              SIGSTOP: 17,
              SIGTERM: 15,
              SIGWINCH: 28,
              SIGBREAK: null,
              SIGPWR: null,
            },
            dlopen: { RTLD_LAZY: 1, RTLD_NOW: 2, RTLD_GLOBAL: 8, RTLD_LOCAL: 4, RTLD_DEEPBIND: null },
            priority: { PRIORITY_LOW: 19, PRIORITY_HIGHEST: -20 },
            sameAsBinding: true,
          },
          win32: {
            errno: {
              ENOENT: 2,
              EAGAIN: 11,
              EADDRINUSE: 100,
              ECONNREFUSED: 107,
              ETIMEDOUT: 138,
              ENOTEMPTY: 41,
              ELOOP: 114,
              ENAMETOOLONG: 38,
              WSAEINTR: 10004,
              WSAEADDRINUSE: 10048,
            },
            signals: {
              SIGHUP: 1,
              SIGINT: 2,
              SIGABRT: 22,
              SIGBUS: null,
              SIGKILL: 9,
              SIGUSR1: null,
              SIGUSR2: null,
              SIGCHLD: null,
              SIGSTOP: null,
              SIGTERM: 15,
              SIGWINCH: 28,
              SIGBREAK: 21,
              SIGPWR: null,
            },
            dlopen: { RTLD_LAZY: null, RTLD_NOW: null, RTLD_GLOBAL: null, RTLD_LOCAL: null, RTLD_DEEPBIND: null },
            priority: { PRIORITY_LOW: 19, PRIORITY_HIGHEST: -20 },
            sameAsBinding: true,
          },
        }[host],
      );
    });

    test.concurrent("the errno of an error", async () => {
      using dir = tempDir("portable-host-errno", { "full/file.txt": "" });
      const actual = await run(
        host,
        `const fs = require("node:fs");
         const failure = f => { try { f(); return null; } catch (e) { return { code: e.code, errno: e.errno, syscall: e.syscall }; } };
         console.log(JSON.stringify({
           missing: failure(() => fs.readFileSync("missing-file")),
           notEmpty: failure(() => fs.rmdirSync("full")),
           notDirectory: failure(() => fs.readdirSync("full/file.txt".replaceAll("/", require("node:path").sep))),
         }));`,
        {},
        String(dir),
      );
      // err.errno is the number of libuv: the negative errno of the OS, and on Windows libuv's own
      // (UV_ENOENT -4058, UV_ENOTEMPTY -4051, UV_ENOTDIR -4052 in uv/errno.h).
      const numbers = {
        linux: { ENOENT: -2, ENOTEMPTY: -39, ENOTDIR: -20 },
        darwin: { ENOENT: -2, ENOTEMPTY: -66, ENOTDIR: -20 },
        win32: { ENOENT: -4058, ENOTEMPTY: -4051, ENOTDIR: -4052 },
      }[host];
      expect(actual.missing).toEqual({ code: "ENOENT", errno: numbers.ENOENT, syscall: "open" });
      expect(actual.notEmpty).toEqual({ code: "ENOTEMPTY", errno: numbers.ENOTEMPTY, syscall: "rmdir" });
      // The kernel of this machine is asked for "full\\file.txt" under win32, which it does not have.
      if (host !== "win32")
        expect(actual.notDirectory).toEqual({ code: "ENOTDIR", errno: numbers.ENOTDIR, syscall: "scandir" });
    });

    test.concurrent.skipIf(host === "win32")(
      "process.kill takes the number that the host has for a signal",
      async () => {
        const actual = await run(
          host,
          `const number = require("node:os").constants.signals.SIGUSR2;
         const received = new Promise(resolve => process.on("SIGUSR2", resolve));
         const alive = process.kill(process.pid, 0);
         process.kill(process.pid, number);
         console.log(JSON.stringify({ number, alive, received: await received }));`,
        );
        expect(actual).toEqual({ number: host === "darwin" ? 31 : 12, alive: true, received: "SIGUSR2" });
      },
    );

    test.concurrent("the home directory, the user and the directory for temporary files", async () => {
      const actual = await run(
        host,
        `const os = require("node:os");
         const user = os.userInfo();
         console.log(JSON.stringify({
           homedir: os.homedir(),
           tmpdir: os.tmpdir(),
           user: { username: user.username, homedir: user.homedir, shell: user.shell, uid: user.uid, gid: user.gid },
         }));`,
        {
          HOME: "/home/posix-user",
          USERPROFILE: "C:\\Users\\windows-user",
          USER: "posix-user",
          USERNAME: "windows-user",
          SHELL: "/bin/posix-shell",
          TMPDIR: "/var/posix-tmp/",
          TEMP: "C:\\Temp\\windows\\",
          TMP: "C:\\Tmp",
        },
      );
      // os.homedir(): "On POSIX, it uses the $HOME environment variable if defined. [...] On Windows, it uses
      // the USERPROFILE environment variable if defined." os.userInfo(): "On Windows, the uid and gid fields
      // are -1, and shell is null." os.tmpdir(): TEMP, TMP on Windows; TMPDIR, TMP, TEMP on POSIX; without a
      // trailing separator.
      expect(actual).toEqual(
        host === "win32"
          ? {
              homedir: "C:\\Users\\windows-user",
              tmpdir: "C:\\Temp\\windows",
              user: { username: "windows-user", homedir: "C:\\Users\\windows-user", shell: null, uid: -1, gid: -1 },
            }
          : {
              homedir: "/home/posix-user",
              tmpdir: "/var/posix-tmp",
              user: {
                username: "posix-user",
                homedir: "/home/posix-user",
                shell: "/bin/posix-shell",
                uid: process.getuid!(),
                gid: process.getgid!(),
              },
            },
      );
    });

    test.concurrent("Bun.which", async () => {
      // A file name of this machine may hold ":" and "\\": a name that is a path of Windows is found by the
      // kernel here when bun asks for exactly that path.
      using dir = tempDir("portable-host-which", {
        "posix-bin/tool": "#!/bin/sh\n",
        "C:\\first\\other.exe": "",
        "C:\\second\\tool.cmd": "",
        "C:\\second\\tool.com": "",
        "C:\\third\\tool.exe": "",
        "C:\\third\\script.ts": "",
      });
      const { chmodSync } = require("node:fs");
      chmodSync(String(dir) + "/posix-bin/tool", 0o755);
      const actual = await run(
        host,
        `const windowsPath = "C:\\\\first;C:\\\\second;C:\\\\third";
         console.log(JSON.stringify({
           windows: Bun.which("tool", { PATH: windowsPath, cwd: process.cwd() }),
           windowsSpelled: Bun.which("tool.com", { PATH: windowsPath, cwd: process.cwd() }),
           windowsNotExecutable: Bun.which("script.ts", { PATH: windowsPath, cwd: process.cwd() }),
           posix: Bun.which("tool", { PATH: "missing:posix-bin", cwd: process.cwd() }),
         }));`,
        {},
        String(dir),
      );
      // bun's rule on Windows (src/which/lib.rs): the directories of PATH are separated by ";", a name is
      // completed by .exe, .cmd, .bat in every directory before .com is tried, and a name with another
      // extension is not a program.
      expect(actual).toEqual(
        host === "win32"
          ? {
              windows: "C:\\second\\tool.cmd",
              windowsSpelled: "C:\\second\\tool.com",
              windowsNotExecutable: null,
              posix: null,
            }
          : { windows: null, windowsSpelled: null, windowsNotExecutable: null, posix: String(dir) + "/posix-bin/tool" },
      );
    });
  });

  test("a value of the test hook that names no host is an error", async () => {
    await using proc = Bun.spawn({
      cmd: [image!, "-e", "console.log(process.platform)"],
      env: { ...bunEnv, BUN_PORTABLE_HOST_OS: "solaris" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: 'error: BUN_PORTABLE_HOST_OS is "solaris", expected "linux", "darwin" or "win32"\n',
      exitCode: 1,
    });
  });

  test("without the test hook the host is the one that runs the image", async () => {
    await using proc = Bun.spawn({
      cmd: [image!, "-e", "console.log(process.platform)"],
      env: { ...bunEnv, BUN_PORTABLE_HOST_OS: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: process.platform + "\n", stderr: "", exitCode: 0 });
  });
});
