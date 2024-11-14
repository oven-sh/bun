//#FILE: test-path-relative.js
//#SHA1: 9f0d03bf451853a369a3b31b94b902ee4f607e51
//-----------------
"use strict";

const path = require("path");

describe("path.relative", () => {
  const relativeTests = [
    [
      path.win32.relative,
      // Arguments                     result
      [
        ["c:/blah\\blah", "d:/games", "d:\\games"],
        ["c:/aaaa/bbbb", "c:/aaaa", ".."],
        ["c:/aaaa/bbbb", "c:/cccc", "..\\..\\cccc"],
        ["c:/aaaa/bbbb", "c:/aaaa/bbbb", ""],
        ["c:/aaaa/bbbb", "c:/aaaa/cccc", "..\\cccc"],
        ["c:/aaaa/", "c:/aaaa/cccc", "cccc"],
        ["c:/", "c:\\aaaa\\bbbb", "aaaa\\bbbb"],
        ["c:/aaaa/bbbb", "d:\\", "d:\\"],
        ["c:/AaAa/bbbb", "c:/aaaa/bbbb", ""],
        ["c:/aaaaa/", "c:/aaaa/cccc", "..\\aaaa\\cccc"],
        ["C:\\foo\\bar\\baz\\quux", "C:\\", "..\\..\\..\\.."],
        ["C:\\foo\\test", "C:\\foo\\test\\bar\\package.json", "bar\\package.json"],
        ["C:\\foo\\bar\\baz-quux", "C:\\foo\\bar\\baz", "..\\baz"],
        ["C:\\foo\\bar\\baz", "C:\\foo\\bar\\baz-quux", "..\\baz-quux"],
        ["\\\\foo\\bar", "\\\\foo\\bar\\baz", "baz"],
        ["\\\\foo\\bar\\baz", "\\\\foo\\bar", ".."],
        ["\\\\foo\\bar\\baz-quux", "\\\\foo\\bar\\baz", "..\\baz"],
        ["\\\\foo\\bar\\baz", "\\\\foo\\bar\\baz-quux", "..\\baz-quux"],
        ["C:\\baz-quux", "C:\\baz", "..\\baz"],
        ["C:\\baz", "C:\\baz-quux", "..\\baz-quux"],
        ["\\\\foo\\baz-quux", "\\\\foo\\baz", "..\\baz"],
        ["\\\\foo\\baz", "\\\\foo\\baz-quux", "..\\baz-quux"],
        ["C:\\baz", "\\\\foo\\bar\\baz", "\\\\foo\\bar\\baz"],
        ["\\\\foo\\bar\\baz", "C:\\baz", "C:\\baz"],
      ],
    ],
    [
      path.posix.relative,
      // Arguments          result
      [
        ["/var/lib", "/var", ".."],
        ["/var/lib", "/bin", "../../bin"],
        ["/var/lib", "/var/lib", ""],
        ["/var/lib", "/var/apache", "../apache"],
        ["/var/", "/var/lib", "lib"],
        ["/", "/var/lib", "var/lib"],
        ["/foo/test", "/foo/test/bar/package.json", "bar/package.json"],
        ["/Users/a/web/b/test/mails", "/Users/a/web/b", "../.."],
        ["/foo/bar/baz-quux", "/foo/bar/baz", "../baz"],
        ["/foo/bar/baz", "/foo/bar/baz-quux", "../baz-quux"],
        ["/baz-quux", "/baz", "../baz"],
        ["/baz", "/baz-quux", "../baz-quux"],
        ["/page1/page2/foo", "/", "../../.."],
      ],
    ],
  ];

  relativeTests.forEach(test => {
    const relative = test[0];
    const os = relative === path.win32.relative ? "win32" : "posix";

    test[1].forEach(testCase => {
      it(`path.${os}.relative(${JSON.stringify(testCase[0])}, ${JSON.stringify(testCase[1])})`, () => {
        const actual = relative(testCase[0], testCase[1]);
        const expected = testCase[2];
        expect(actual).toBe(expected);
      });
    });
  });
});

//<#END_FILE: test-path-relative.js
