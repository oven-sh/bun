import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

    // TODO: Enable once support for customizing process.cwd lands.
    // if (!isWindows) {
    //   // Test handling relative paths to be safe when process.cwd() fails.
    //   const cwd = process.cwd;
    //   process.cwd = () => "";
    //   try {
    //     assert.strictEqual(process.cwd(), "");
    //     const resolved = path.resolve();
    //     const expected = ".";
    //     assert.strictEqual(resolved, expected);
    //   } finally {
    //     process.cwd = cwd;
    //   }
    // }
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

  test.skipIf(!isWindows)("win32 drive-relative input on another drive resolves against that drive's root", () => {
    const drive = process.cwd()[0].toUpperCase() === "Z" ? "Y:" : "Z:";
    expect(path.resolve(drive + "foo")).toBe(drive + "\\foo");
    expect(path.resolve(drive + "a", "b")).toBe(drive + "\\a\\b");
  });

  test("undefined argument are ignored if absolute path comes first (reverse loop through args)", () => {
    expect(() => {
      return path.posix.resolve(undefined, "hi");
    }).toThrow('The "paths[0]" property must be of type string, got undefined');
    expect(() => {
      return path.posix.resolve(undefined, "/hi");
    }).not.toThrow();
  });

  // Node walks the arguments from the last one. It stops when the path is
  // absolute and has a device (a drive or a UNC share). It does not read the
  // arguments before that point, so it does not validate them.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/path.js#L190-L344
  // Every expected value is the output of Node v26.3.0.
  describe("win32.resolve validates only the arguments that Node reads", () => {
    const notStrings = [undefined, null, 123, {}, []];
    const named = index =>
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining(`"paths[${index}]"`),
      });

    test.each([
      // A drive and a root.
      [["C:\\abs\\lib"], "C:\\abs\\lib"],
      [["c:/abs", "rel"], "c:\\abs\\rel"],
      [["", "C:\\abs", ""], "C:\\abs"],
      [["D:rel", "C:\\abs"], "C:\\abs"],
      // A UNC share.
      [["\\\\server\\share\\dir"], "\\\\server\\share\\dir"],
      [["//server/share", "rel"], "\\\\server\\share\\rel"],
      [["//server//share"], "\\\\server\\share\\"],
      [["\\\\server\\\\share//dir"], "\\\\server\\share\\dir"],
      // A drive from a drive-relative path, then a root on that drive.
      [["C:\\abs", "C:rel"], "C:\\abs\\rel"],
      [["c:\\abs", "C:rel"], "C:\\abs\\rel"],
      [["C:\\abs", "c:rel"], "c:\\abs\\rel"],
      // A path on another device is not applicable. It does not end the walk.
      [["C:\\abs", "D:\\other", "C:rel"], "C:\\abs\\rel"],
      [["C:\\abs", "//server/share", "C:rel"], "C:\\abs\\rel"],
      [["C:\\abs", "D:rel", "C:rel"], "C:\\abs\\rel"],
      // A root without a device, then a device.
      [["C:\\abs", "\\rooted"], "C:\\rooted"],
      [["C:rel", "\\rooted"], "C:\\rooted"],
      [["//server/share", "/rooted"], "\\\\server\\share\\rooted"],
      [["C:\\abs", "//dir"], "C:\\dir"],
      [["C:\\abs", "C:rel", "\\rooted"], "C:\\rooted"],
      [["C:rel", "\\"], "C:\\"],
      [["C:rel", "/"], "C:\\"],
      [["//server/share", "/"], "\\\\server\\share\\"],
      // Latin-1 and UTF-16 strings.
      [["C:\\caf\u00e9", "rel"], "C:\\caf\u00e9\\rel"],
      [["C:\\\u4e2d\u6587", "rel\u6587"], "C:\\\u4e2d\u6587\\rel\u6587"],
      [["//s\u00e9rver/sh\u4e2dre/dir"], "\\\\s\u00e9rver\\sh\u4e2dre\\dir"],
      [["C:\\abs", "\u4e2d:rel"], "C:\\abs\\\u4e2d:rel"],
    ])("the walk ends inside %j", (args, expected) => {
      expect(path.win32.resolve(...args)).toBe(expected);
      for (const value of notStrings) {
        expect(path.win32.resolve(value, ...args)).toBe(expected);
      }
      expect(path.win32.resolve("Z:\\unread", null, ...args)).toBe(expected);
    });

    // The expected value is the path with "C:\\base" in front of the arguments.
    test.each([
      [[], "C:\\base"],
      [[""], "C:\\base"],
      [["rel"], "C:\\base\\rel"],
      [["a"], "C:\\base\\a"],
      [["rel", "..", "other"], "C:\\base\\other"],
      // A root without a device.
      [["\\"], "C:\\"],
      [["/"], "C:\\"],
      [["\\abs"], "C:\\abs"],
      [["/abs", "rel"], "C:\\abs\\rel"],
      [["\\foo\\bar"], "C:\\foo\\bar"],
      // A server without a share is not a UNC root.
      [["//dir"], "C:\\dir"],
      [["//server"], "C:\\server"],
      [["//server/"], "C:\\server"],
      [["//server//"], "C:\\server"],
      // A device without a root.
      [["C:rel"], "C:\\base\\rel"],
      [["C:"], "C:\\base"],
      [["c:rel", "C:other"], "C:\\base\\rel\\other"],
      [["C:rel", "a"], "C:\\base\\rel\\a"],
      [["C:rel", "."], "C:\\base\\rel"],
      // A path on another device, after a drive-relative path.
      [["D:\\other", "C:rel"], "C:\\base\\rel"],
      [["//server/share", "C:rel"], "C:\\base\\rel"],
      [["D:rel", "C:rel"], "C:\\base\\rel"],
      // Not a drive letter. U+212A KELVIN SIGN has the lower case "k".
      [["\u00e9:\\abs"], "C:\\base\\\u00e9:\\abs"],
      [["\u212a:\\abs"], "C:\\base\\\u212a:\\abs"],
      [["1:\\abs"], "C:\\base\\1:\\abs"],
      // Code units whose low byte is "C", ":", "\\" or "/".
      [["\u0143\u013a\u015cabs"], "C:\\base\\\u0143\u013a\u015cabs"],
      [["C\u013a\\abs"], "C:\\base\\C\u013a\\abs"],
      [["C:\u015cabs"], "C:\\base\\\u015cabs"],
      [["\u012fabs"], "C:\\base\\\u012fabs"],
      [["\u015c\u015cserver\u015cshare"], "C:\\base\\\u015c\u015cserver\u015cshare"],
    ])("the walk reaches the argument before %j", (args, expected) => {
      expect(path.win32.resolve("C:\\base", ...args)).toBe(expected);
      for (const value of notStrings) {
        expect(() => path.win32.resolve(value, ...args)).toThrow(named(0));
      }
    });

    test("the error names the last argument that is not a string, of those that are read", () => {
      expect(() => path.win32.resolve("C:\\abs", 123)).toThrow(named(1));
      expect(() => path.win32.resolve(null, 123, "rel")).toThrow(named(1));
      expect(() => path.win32.resolve(null, "C:\\abs", 123, "rel")).toThrow(named(2));
      expect(() => path.win32.resolve(null, "D:\\other", {}, "C:rel")).toThrow(named(2));
      expect(path.win32.resolve(null, 123, "C:\\abs", "", "rel")).toBe("C:\\abs\\rel");
    });

    test("more than 8 arguments", () => {
      const rels = Array.from({ length: 12 }, (_, i) => "r" + i);
      expect(path.win32.resolve(123, "C:\\abs", ...rels)).toBe("C:\\abs\\" + rels.join("\\"));
      expect(path.win32.resolve(...rels.map(() => 123), "C:\\abs", "rel")).toBe("C:\\abs\\rel");
      expect(() => path.win32.resolve(123, "\\abs", ...rels)).toThrow(named(0));
    });

    test("posix.resolve validates every argument up to the first absolute one", () => {
      expect(() => path.posix.resolve(undefined, "C:\\abs")).toThrow(named(0));
      expect(() => path.posix.resolve(null, 123, "rel")).toThrow(named(1));
      expect(path.posix.resolve(undefined, 123, "/abs", "rel")).toBe("/abs/rel");
    });
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
});
