import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import path from "node:path";

describe("path.parse", () => {
  test("general", () => {
    const winPaths = [
      // [path, root]
      ["C:\\path\\dir\\index.html", "C:\\"],
      ["C:\\another_path\\DIR\\1\\2\\33\\\\index", "C:\\"],
      ["another_path\\DIR with spaces\\1\\2\\33\\index", ""],
      ["\\", "\\"],
      ["\\foo\\C:", "\\"],
      ["file", ""],
      ["file:stream", ""],
      [".\\file", ""],
      ["C:", "C:"],
      ["C:.", "C:"],
      ["C:..", "C:"],
      ["C:abc", "C:"],
      ["C:\\", "C:\\"],
      ["C:\\abc", "C:\\"],
      ["", ""],

      // unc
      ["\\\\server\\share\\file_path", "\\\\server\\share\\"],
      ["\\\\server two\\shared folder\\file path.zip", "\\\\server two\\shared folder\\"],
      ["\\\\teela\\admin$\\system32", "\\\\teela\\admin$\\"],
      ["\\\\?\\UNC\\server\\share", "\\\\?\\UNC\\"],
    ];

    const winSpecialCaseParseTests = [
      ["t", { base: "t", name: "t", root: "", dir: "", ext: "" }],
      ["/foo/bar", { root: "/", dir: "/foo", base: "bar", ext: "", name: "bar" }],
    ];

    const winSpecialCaseFormatTests = [
      [{ dir: "some\\dir" }, "some\\dir\\"],
      [{ base: "index.html" }, "index.html"],
      [{ root: "C:\\" }, "C:\\"],
      [{ name: "index", ext: ".html" }, "index.html"],
      [{ dir: "some\\dir", name: "index", ext: ".html" }, "some\\dir\\index.html"],
      [{ root: "C:\\", name: "index", ext: ".html" }, "C:\\index.html"],
      [{}, ""],
    ];

    const unixPaths = [
      // [path, root]
      ["/home/user/dir/file.txt", "/"],
      ["/home/user/a dir/another File.zip", "/"],
      ["/home/user/a dir//another&File.", "/"],
      ["/home/user/a$$$dir//another File.zip", "/"],
      ["user/dir/another File.zip", ""],
      ["file", ""],
      [".\\file", ""],
      ["./file", ""],
      ["C:\\foo", ""],
      ["/", "/"],
      ["", ""],
      [".", ""],
      ["..", ""],
      ["/foo", "/"],
      ["/foo.", "/"],
      ["/foo.bar", "/"],
      ["/.", "/"],
      ["/.foo", "/"],
      ["/.foo.bar", "/"],
      ["/foo/bar.baz", "/"],
    ];

    const unixSpecialCaseFormatTests = [
      [{ dir: "some/dir" }, "some/dir/"],
      [{ base: "index.html" }, "index.html"],
      [{ root: "/" }, "/"],
      [{ name: "index", ext: ".html" }, "index.html"],
      [{ dir: "some/dir", name: "index", ext: ".html" }, "some/dir/index.html"],
      [{ root: "/", name: "index", ext: ".html" }, "/index.html"],
      [{}, ""],
    ];

    const errors = [
      { method: "parse", input: [null] },
      { method: "parse", input: [{}] },
      { method: "parse", input: [true] },
      { method: "parse", input: [1] },
      { method: "parse", input: [] },
      { method: "format", input: [null] },
      { method: "format", input: [""] },
      { method: "format", input: [true] },
      { method: "format", input: [1] },
    ];

    checkParseFormat(path.win32, winPaths);
    checkParseFormat(path.posix, unixPaths);
    checkSpecialCaseParseFormat(path.win32, winSpecialCaseParseTests);
    checkErrors(path.win32);
    checkErrors(path.posix);
    checkFormat(path.win32, winSpecialCaseFormatTests);
    checkFormat(path.posix, unixSpecialCaseFormatTests);

    // Test removal of trailing path separators
    const trailingTests = [
      [
        path.win32.parse,
        [
          [".\\", { root: "", dir: "", base: ".", ext: "", name: "." }],
          ["\\\\", { root: "\\", dir: "\\", base: "", ext: "", name: "" }],
          ["\\\\", { root: "\\", dir: "\\", base: "", ext: "", name: "" }],
          ["c:\\foo\\\\\\", { root: "c:\\", dir: "c:\\", base: "foo", ext: "", name: "foo" }],
          ["D:\\foo\\\\\\bar.baz", { root: "D:\\", dir: "D:\\foo\\\\", base: "bar.baz", ext: ".baz", name: "bar" }],
        ],
      ],
      [
        path.posix.parse,
        [
          ["./", { root: "", dir: "", base: ".", ext: "", name: "." }],
          ["//", { root: "/", dir: "/", base: "", ext: "", name: "" }],
          ["///", { root: "/", dir: "/", base: "", ext: "", name: "" }],
          ["/foo///", { root: "/", dir: "/", base: "foo", ext: "", name: "foo" }],
          ["/foo///bar.baz", { root: "/", dir: "/foo//", base: "bar.baz", ext: ".baz", name: "bar" }],
        ],
      ],
    ];
    const failures = [];
    trailingTests.forEach(test => {
      const parse = test[0];
      const os = parse === path.win32.parse ? "win32" : "posix";
      test[1].forEach(test => {
        const actual = parse(test[0]);
        const expected = test[1];
        const message = `path.${os}.parse(${JSON.stringify(test[0])})\n  expect=${JSON.stringify(
          expected,
        )}\n  actual=${JSON.stringify(actual)}`;
        const actualKeys = Object.keys(actual);
        const expectedKeys = Object.keys(expected);
        let failed = actualKeys.length !== expectedKeys.length;
        if (!failed) {
          for (let i = 0; i < actualKeys.length; ++i) {
            const key = actualKeys[i];
            if (!expectedKeys.includes(key) || actual[key] !== expected[key]) {
              failed = true;
              break;
            }
          }
        }
        if (failed) failures.push(`\n${message}`);
      });
    });
    assert.strictEqual(failures.length, 0, failures.join(""));

    function checkErrors(path) {
      errors.forEach(({ method, input }) => {
        assert.throws(
          () => {
            path[method].apply(path, input);
          },
          {
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
          },
        );
      });
    }

    function checkParseFormat(path, paths) {
      paths.forEach(([element, root]) => {
        const output = path.parse(element);
        assert.strictEqual(typeof output.root, "string");
        assert.strictEqual(typeof output.dir, "string");
        assert.strictEqual(typeof output.base, "string");
        assert.strictEqual(typeof output.ext, "string");
        assert.strictEqual(typeof output.name, "string");
        assert.strictEqual(path.format(output), element);
        assert.strictEqual(output.root, root);
        assert(output.dir.startsWith(output.root));
        assert.strictEqual(output.dir, output.dir ? path.dirname(element) : "");
        assert.strictEqual(output.base, path.basename(element));
        assert.strictEqual(output.ext, path.extname(element));
      });
    }

    function checkSpecialCaseParseFormat(path, testCases) {
      testCases.forEach(([element, expect]) => {
        assert.deepStrictEqual(path.parse(element), expect);
      });
    }

    function checkFormat(path, testCases) {
      testCases.forEach(([element, expect]) => {
        assert.strictEqual(path.format(element), expect);
      });

      [
        [null, "null"],
        [undefined, "undefined"],
        [1, "type number (1)"],
        [-0, "type number (-0)"],
        [true, "type boolean (true)"],
        [false, "type boolean (false)"],
        ["string", "type string ('string')"],
        ["it's\n", `type string ("it's\\n")`],
        ["abcdefghijklmnopqrstuvwxyz'abc", "type string ('abcdefghijklmnopqrstuvwxy...')"],
        [[], "an instance of Array"],
        [function named() {}, "function named"],
      ].forEach(([pathObject, received]) => {
        assert.throws(
          () => {
            path.format(pathObject);
          },
          {
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            message: `The "pathObject" argument must be of type object. Received ${received}`,
          },
        );
      });
    }

    // See https://github.com/nodejs/node/issues/44343
    assert.strictEqual(path.format({ name: "x", ext: "png" }), "x.png");
    assert.strictEqual(path.format({ name: "x", ext: ".png" }), "x.png");
  });
});

