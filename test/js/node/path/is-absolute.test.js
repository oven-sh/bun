import { describe, test } from "bun:test";
import assert from "node:assert";
import path from "node:path";

describe("path.isAbsolute", () => {
  test("win32", () => {
    assert.strictEqual(path.win32.isAbsolute("/"), true);
    assert.strictEqual(path.win32.isAbsolute("//"), true);
    assert.strictEqual(path.win32.isAbsolute("//server"), true);
    assert.strictEqual(path.win32.isAbsolute("//server/file"), true);
    assert.strictEqual(path.win32.isAbsolute("\\\\server\\file"), true);
    assert.strictEqual(path.win32.isAbsolute("\\\\server"), true);
    assert.strictEqual(path.win32.isAbsolute("\\\\"), true);
    assert.strictEqual(path.win32.isAbsolute("c"), false);
    assert.strictEqual(path.win32.isAbsolute("c:"), false);
    assert.strictEqual(path.win32.isAbsolute("c:\\"), true);
    assert.strictEqual(path.win32.isAbsolute("c:/"), true);
    assert.strictEqual(path.win32.isAbsolute("c://"), true);
    assert.strictEqual(path.win32.isAbsolute("C:/Users/"), true);
    assert.strictEqual(path.win32.isAbsolute("C:\\Users\\"), true);
    assert.strictEqual(path.win32.isAbsolute("C:cwd/another"), false);
    assert.strictEqual(path.win32.isAbsolute("C:cwd\\another"), false);
    assert.strictEqual(path.win32.isAbsolute("directory/directory"), false);
    assert.strictEqual(path.win32.isAbsolute("directory\\directory"), false);
  });

  test("posix", () => {
    assert.strictEqual(path.posix.isAbsolute("/home/foo"), true);
    assert.strictEqual(path.posix.isAbsolute("/home/foo/.."), true);
    assert.strictEqual(path.posix.isAbsolute("bar/"), false);
    assert.strictEqual(path.posix.isAbsolute("./baz"), false);
  });

  test("characters outside Latin-1", () => {
    const answers = text => [path.posix.isAbsolute(text), path.win32.isAbsolute(text)];
    assert.deepStrictEqual(answers("/日本"), [true, true]);
    assert.deepStrictEqual(answers("\\日本"), [false, true]);
    assert.deepStrictEqual(answers("日本/"), [false, false]);
    assert.deepStrictEqual(answers("日:/"), [false, false]);
    assert.deepStrictEqual(answers("C:\\日本"), [false, true]);
    assert.deepStrictEqual(answers("C:日本"), [false, false]);
    assert.deepStrictEqual(answers("日"), [false, false]);
  });

  // The characters of a string decide the answer, not how the string holds them.
  test("a string in 16-bit storage, a part of one and a rope answer as the 8-bit string does", () => {
    const flat = text => (text.charCodeAt(0), text);
    // What is joined of the parts of a 16-bit string is one 16-bit string. A part of one stays a part of it.
    const in16Bits = text =>
      flat("日" + text)
        .split("日")
        .join("");
    const forms = {
      "16-bit": in16Bits,
      "a part of a 16-bit string": text => flat("日" + text + "本").slice(1, -1),
      "a rope": text => (text.length < 2 ? text : text.slice(0, 1) + text.slice(1)),
      "a rope of 16-bit strings": text =>
        text.length < 2 ? text : in16Bits(text.slice(0, 1)) + in16Bits(text.slice(1)),
    };
    const texts = [
      "",
      "/",
      "//",
      "/a",
      "a",
      "a/",
      "./a",
      "../a",
      ".",
      "\\",
      "\\\\",
      "\\\\server\\share",
      "//server/share",
      "c",
      "c:",
      "c:\\",
      "c:/",
      "c://",
      "C:\\Users\\",
      "C:cwd\\another",
      "z:/",
      "Z:\\",
      "1:/",
      "é:/",
      "::/",
      "/é",
      "é/",
      "home/user/projects/app/src/index.ts",
      "/home/user/projects/app/src/index.ts",
      "C:\\Users\\someone\\projects\\app\\src\\index.ts",
    ];
    const different = [];
    for (const [flavor, { isAbsolute }] of Object.entries({ posix: path.posix, win32: path.win32 })) {
      for (const text of texts) {
        for (const [name, form] of Object.entries(forms)) {
          const held = form(text);
          // The answer is taken first: a comparison makes one string of a rope.
          const answer = isAbsolute(held);
          assert.strictEqual(held, text);
          if (answer !== isAbsolute(text)) different.push([flavor, text, name]);
        }
      }
    }
    assert.deepStrictEqual(different, []);
  });
});
