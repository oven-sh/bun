import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, tempDir } from "harness";
import assert from "node:assert";
import fs from "node:fs";
// import child from "node:child_process";
import path from "node:path";
// import fixtures from "./common/fixtures.js";

describe("path.resolve", () => {
  test("general", () => {
    const failures = [];
    const slashRE = /\//g;
    const backslashRE = /\\/g;

    const posixyCwd = isWindows
      ? (() => {
          const _ = process.cwd().replaceAll(path.sep, path.posix.sep);
          return _.slice(_.indexOf(path.posix.sep));
        })()
      : process.cwd();

    const resolveTests = [
      [
        path.win32.resolve,
        // Arguments                               result
        [
          [["c:/blah\\blah", "d:/games", "c:../a"], "c:\\blah\\a"],
          [["c:/ignore", "d:\\a/b\\c/d", "\\e.exe"], "d:\\e.exe"],
          [["c:/ignore", "c:/some/file"], "c:\\some\\file"],
          [["d:/ignore", "d:some/dir//"], "d:\\ignore\\some\\dir"],
          [["."], process.cwd()],
          [["//server/share", "..", "relative\\"], "\\\\server\\share\\relative"],
          [["c:/", "//"], "c:\\"],
          [["c:/", "//dir"], "c:\\dir"],
          [["c:/", "//server/share"], "\\\\server\\share\\"],
          [["c:/", "//server//share"], "\\\\server\\share\\"],
          [["c:/", "///some//dir"], "c:\\some\\dir"],
          [["C:\\foo\\tmp.3\\", "..\\tmp.3\\cycles\\root.js"], "C:\\foo\\tmp.3\\cycles\\root.js"],
        ],
      ],
      [
        path.posix.resolve,
        // Arguments                    result
        [
          [["/var/lib", "../", "file/"], "/var/file"],
          [["/var/lib", "/../", "file/"], "/file"],
          [["a/b/c/", "../../.."], posixyCwd],
          [["."], posixyCwd],
          [["/some/dir", ".", "/absolute/"], "/absolute"],
          [["/foo/tmp.3/", "../tmp.3/cycles/root.js"], "/foo/tmp.3/cycles/root.js"],
        ],
      ],
    ];
    resolveTests.forEach(([resolve, tests]) => {
      tests.forEach(([test, expected]) => {
        const actual = resolve.apply(null, test);
        let actualAlt;
        const os = resolve === path.win32.resolve ? "win32" : "posix";
        if (resolve === path.win32.resolve && !isWindows) actualAlt = actual.replace(backslashRE, "/");
        else if (resolve !== path.win32.resolve && isWindows) actualAlt = actual.replace(slashRE, "\\");

        const message = `path.${os}.resolve(${test.map(JSON.stringify).join(",")})\n  expect=${JSON.stringify(
          expected,
        )}\n  actual=${JSON.stringify(actual)}`;
        if (actual !== expected && actualAlt !== expected) failures.push(message);
      });
    });
    assert.strictEqual(failures.length, 0, failures.join("\n"));

    // TODO: Enable test once spawnResult.stdout works on Windows.
    // if (isWindows) {
    //   // Test resolving the current Windows drive letter from a spawned process.
    //   // See https://github.com/nodejs/node/issues/7215
    //   const currentDriveLetter = path.parse(process.cwd()).root.substring(0, 2);
    //   const relativeFixture = fixtures.path("path-resolve.js");

    //   const spawnResult = child.spawnSync(process.argv[0], [relativeFixture, currentDriveLetter]);
    //   const resolvedPath = spawnResult.stdout.toString().trim();
    //   assert.strictEqual(resolvedPath.toLowerCase(), process.cwd().toLowerCase());
    // }

    if (!isWindows) {
      // Test handling relative paths to be safe when process.cwd() fails.
      const cwd = process.cwd;
      process.cwd = () => "";
      try {
        assert.strictEqual(path.resolve(), ".");
      } finally {
        process.cwd = cwd;
      }
    }
  });

  test("UNC path before drive-relative path does not corrupt resolvedDevice", () => {
    // Parsing the UNC root reused the buffer backing the already-resolved `C:`
    // device, which corrupted it from `C:` to `\\`. The UNC arg is on a
    // different device so it should be ignored entirely.
    //
    // With the corruption, the `C:/base` arg is wrongly skipped because its
    // device no longer matches, and the i=-1 cwd fallback produces garbage (on
    // Windows it panicked reading uninitialized memory).
    expect(path.win32.resolve("C:/base", "//server/share", "C:relative")).toBe("C:\\base\\relative");
    expect(path.win32.resolve("C:/base", "//a/b", "//c/d", "C:foo")).toBe("C:\\base\\foo");
    // These depend on cwd / =C: env on the right-hand side, so just check that
    // the UNC arg is a no-op.
    expect(path.win32.resolve("//server/share", "C:relative")).toBe(path.win32.resolve("C:relative"));
    expect(path.win32.resolve("//server/share", "C:")).toBe(path.win32.resolve("C:"));
    expect(path.win32.resolve("//a/b", "//c/d", "C:foo")).toBe(path.win32.resolve("C:foo"));
  });

  test.each(["srv", "日本"])("win32 with a working directory on the share of %s", server => {
    const cwd = process.cwd;
    process.cwd = () => `\\\\${server}\\share\\dir`;
    try {
      expect([
        path.win32.resolve("a"),
        path.win32.resolve("\\a"),
        path.win32.resolve("..\\..", "本"),
        path.win32.resolve("", ""),
        path.win32.resolve("//other//place/b", "\\a"),
        path.win32.relative("a", `//${server}/share/b`),
      ]).toEqual([
        `\\\\${server}\\share\\dir\\a`,
        `\\\\${server}\\share\\a`,
        `\\\\${server}\\share\\本`,
        `\\\\${server}\\share\\dir`,
        "\\\\other\\place\\a",
        "..\\..\\b",
      ]);
    } finally {
      process.cwd = cwd;
    }
  });

  // Drive-relative paths ("C:foo") resolve against the per-drive cwd in `=C:`.
  // Spawn a child with a known `=C:` so the expected output is deterministic.
  test.skipIf(!isWindows)("win32 drive-relative input resolves against the per-drive cwd (=X: env var)", async () => {
    const script = `const p = require("path");
      console.log(JSON.stringify([
        p.resolve("C:foo"),
        p.resolve("C:"),
        p.resolve("C:", "foo"),
        p.resolve("C:foo/bar"),
        p.resolve("c:foo"),
        p.win32.resolve("C:foo"),
        p.toNamespacedPath("C:foo"),
      ]));`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, "=C:": "C:\\known\\dir" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      stdout: [
        "C:\\known\\dir\\foo",
        "C:\\known\\dir",
        "C:\\known\\dir\\foo",
        "C:\\known\\dir\\foo\\bar",
        "c:\\known\\dir\\foo",
        "C:\\known\\dir\\foo",
        "\\\\?\\C:\\known\\dir\\foo",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(isWindows)(
    "win32 drive-relative input resolves when the working directory is the filesystem root",
    async () => {
      const script = `const p = require("path");
      console.log(JSON.stringify([
        p.win32.resolve("C:foo"),
        p.win32.resolve("C:"),
      ]));`;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        cwd: "/",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe(JSON.stringify(["C:\\foo", "C:\\"]));
      expect(exitCode).toBe(0);
    },
  );

  // getenv() of other C libraries does not find such a name.
  test.skipIf(!isLinux || isMusl)("win32 drive-relative input resolves against an inherited =X: on Linux", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `require("node:path").win32.resolve("C:foo")`],
      env: { ...bunEnv, "=C:": "C:\\kn\u00f6wn" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "C:\\kn\u00f6wn\\foo\n", stderr: "", exitCode: 0 });
  });

  test("the message keeps a lone surrogate", () => {
    for (const { resolve } of [path.posix, path.win32]) {
      assert.throws(() => resolve(Symbol("\ud800")), {
        message: 'The "paths[0]" argument must be of type string. Received type symbol (Symbol(\ud800))',
      });
    }
  });

  test.skipIf(!isWindows)("win32 drive-relative input on another drive resolves against that drive's root", () => {
    const drive = process.cwd()[0].toUpperCase() === "Z" ? "Y:" : "Z:";
    expect(path.resolve(drive + "foo")).toBe(drive + "\\foo");
    expect(path.resolve(drive + "a", "b")).toBe(drive + "\\a\\b");
  });

  test.skipIf(!isWindows).each([
    ["process.chdir()", [], `process.chdir("inner");`],
    ["--cwd", ["--cwd", "inner"], ""],
  ])("%s updates the cwd of the drive", async (_, flags, change) => {
    using dir = tempDir("resolve-chdir-drive-cwd", { "inner/file": "" });
    const drive = path.parse(String(dir)).root.slice(0, 2);
    const script = `${change}
      console.log(require("node:path").resolve(${JSON.stringify(drive + "a")}).slice(2) === process.cwd().slice(2) + "\\\\a");`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "-e", script],
      env: { ...bunEnv, [`=${drive.toUpperCase()}`]: `${drive}\\Windows` },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "true", stderr: "", exitCode: 0 });
  });

  test("undefined argument are ignored if absolute path comes first (reverse loop through args)", () => {
    expect(() => {
      return path.posix.resolve(undefined, "hi");
    }).toThrow('The "paths[0]" argument must be of type string. Received undefined');
    expect(() => {
      return path.posix.resolve(undefined, "/hi");
    }).not.toThrow();
  });

  test("very long paths", () => {
    // Regression test: buffer overflow with very long paths
    // This used to panic because the buffer didn't account for the null terminator
    for (const len of [4096, 10000, 50000, 98340, 100000]) {
      // Use platform-specific absolute path prefix
      const prefix = isWindows ? "C:\\" : "/";
      const longPath = prefix + "a".repeat(len);
      const result = path.resolve(longPath);
      // Should return an absolute path with the repeated 'a' characters
      assert.ok(result.includes("a"));
      assert.ok(path.isAbsolute(result));
      // Length should be prefix length + repeated characters
      assert.strictEqual(result.length, prefix.length + len);
    }

    // Test with multiple paths that concatenate to a very long path
    const longSegment = "b".repeat(50000);
    const pathPrefix = isWindows ? "C:\\" : "/";
    const result = path.resolve(pathPrefix, longSegment, "c");
    assert.ok(result.includes("b"));
    // On Windows, paths use backslash; on POSIX, forward slash
    const expectedEnding = isWindows ? "\\c" : "/c";
    assert.ok(result.endsWith(expectedEnding));
  });

  // Around the longest path of Windows, in UTF-16 and in UTF-8.
  test.concurrent.each([32765, 32766, 98301, 100000])("a UNC server name of %d characters", async length => {
    const script = `const { resolve, relative, toNamespacedPath } = require("node:path").win32;
      const sep = "\\\\";
      for (const unit of ["a", "\\u4e2d"]) {
        const root = sep + sep + Buffer.alloc(${length * 2}, unit, "utf16le").toString("utf16le") + sep + "share" + sep;
        console.log(
          resolve(root + "a", ".." + sep + "b") === root + "b",
          relative(root + "a", root + "b") === ".." + sep + "b",
          toNamespacedPath(root + "a") === sep + sep + "?" + sep + "UNC" + root.slice(1) + "a",
        );
      }`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "true true true\ntrue true true\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a worker sees the cwd that the main thread changes to", async () => {
    using dir = tempDir("resolve-worker-cwd", {
      "inner/file": "",
      "main.cjs": `
        const { Worker, isMainThread, parentPort } = require("node:worker_threads");
        const path = require("node:path");
        if (isMainThread) {
          const worker = new Worker(__filename);
          worker.on("error", error => console.error(error));
          worker.on("exit", () => console.log("exit"));
          worker.on("message", names => {
            console.log(names.join());
            if (path.basename(process.cwd()) === "inner") return worker.terminate();
            process.chdir("inner");
            worker.postMessage("again");
          });
        } else {
          const answer = () =>
            parentPort.postMessage(
              [process.cwd(), path.resolve(), path.resolve("x", "..")].map(it => path.relative(__dirname, it)),
            );
          parentPort.on("message", answer);
          answer();
        }`,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.cjs"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ lines: stdout.trim().split(/\r?\n/), stderr }).toEqual({
      lines: [",,", "inner,inner,inner", "exit"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a backslash at the end of the cwd is part of its name", async () => {
    using dir = tempDir("resolve-backslash-cwd", { "e\\/z": "" });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const path = require("node:path");
         console.log(JSON.stringify([path.resolve("z"), path.resolve("."), path.relative("..", "z")]));`,
      ],
      env: bunEnv,
      cwd: path.join(String(dir), "e\\"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const cwd = fs.realpathSync(String(dir)) + "/e\\";
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([cwd + "/z", cwd, "e\\/z"]);
    expect(exitCode).toBe(0);
  });

  // Windows does not remove the cwd of a process.
  describe.skipIf(isWindows).concurrent("when the cwd is removed", () => {
    const print = `
      for (const ask of [
        () => path.resolve("a").split("/").slice(-2).join("/"),
        () => path.resolve("\u65e5", "..", "a").split("/").slice(-2).join("/"),
        () => path.relative("a", "b"),
        () => path.win32.relative("a", "b"),
        () => path.basename(path.resolve()),
        () => path.relative(".", "a"),
        () => path.win32.basename(path.win32.resolve(".")),
        () => path.win32.resolve("C:a").split("\\\\").slice(-2).join("/"),
      ]) {
        try {
          console.log(ask());
        } catch (error) {
          console.log(error.code, error.syscall);
        }
      }`;
    const imports = `import fs from "node:fs"; import path from "node:path";`;
    const resolvedIn = name => [`${name}/a`, `${name}/a`, "../b", "..\\b", name, "a", name, `${name}/a`];
    const resolved = resolvedIn("removed");
    const refused = resolved.map(() => "ENOENT uv_cwd");

    test.each([
      ["after the process started in it", "removed", [], `fs.rmdirSync("../removed");`, resolved],
      ["after --cwd", ".", ["--cwd", "removed"], `fs.rmdirSync("../removed");`, resolved],
      ["after process.chdir()", ".", [], `process.chdir("removed"); fs.rmdirSync("../removed");`, refused],
      [
        "after process.chdir() and process.cwd()",
        ".",
        [],
        `process.chdir("removed"); process.cwd(); fs.rmdirSync("../removed");`,
        resolved,
      ],
      [
        "and process.cwd is replaced",
        "removed",
        [],
        `fs.rmdirSync("../removed"); process.cwd = () => "/made";`,
        resolvedIn("made"),
      ],
    ])("%s", async (_, cwd, flags, remove, lines) => {
      using dir = tempDir("resolve-removed-cwd", { "removed": {}, "main.mjs": imports + remove + print });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...flags, path.join(String(dir), "main.mjs")],
        env: bunEnv,
        cwd: path.join(String(dir), cwd),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ lines: stdout.trim().split("\n"), stderr, exitCode }).toEqual({ lines, stderr: "", exitCode: 0 });
    });

    test("before the process starts", async () => {
      using dir = tempDir("resolve-removed-cwd", { "removed": {}, "main.mjs": imports + print });
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `rmdir ../removed && exec "$0" "$1"`, bunExe(), path.join(String(dir), "main.mjs")],
        env: bunEnv,
        cwd: path.join(String(dir), "removed"),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ lines: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
        lines: refused,
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
