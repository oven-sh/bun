import { serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import assert from "node:assert";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

describe("path", () => {
  test("errors", () => {
    // Test thrown TypeErrors
    const typeErrorTests = [true, false, 7, null, {}, undefined, [], NaN];

    function fail(fn) {
      const args = Array.from(arguments).slice(1);

      assert.throws(
        () => {
          fn.apply(null, args);
        },
        { code: "ERR_INVALID_ARG_TYPE", name: "TypeError" },
      );
    }

    for (const test of typeErrorTests) {
      for (const namespace of [path.posix, path.win32]) {
        fail(namespace.join, test);
        fail(namespace.resolve, test);
        fail(namespace.normalize, test);
        fail(namespace.isAbsolute, test);
        fail(namespace.relative, test, "foo");
        fail(namespace.relative, "foo", test);
        fail(namespace.parse, test);
        fail(namespace.dirname, test);
        fail(namespace.basename, test);
        fail(namespace.extname, test);

        // Undefined is a valid value as the second argument to basename
        if (test !== undefined) {
          fail(namespace.basename, "foo", test);
        }
      }
    }
  });

  test("path.sep", () => {
    // path.sep tests
    // windows
    assert.strictEqual(path.win32.sep, "\\");
    // posix
    assert.strictEqual(path.posix.sep, "/");
  });

  test("path.delimiter", () => {
    // path.delimiter tests
    // windows
    assert.strictEqual(path.win32.delimiter, ";");
    // posix
    assert.strictEqual(path.posix.delimiter, ":");

    if (isWindows) assert.strictEqual(path, path.win32);
    else assert.strictEqual(path, path.posix);
  });
});

// Node reads the UTF-16 code units of its operands and answers with them. UTF-8 has no unpaired surrogate, and a length
// in it is a count of bytes.
describe("code units", () => {
  const { posix, win32 } = path;

  describe.each([
    ["an unpaired lead surrogate", "\ud800"],
    ["an unpaired trail surrogate", "\udc00"],
    ["a trail surrogate in front of a lead surrogate", "\udc00\ud800"],
    ["a surrogate pair", "\ud83d\ude00"],
  ])("%s is answered as it was given", (_, u) => {
    test("path.posix", () => {
      expect({
        normalize: posix.normalize(`/a/./${u}/../${u}${u}/x`),
        basename: posix.basename(`/a/${u}.txt`),
        basenameWithoutAsciiSuffix: posix.basename(`/a/${u}.txt`, ".txt"),
        basenameWithoutSuffix: posix.basename(`/a/x.${u}`, `.${u}`),
        basenameOf8BitPath: posix.basename("/a/b.txt", u),
        dirname: posix.dirname(`/${u}/x`),
        extname: posix.extname(`/a/b.${u}`),
        join: posix.join("a", u, "b"),
        joinWithLatin1: posix.join("\u00e9", u, "./x"),
        resolve: posix.resolve("/a", u, "b"),
        relativeInto: posix.relative("/a", `/a/${u}`),
        relativeBeside: posix.relative(`/${u}/a`, `/${u}/b`),
        relativeOutOf: posix.relative(`/${u}`, `/${u}x`),
        parse: posix.parse(`/${u}/x.${u}`),
        format: posix.format({ dir: `/${u}`, base: "x" }),
        formatName: posix.format({ root: "/", name: u, ext: u }),
        isAbsolute: posix.isAbsolute(`/${u}`),
        toNamespacedPath: posix.toNamespacedPath(u),
      }).toEqual({
        normalize: `/a/${u}${u}/x`,
        basename: `${u}.txt`,
        basenameWithoutAsciiSuffix: u,
        basenameWithoutSuffix: "x",
        basenameOf8BitPath: "b.txt",
        dirname: `/${u}`,
        extname: `.${u}`,
        join: `a/${u}/b`,
        joinWithLatin1: `\u00e9/${u}/x`,
        resolve: `/a/${u}/b`,
        relativeInto: u,
        relativeBeside: "../b",
        relativeOutOf: `../${u}x`,
        parse: { root: "/", dir: `/${u}`, base: `x.${u}`, ext: `.${u}`, name: "x" },
        format: `/${u}/x`,
        formatName: `/${u}.${u}`,
        isAbsolute: true,
        toNamespacedPath: u,
      });
    });

    test("path.win32", () => {
      expect({
        normalize: win32.normalize(`C:\\a\\.\\${u}\\..\\${u}${u}/x`),
        basename: win32.basename(`C:\\a\\${u}.txt`),
        basenameWithoutAsciiSuffix: win32.basename(`C:\\a\\${u}.txt`, ".txt"),
        basenameWithoutSuffix: win32.basename(`C:\\a\\x.${u}`, `.${u}`),
        basenameOf8BitPath: win32.basename("C:\\a\\b.txt", u),
        dirname: win32.dirname(`C:\\${u}\\x`),
        extname: win32.extname(`C:\\a\\b.${u}`),
        join: win32.join("a", u, "b"),
        joinWithLatin1: win32.join("\u00e9", u, ".\\x"),
        resolve: win32.resolve("C:\\a", u, "b"),
        resolveShare: win32.resolve(`\\\\${u}\\share\\x`, ".."),
        relativeInto: win32.relative("C:\\a", `C:\\a\\${u}`),
        relativeBeside: win32.relative(`C:\\${u}\\a`, `C:\\${u}\\b`),
        relativeOutOf: win32.relative(`C:\\${u}`, `C:\\${u}x`),
        parse: win32.parse(`C:\\${u}\\x.${u}`),
        format: win32.format({ dir: `C:\\${u}`, base: "x" }),
        formatName: win32.format({ root: "C:\\", name: u, ext: u }),
        isAbsolute: win32.isAbsolute(`\\${u}`),
        toNamespacedPath: win32.toNamespacedPath(`C:\\${u}\\x`),
        toNamespacedPathOfShare: win32.toNamespacedPath(`\\\\${u}\\share\\x`),
      }).toEqual({
        normalize: `C:\\a\\${u}${u}\\x`,
        basename: `${u}.txt`,
        basenameWithoutAsciiSuffix: u,
        basenameWithoutSuffix: "x",
        basenameOf8BitPath: "b.txt",
        dirname: `C:\\${u}`,
        extname: `.${u}`,
        join: `a\\${u}\\b`,
        joinWithLatin1: `\u00e9\\${u}\\x`,
        resolve: `C:\\a\\${u}\\b`,
        resolveShare: `\\\\${u}\\share\\`,
        relativeInto: u,
        relativeBeside: "..\\b",
        relativeOutOf: `..\\${u}x`,
        parse: { root: "C:\\", dir: `C:\\${u}`, base: `x.${u}`, ext: `.${u}`, name: "x" },
        format: `C:\\${u}\\x`,
        formatName: `C:\\${u}.${u}`,
        isAbsolute: true,
        toNamespacedPath: `\\\\?\\C:\\${u}\\x`,
        toNamespacedPathOfShare: `\\\\?\\UNC\\${u}\\share\\x`,
      });
    });
  });

  test("two strings that differ in an unpaired surrogate are not the same string", () => {
    expect({
      relative: posix.relative("/\ud800", "/\udc00"),
      relativeWin32: win32.relative("C:\\\ud800", "C:\\\udc00"),
      basename: posix.basename("/a\ud800", "\udc00"),
      halfOfAPair: posix.basename("/\ud800\udc00", "\udc00"),
      halfOfAPairWin32: win32.basename("C:\\\ud800\udc00", "\udc00"),
      otherHalfOfAPair: posix.basename("/\ud83d\ude00", "\ud83d"),
      format: posix.format({ root: "\ud800", dir: "\udc00", base: "x" }),
      formatWin32: win32.format({ root: "\ud800", dir: "\udc00", base: "x" }),
    }).toEqual({
      relative: "../\udc00",
      relativeWin32: "..\\\udc00",
      basename: "a\ud800",
      halfOfAPair: "\ud800",
      halfOfAPairWin32: "\ud800",
      otherHalfOfAPair: "\ud83d\ude00",
      format: "\udc00/x",
      formatWin32: "\udc00\\x",
    });
  });

  test("a length is a count of code units", () => {
    expect({
      // A suffix that is no longer than the path is looked for, and a path of nothing but separators is then answered whole.
      basenameOfRoot: posix.basename("/", "\u00e9"),
      basenameOfRootWin32: win32.basename("\\", "\u00e9"),
      basenameOfRootIn16Bits: posix.basename("//", "\u65e5\u672c"),
      basenameOfFolder: posix.basename("\u00e9/", "\u00e9\u00e9"),
      // All of both paths are compared, whatever they hold.
      relativeBehindNul: win32.relative("C:\\a\0b", "C:\\A\0c"),
      relativeBehindNulIn16Bits: win32.relative("C:\\\u65e5\0b", "C:\\\u65e5\0c"),
    }).toEqual({
      basenameOfRoot: "/",
      basenameOfRootWin32: "\\",
      basenameOfRootIn16Bits: "//",
      basenameOfFolder: "\u00e9/",
      relativeBehindNul: "..\\A\0c",
      relativeBehindNulIn16Bits: "..\\\u65e5\0c",
    });
  });

  // On Windows a path without a drive takes the drive of the working directory, and none of these is that short then.
  test.skipIf(isWindows)("a name of two code units is what path.win32 takes for a drive", () => {
    expect({
      relativeInto: win32.relative("/\u00e9", "/\u00e9a"),
      relativeOutOf: win32.relative("/\u00e9a", "/\u00e9"),
      relativeToColon: win32.relative("/\u00e9", "/\u00e9:"),
      relativeOfPair: win32.relative("/\ud83d\ude00", "/\ud83d\ude00a"),
      relativeOfThree: win32.relative("/ab\u00e9", "/ab"),
      toNamespacedPath: win32.toNamespacedPath("/\u00e9"),
      toNamespacedPathIn16Bits: win32.toNamespacedPath("\\\u65e5"),
      toNamespacedPathOfTwo: win32.toNamespacedPath("/\u00e9\u00e9"),
    }).toEqual({
      relativeInto: "..\u00e9a",
      relativeOutOf: "..\u00e9",
      relativeToColon: "..\u00e9:",
      relativeOfPair: "a",
      relativeOfThree: "",
      toNamespacedPath: "/\u00e9",
      toNamespacedPathIn16Bits: "\\\u65e5",
      toNamespacedPathOfTwo: "\\\u00e9\u00e9",
    });
  });

  const flat = text => (text.charCodeAt(0), text);
  const in8Bits = text => Buffer.from(text, "latin1").toString("latin1");
  const in16Bits = text => flat("\u65e5" + text + "\u672c").slice(1, -1);
  const copy = text => Buffer.from(text, "utf16le").toString("utf16le");
  const forms = {
    rope: text => copy(text.slice(0, text.length >> 1)) + copy(text.slice(text.length >> 1)),
    // The first character in 8 bits, if an 8-bit string can hold it.
    ropeOfBothWidths: text =>
      (text.charCodeAt(0) < 0x100 ? in8Bits(text.slice(0, 1)) : copy(text.slice(0, 1))) + copy(text.slice(1)),
    substring: text => flat("<<" + text + ">>>").slice(2, -3),
    stringObject: text => new String(text),
  };

  test.each(Object.entries(forms))("a %s with an unpaired surrogate", (_, form) => {
    const u = "\udfff";
    for (const p of [posix, win32]) {
      const s = p.sep;
      expect({
        normalize: p.normalize(form(`${s}a${s}.${s}${u}`)),
        basename: p.basename(form(`${s}a${s}${u}.txt`), form(".txt")),
        dirname: p.dirname(form(`${s}${u}${s}x`)),
        extname: p.extname(form(`${s}a${s}b.${u}`)),
        join: p.join(form(`${s}a`), form(u), form("b")),
        // On Windows a drive is in front of it.
        resolve: p.resolve(form(`${s}a`), form(`${s}${u}`), form("b")).slice(-4),
        relative: p.relative(form(`${s}a${s}b`), form(`${s}a${s}${u}`)),
        parse: p.parse(form(`${s}${u}${s}x.${u}`)).ext,
        format: p.format({ dir: form(`${s}${u}`), base: form("x") }),
      }).toEqual({
        normalize: `${s}a${s}${u}`,
        basename: u,
        dirname: `${s}${u}`,
        extname: `.${u}`,
        join: `${s}a${s}${u}${s}b`,
        resolve: `${s}${u}${s}b`,
        relative: `..${s}${u}`,
        parse: `.${u}`,
        format: `${s}${u}${s}x`,
      });
    }
  });

  // A string is serialized with one byte or two for each character, as it is held.
  const isWide = text => serialize(text).byteLength > serialize(Buffer.alloc(text.length, "x").toString()).byteLength;

  test("an answer is held in 16 bits if and only if one of its characters is outside ASCII", () => {
    const wrong = [];
    function check(call, answer) {
      if (answer.length > 1 && isWide(answer) !== /[^\x00-\x7f]/.test(answer))
        wrong.push(`${call}: ${JSON.stringify(answer)}`);
    }
    // Made here: an answer that is serialized takes the storage of a literal of the same characters.
    const names = [
      [0x6e, 0x61, 0x6d, 0x65],
      [0xe9, 0x74, 0xe9],
      [0x65e5, 0x672c, 0x8a9e],
      [0x61, 0xd800, 0x62],
      [0xd83d, 0xde00, 0x73],
    ].map(units => String.fromCharCode(...units));
    for (const [namespace, p] of Object.entries({ posix, win32 })) {
      for (const first of names) {
        for (const second of names) {
          for (const [form, held] of Object.entries({ in8Bits, in16Bits, ...forms })) {
            // An 8-bit string holds no character above U+00FF.
            if (held === in8Bits && /[^\x00-\xff]/.test(first + second)) continue;
            const at = `${namespace} ${form} ${JSON.stringify([first, second])}`;
            const text = held(`/plain/${first}/${second}.${first}`);
            check(`dirname ${at}`, p.dirname(text));
            check(`dirname twice ${at}`, p.dirname(p.dirname(text)));
            check(`basename ${at}`, p.basename(text));
            check(`basename without a suffix ${at}`, p.basename(text, held(`.${first}`)));
            check(`extname ${at}`, p.extname(text));
            check(`normalize ${at}`, p.normalize(held(`/plain/./${first}/../${second}`)));
            check(`join ${at}`, p.join("/plain", held(first), held(second)));
            check(`join upwards ${at}`, p.join(held(`/plain/${first}`), "..", held(second)));
            check(`resolve ${at}`, p.resolve("/plain", held(first), held(second)));
            check(`resolve upwards ${at}`, p.resolve(held(`/plain/${first}`), ".."));
            check(`resolve from the working directory ${at}`, p.resolve(held(first)));
            check(`relative ${at}`, p.relative(held(`/plain/${first}`), held(`/plain/${second}`)));
            check(`relative into ${at}`, p.relative("/plain", held(`/plain/${first}/${second}`)));
            check(`relative out of ${at}`, p.relative(held(`/plain/${first}/${second}`), "/plain/name"));
            check(`format ${at}`, p.format({ dir: held(`/plain/${first}`), name: held(second), ext: ".txt" }));
            check(`format a root ${at}`, p.format({ root: "/plain/", base: held(second) }));
            check(`toNamespacedPath ${at}`, win32.toNamespacedPath(held(`C:\\plain\\${first}\\..\\${second}`)));
            const parsed = p.parse(text);
            for (const key of ["root", "dir", "base", "ext", "name"]) check(`parse ${key} ${at}`, parsed[key]);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("path.format keeps each member it has read while it reads the next", () => {
    const members = { root: "/", dir: "/\ud800", base: "", name: "\udc00", ext: ".\u65e5" };
    const pathObject = new Proxy(
      {},
      {
        get(_, key) {
          Bun.gc(true);
          // A string that nothing but the call holds.
          return typeof key === "string" && key in members ? copy(members[key] + key).slice(0, -key.length) : undefined;
        },
      },
    );
    expect([posix.format(pathObject), win32.format(pathObject)]).toEqual([
      "/\ud800/\udc00.\u65e5",
      "/\ud800\\\udc00.\u65e5",
    ]);
  });

  // `createRequire()` of a directory joins a file name to it.
  test.skipIf(isWindows)("createRequire of a directory whose name has an unpaired surrogate", () => {
    expect(createRequire("/a\ud800/").resolve.paths("./b")).toEqual(["/a\ud800"]);
  });

  const checksOfWorkingDirectory = `
    const path = require("node:path");
    const cwd = process.cwd();
    const { sep } = path;
    const isWindows = process.platform === "win32";
    const lone = String.fromCharCode(0xd800);
    const wide = String.fromCharCode(0x65e5, 0x672c);
    const latin1 = String.fromCharCode(0xe9);
    const expected = {};
    const answers = {};
    function check(name, answer, expectedAnswer) {
      answers[name] = answer;
      expected[name] = expectedAnswer;
    }
    for (const [name, text] of Object.entries({ ascii: "x", latin1, wide, lone })) {
      check("resolve " + name, path.resolve(text), cwd + sep + text);
      check("resolve two " + name, path.resolve("a", text), cwd + sep + "a" + sep + text);
      check("relative to " + name, path.relative("", text), text);
      check("relative from " + name, path.relative(text, ""), "..");
      check("relative beside " + name, path.relative("a", text), ".." + sep + text);
      check("relative from the working directory " + name, path.relative(cwd, text), text);
      // Without a drive the working directory is a path of either kind.
      if (!isWindows) {
        check("win32.resolve " + name, path.win32.resolve(text), cwd.replaceAll("/", "\\\\") + "\\\\" + text);
        check("win32.relative " + name, path.win32.relative("a", text), "..\\\\" + text);
        check("win32.toNamespacedPath " + name, path.win32.toNamespacedPath(text), cwd.replaceAll("/", "\\\\") + "\\\\" + text);
      }
    }
    const show = value => JSON.stringify(value).replace(/[^\\x20-\\x7e]/g, c => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    console.log(show(answers) === show(expected) ? "as expected" : show({ cwd, answers, expected }));
  `;

  test.concurrent("a working directory with characters outside ASCII", async () => {
    using dir = tempDir("path-\u00e9-\u65e5\u672c", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", checksOfWorkingDirectory],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "as expected", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The bytes FF and ED A0 80 are no UTF-8, and `process.cwd()` holds U+FFFD for each of the four.
  test.concurrent.skipIf(!isLinux)("a working directory whose name is not UTF-8", async () => {
    using dir = tempDir("path-not-utf8", {});
    mkdirSync(
      Buffer.concat([Buffer.from(String(dir) + "/a"), Buffer.from([0xff, 0xed, 0xa0, 0x80]), Buffer.from("b")]),
    );
    await using proc = Bun.spawn({
      cmd: [
        "sh",
        "-c",
        `cd "$(printf 'a\\377\\355\\240\\200b')" && exec "$0" -e "$1"`,
        bunExe(),
        `if (!process.cwd().endsWith("a\\ufffd\\ufffd\\ufffd\\ufffdb")) throw new Error("not in the directory");` +
          checksOfWorkingDirectory,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "as expected", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

test("String-object arguments whose toPrimitive triggers GC do not corrupt earlier arguments", async () => {
  // Converting argument N+1 runs user JS that GCs; the string produced for
  // argument N must still be intact when the native side reads it.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const long = "/dir/" + Buffer.alloc(16000, "seg_").toString();
const first = () => Object.assign(new String("x"), {
  [Symbol.toPrimitive]() { return long.slice(1).padStart(long.length, "/"); },
});
const second = value => Object.assign(new String("y"), {
  [Symbol.toPrimitive]() {
    Bun.gc(true);
    const keep = [];
    for (let i = 0; i < 200; i++) keep.push(Buffer.alloc(50000 + i, "Q").toString());
    globalThis.keep = keep;
    Bun.gc(true);
    return value;
  },
});
const results = [];
for (const ns of ["posix", "win32"]) {
  const p = path[ns];
  const cases = {
    join: () => [p.join(first(), second("tail")), p.join(long, "tail")],
    resolve: () => [p.resolve(first(), second("tail")), p.resolve(long, "tail")],
    relative: () => [p.relative(first(), second(long + "/x")), p.relative(long, long + "/x")],
    basename: () => [p.basename(first(), second("_")), p.basename(long, "_")],
  };
  for (const [name, fn] of Object.entries(cases)) {
    for (let r = 0; r < 3; r++) {
      const [got, want] = fn();
      results.push(ns + "." + name + "[" + r + "]=" + (got === want ? "OK" : "MISMATCH"));
    }
  }
}
console.log(results.join("\\n"));`,
    ],
    // Malloc=1 lets ASan builds see the freed JSC string; bmalloc has no SystemHeap on Windows.
    env: isWindows ? bunEnv : { ...bunEnv, Malloc: "1", ASAN_OPTIONS: "detect_leaks=0" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const expected = [];
  for (const ns of ["posix", "win32"])
    for (const name of ["join", "resolve", "relative", "basename"])
      for (let r = 0; r < 3; r++) expected.push(`${ns}.${name}[${r}]=OK`);
  expect({ lines: stdout.trim().split("\n"), stderr }).toEqual({ lines: expected, stderr: "" });
  expect(exitCode).toBe(0);
});

test.if(isWindows)("Bun.which skips PATH segments longer than the Windows wide-path buffer", async () => {
  // A single PATH segment longer than the fixed 32767-element wide-character
  // path buffer must be skipped instead of being transcoded into it, and the
  // remaining segments must still be searched. Run in a subprocess so the
  // assertion is on the child's output and exit code.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const dir = path.dirname(process.execPath);
const name = path.basename(process.execPath, ".exe");
const oversized = Buffer.alloc(70000, "a").toString();
console.log(Bun.which(name, { PATH: oversized }));
const found = Bun.which(name, { PATH: oversized + ";" + dir });
console.log(found !== null && path.basename(found).toLowerCase() === (name + ".exe").toLowerCase());`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  assert.strictEqual(stdout.split(/\r?\n/).filter(Boolean).join("\n"), "null\ntrue");
  assert.strictEqual(exitCode, 0);
});
