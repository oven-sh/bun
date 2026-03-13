import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import assert from "node:assert";
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

  test("undefined argument are ignored if absolute path comes first (reverse loop through args)", () => {
    expect(() => {
      return path.posix.resolve(undefined, "hi");
    }).toThrow('The "paths[0]" property must be of type string, got undefined');
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
});
