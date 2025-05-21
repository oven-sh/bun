import { describe, test } from "bun:test";
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

      [null, undefined, 1, true, false, "string"].forEach(pathObject => {
        assert.throws(
          () => {
            path.format(pathObject);
          },
          {
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            // TODO: Make our error messages use util.inspect like Node:
            // https://github.com/nodejs/node/blob/68885d512640556ba95b18f5ab2e0b9e76013399/lib/internal/errors.js#L1370-L1440
            // https://github.com/nodejs/node/blob/68885d512640556ba95b18f5ab2e0b9e76013399/test/common/index.js#L815
            //
            // Node's error message template is:
            //  `The "pathObject" argument must be of type object. Received ${inspect(input, { depth: -1 })}`
            //
            // For example, when we throw for path.format(null) our error message is:
            //   The "pathObject" property must be of type object, got object
            //
            // While Node's error message is:
            //   The "pathObject" argument must be of type object. Received null
            message: `The "pathObject" property must be of type object, got ${typeof pathObject}`,
          },
        );
      });
    }

    // See https://github.com/nodejs/node/issues/44343
    assert.strictEqual(path.format({ name: "x", ext: "png" }), "x.png");
    assert.strictEqual(path.format({ name: "x", ext: ".png" }), "x.png");
  });
});