describe("path.format", () => {
  test("formats { dir, name, ext } with a dot-less ext when the result exceeds the platform path limit", async () => {
    // When `base` is absent and `ext` does not start with ".", format() inserts the dot itself.
    // The formatted result must stay correct even when the combined length of dir/name/ext is far
    // larger than the platform MAX_PATH, and the process must not crash. Run in a subprocess so a
    // crash in the native formatter shows up as a bad exit code instead of taking down the runner.
    const code = `
      const path = require("node:path");
      const dir = "/" + "d".repeat(70000);
      const name = "n".repeat(70000);
      const ext = "txt";

      const posix = path.posix.format({ dir, name, ext });
      const win = path.win32.format({ dir, name, ext });

      console.log(posix === dir + "/" + name + "." + ext);
      console.log(win === dir + "\\\\" + name + "." + ext);

      // Legitimate small case keeps working too.
      console.log(path.posix.format({ dir: "/tmp", name: "file", ext: "txt" }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("true\ntrue\n/tmp/file.txt\n");
    expect(exitCode).toBe(0);
  });

  // Node v26.3.0 answers every case below in the same way. Its format is _format of lib/path.js:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/path.js#L156-L180
  describe.each([
    ["posix", path.posix, "/"],
    ["win32", path.win32, "\\"],
  ])("path.%s.format", (_, { format }, sep) => {
    test("a member that is falsy counts as absent, whatever it is", () => {
      expect(format({ dir: 0, root: "/r/", base: "b" })).toBe("/r/b");
      expect(format({ dir: "/a", base: false, name: "n", ext: ".e" })).toBe(`/a${sep}n.e`);
      expect(format({ name: 0, ext: ".e" })).toBe(".e");
      expect(format({ base: NaN, name: "n" })).toBe("n");
      expect(format({ dir: null, root: undefined, base: "b" })).toBe("b");
      expect(format({ dir: "", root: "", base: "", name: "", ext: "" })).toBe("");
    });

    test("a member that is no string is converted where the answer is put together", () => {
      expect(format({ dir: 12, base: "b" })).toBe(`12${sep}b`);
      expect(format({ dir: true, base: "b" })).toBe(`true${sep}b`);
      expect(format({ dir: "/a", base: [] })).toBe(`/a${sep}`);
      expect(format({ name: "n", ext: 5 })).toBe("n.5");
      // Nothing is put together around a base alone: it is answered as it is.
      expect(format({ base: 5 })).toBe(5);
      expect(() => format({ dir: Symbol("s"), base: "b" })).toThrow(TypeError);
    });

    test("dir is the root where the two are one value", () => {
      expect(format({ dir: "/a", root: "/a", base: "b" })).toBe("/ab");
      expect(format({ root: "/", base: "b" })).toBe("/b");
      expect(format({ dir: "1", root: 1, base: "b" })).toBe(`1${sep}b`);
    });

    test("members are read where they are needed, inherited ones too", () => {
      const readsOf = object => {
        const seen = [];
        format(new Proxy(object, { get: (target, key) => (seen.push(key), target[key]) }));
        return seen.join();
      };
      expect(readsOf({ dir: "/d", root: "/", base: "b", name: "n", ext: ".e" })).toBe("dir,base,root");
      expect(readsOf({ root: "/", name: "n", ext: ".e" })).toBe("dir,root,base,name,ext,root");
      expect(readsOf({})).toBe("dir,root,base,name,ext");

      class Getters {
        get dir() {
          return "/c";
        }
        get base() {
          return "d";
        }
      }
      expect(format(new Getters())).toBe(`/c${sep}d`);
      expect(format(Object.create({ dir: "/a", base: "b" }))).toBe(`/a${sep}b`);
      expect(format(Object.assign(Object.create(null), { dir: "/n", base: "b" }))).toBe(`/n${sep}b`);
      expect(() =>
        format({
          get dir() {
            throw new RangeError("from the getter");
          },
        }),
      ).toThrow(new RangeError("from the getter"));
    });

    test("objects are converted in the order of the answer", () => {
      const log = [];
      const noisy = (name, text) => ({ toString: () => (log.push(name), text) });
      expect(format({ dir: noisy("dir", "/d"), base: noisy("base", "b"), root: noisy("root", "/") })).toBe(`/d${sep}b`);
      expect(log.splice(0).join()).toBe("dir,base");
      // An object has no first character, so its extension gets a dot.
      expect(format({ root: noisy("root", "/"), name: noisy("name", "n"), ext: noisy("ext", ".e") })).toBe("/n..e");
      expect(log.join()).toBe("name,ext,root");
    });

    test("a lone surrogate is kept", () => {
      expect(format({ dir: "/a", base: "\ud800" })).toBe(`/a${sep}\ud800`);
    });

    test("only the first argument is looked at, and `this` is not", () => {
      expect(format({ dir: "/a", base: "b" }, { dir: "/x" })).toBe(`/a${sep}b`);
      expect(format.call({ dir: "/t" }, { dir: "/a", base: "b" })).toBe(`/a${sep}b`);
      expect(format(new Date(0))).toBe("");
      expect(format(new Map([["dir", "/m"]]))).toBe("");
    });

    test("what is no object, an array or a function is refused in Node's words", () => {
      for (const [value, received] of [
        [[], "an instance of Array"],
        [new Proxy([], {}), "an instance of Array"],
        [function named() {}, "function named"],
        [class A {}, "function A"],
        [Symbol("s"), "type symbol (Symbol(s))"],
        [5n, "type bigint (5n)"],
      ]) {
        expect(() => format(value)).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            message: `The "pathObject" argument must be of type object. Received ${received}`,
          }),
        );
      }
      expect(() => format()).toThrow('The "pathObject" argument must be of type object. Received undefined');
    });
  });
});
