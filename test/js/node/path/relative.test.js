import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, nodeExeAtLeast, tempDir } from "harness";
import assert from "node:assert";
import path from "node:path";

// Pairs of win32 paths from a seed. A name has spellings that differ in case, and a path takes any of them.
function seededPairs(count) {
  let seed = 1;
  const random = below => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % below;
  };
  const pick = list => list[random(list.length)];
  const names = [
    ["é", "É"],
    ["ünï", "Ünï", "ÜNÏ"],
    ["å", "Å", "\u212B"],
    ["ф", "Ф"],
    ["ß", "ẞ", "SS"],
    ["i\u0307", "İ", "i", "I", "ı"],
    ["ⱥ", "Ⱥ"],
    ["k", "K", "\u212A"],
    ["ω", "Ω", "\u2126"],
    ["ας", "ΑΣ", "ασ"],
    ["σ", "Σ", "ς"],
    ["ασα", "ΑΣΑ", "αςα"],
    ["\u{10428}", "\u{10400}"],
    ["ǆ", "ǅ", "Ǆ"],
    ["a", "A"],
    ["ab", "AB", "aB"],
    ["😀"],
    ["日本"],
    [".."],
    [""],
  ];
  const roots = [
    ["C:\\", "c:\\", "C:/"],
    ["D:\\"],
    ["\\\\srv\\share\\", "\\\\SRV\\SHARE\\"],
    ["\\\\É\\share\\", "\\\\é\\SHARE\\"],
    ["\\\\İ\\x\\", "\\\\i\u0307\\x\\"],
    // win32.resolve takes the working directory for these, and on Windows its drive.
    ...(isWindows ? [] : [["\\", "/"], ["C:", "c:"], [""]]),
  ];
  const someNames = most => Array.from({ length: random(most + 1) }, () => pick(names));
  const spell = ([root, parts]) => {
    let spelled = pick(root);
    parts.forEach((name, at) => {
      spelled += pick(name) + (random(4) ? "" : pick(name));
      if (at + 1 < parts.length || !random(6)) spelled += random(8) ? "\\" : "/";
    });
    return spelled;
  };
  // Bun's win32.resolve is that of an earlier Node.js for the roots \\?\ and \\.\.
  const hasDeviceRoot = spelled => /^[\\/]{2}[.?]([\\/]|$)/.test(spelled);
  const pairs = [];
  while (pairs.length < count) {
    const from = [pick(roots), someNames(4)];
    // Another path, or the first parts of `from` and then other parts.
    const to = random(4)
      ? [from[0], [...from[1].slice(0, random(from[1].length + 1)), ...someNames(2)]]
      : [pick(roots), someNames(4)];
    const pair = [spell(from), spell(to)];
    if (!pair.some(hasDeviceRoot)) pairs.push(pair);
  }
  return pairs;
}

// `bun lint --run-path-tests` gives the function behind win32.relative the bytes of its arguments, as `bun lint` does
// for the paths that it compares. It is compiled into debug and canary builds only.
const hasPathRunner =
  isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

describe("path.relative", () => {
  test("general", () => {
    const failures = [];

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
          // Slash-rooted (no drive letter) inputs that hit the last_common_sep=Some(3) overshoot.
          // win32.resolve pulls a device root from cwd, so expected values only hold on a POSIX host.
          ...(isWindows
            ? []
            : [
                ["/x..", "/x.", ""],
                ["/xy.", "/xy", ""],
                ["/abc", "/ab", ""],
                ["\\x..", "\\x.", ""],
                ["\\ab.", "\\ab", ""],
                ["/xyz.", "/xy", ".."],
                ["/xyzw", "/xy", ".."],
                ["/abcde", "/ab", ".."],
                ["/x.", "/x..", "."],
              ]),
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
      test[1].forEach(test => {
        const actual = relative(test[0], test[1]);
        const expected = test[2];
        if (actual !== expected) {
          const os = relative === path.win32.relative ? "win32" : "posix";
          const message = `path.${os}.relative(${test
            .slice(0, 2)
            .map(JSON.stringify)
            .join(",")})\n  expect=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`;
          failures.push(`\n${message}`);
        }
      });
    });
    assert.strictEqual(failures.length, 0, failures.join(""));
  });

  // Node lowers both resolved paths with toLowerCase() and compares the results. The values are from Node v26.3.0.
  test("win32 compares every letter without case, as toLowerCase() does", () => {
    const rows = [
      // A letter outside of ASCII in another case.
      ["C:\\Ünï\\Wd", "C:\\ünï\\wd\\f.txt", "f.txt"],
      ["C:\\ünï\\d1", "C:\\Ünï", ".."],
      ["C:\\é", "C:\\É", ""],
      ["C:\\É", "C:\\é", ""],
      ["c:\\É", "C:\\é", ""],
      ["C:\\aéb", "C:\\AÉB", ""],
      ["C:\\é\\x", "C:\\É\\y", "..\\y"],
      ["C:\\É\\x", "C:\\é\\y", "..\\y"],
      ["C:\\a\\Å\\b", "C:\\A\\å\\c", "..\\c"],
      ["C:\\Ф", "C:\\ф", ""],
      ["C:\\ф\\x", "C:\\Ф\\y", "..\\y"],
      ["C:\\É", "C:\\É\\sub", "sub"],
      ["C:\\É\\sub", "C:\\é", ".."],
      ["C:\\", "C:\\É", "É"],
      ["C:\\é", "C:\\", ".."],
      ["C:\\É", "D:\\É", "D:\\É"],
      ["C:/É/x/../y", "c:\\é\\Y\\z", "z"],
      // An ASCII letter in another case in front of it.
      ["c:\\users\\Łukasz\\project", "C:\\Users\\Łukasz\\project\\src\\a.ts", "src\\a.ts"],
      ["c:\\Łukasz\\a", "C:\\ŁUKASZ\\b", "..\\b"],
      ["c:\\Łukasz\\src", "C:\\Łukasz\\SRC", ""],
      ["c:\\Łukasz\\src\\a", "C:\\Łukasz\\SRC", ".."],
      ["C:\\ABC\\é\\x", "c:\\abc\\É\\y", "..\\y"],
      ["C:\\Abc\\é", "C:\\aBC\\éf", "..\\éf"],
      ["C:\\AB\\é", "C:\\ab", ".."],
      ["C:\\AB\\é", "C:\\abc\\é", "..\\..\\abc\\é"],
      // One name is the start of the other.
      ["C:\\é", "C:\\éa", "..\\éa"],
      ["C:\\éa", "C:\\é", "..\\é"],
      ["C:\\a\\É", "C:\\a\\éé", "..\\éé"],
      ["C:\\a\\éé", "C:\\a\\É", "..\\É"],
      ["C:\\éa", "C:\\é\\x", "..\\é\\x"],
      ["C:\\é\\ab", "C:\\é\\a\\x", "..\\a\\x"],
      // Letters outside of the BMP.
      ["C:\\\u{10400}\\x", "C:\\\u{10428}\\y", "..\\y"],
      ["C:\\😀\\a", "C:\\😀\\b", "..\\b"],
      ["C:\\😀", "C:\\😀\\sub", "sub"],
      ["C:\\\u{10400}\\x", "C:\\\u{10401}\\y", "..\\..\\\u{10401}\\y"],
      ["C:\\\u{10400}a", "C:\\\u{10428}A\\y", "y"],
      // toLowerCase() is no case fold: ß stays ß.
      ["C:\\ß", "C:\\SS", "..\\SS"],
      ["C:\\ﬃ", "C:\\FFI", "..\\FFI"],
      ["C:\\ı", "C:\\I", "..\\I"],
      ["C:\\ſ", "C:\\S", "..\\S"],
      ["C:\\µ", "C:\\Μ", "..\\Μ"],
      // A letter in title case has a lower case.
      ["C:\\ǅ", "C:\\ǆ", ""],
      ["C:\\Ǆ\\a", "C:\\ǅ\\b", "..\\b"],
      ["C:\\ᾈ", "C:\\ᾀ", ""],
      // Σ at the end of a word is ς in lower case, and σ anywhere else.
      ["C:\\ΑΣ", "C:\\ας", ""],
      ["C:\\ΑΣ", "C:\\ασ", "..\\ασ"],
      ["C:\\ΑΣ\\x", "C:\\ας\\y", "..\\y"],
      ["C:\\ΑΣΑ", "C:\\ασα", ""],
      ["C:\\ΑΣΑ", "C:\\αςα", "..\\αςα"],
      ["C:\\Σ", "C:\\σ", ""],
      ["C:\\Σ", "C:\\ς", "..\\ς"],
      ["C:\\ΑΣ.", "C:\\ας.", ""],
      ["C:\\ΑΣ.b", "C:\\ασ.b", ""],
      ["C:\\ΑΣ\\x", "C:\\ασ\\y", "..\\..\\ασ\\y"],
      ["C:\\x\\ΑΣ\\a", "C:\\x\\ας\\b", "..\\b"],
      ["C:\\x\\ΑΣ\\a", "C:\\x\\ασ\\b", "..\\..\\ασ\\b"],
      ["C:\\aΣ", "C:\\aς", ""],
      ["C:\\'Σ", "C:\\'σ", ""],
      ["C:\\ΑΣ'Α", "C:\\ασ'α", ""],
      ["C:\\ΑΣ\u0301", "C:\\ας\u0301", ""],
      ["C:\\x\\ΑΣ", "C:\\x\\ΑΣΑ", "..\\ΑΣΑ"],
      ["C:\\x\\ΑΣ\\y", "C:\\x\\ΑΣΑ\\y", "..\\..\\ΑΣΑ\\y"],
      ["C:\\Σ1\\x", "C:\\Σ2\\y", "..\\..\\Σ2\\y"],
      // The lower case is shorter or longer in UTF-8, and as long in UTF-16.
      ["C:\\\u212A\\x", "C:\\k\\y", "..\\y"],
      ["C:\\\u212B\\x", "C:\\å\\y", "..\\y"],
      ["C:\\\u2126", "C:\\ω\\sub", "sub"],
      ["C:\\Ⱥ\\x", "C:\\ⱥ\\y", "..\\y"],
      ["C:\\Ⱥ", "C:\\ⱥ", ""],
      ["C:\\Ⱦ\\a\\b", "C:\\ⱦ", "..\\.."],
      ["C:\\ẞ", "C:\\ß\\Ⱥ", "Ⱥ"],
      ["C:\\ẞ\\Ⱥ", "C:\\ẞ\\Ⱥx", "..\\Ⱥx"],
      ["C:\\ẞ\\Ⱥ\\a", "C:\\ß\\ⱥ\\b", "..\\b"],
      // The lower case of İ (U+0130) is i and U+0307: longer in UTF-16 too.
      ["C:\\İ\\a", "C:\\i\u0307\\a\\b", "b"],
      ["C:\\İ\\x", "C:\\İ\\y", "..\\y"],
      ["C:\\İ\\x", "C:\\i\u0307\\y", "..\\y"],
      ["C:\\İ", "C:\\İ\\sub", "sub"],
      ["C:\\İ\\sub", "C:\\İ", ".."],
      ["C:\\İ\\a", "C:\\i\u0307", ".."],
      ["C:\\a\\İ\\b\\c", "C:\\a\\İ\\x", "..\\..\\x"],
      ["C:\\a\\İ", "C:\\a\\İb", "..\\İb"],
      ["C:\\a\\İb", "C:\\a\\İ", "..\\İ"],
      ["C:\\İ", "C:\\", ".."],
      ["C:\\", "C:\\İ\\a", "İ\\a"],
      ["C:\\İ", "D:\\x", "D:\\x"],
      ["c:\\İ\\a", "C:\\İ\\A\\b", "b"],
      ["c:\\İ\\a\\c", "C:\\İ\\A\\b", "..\\b"],
      ["c:\\Łukasz\\a", "C:\\Łukasz\\A\\İ", "İ"],
      ["C:\\İa\\x", "C:\\İb\\y", "..\\..\\İb\\y"],
      ["C:\\İ\\x", "C:\\I\\y", "..\\..\\I\\y"],
      ["C:\\İ\\x", "C:\\i\\y", "..\\..\\i\\y"],
      ["C:\\İ\u0307\\x", "C:\\i\u0307\u0307\\y", "..\\y"],
      // And a Σ in such a path.
      ["C:\\i\u0307ας\\x", "C:\\İΑΣ\\y", "..\\y"],
      ["C:\\İ\\ΑΣ\\x", "C:\\i\u0307\\ας\\y", "..\\y"],
      ["C:\\İ\\ΑΣ", "C:\\i\u0307\\ασ", "..\\ασ"],
      // UNC paths.
      ["\\\\É\\bar\\a", "\\\\É\\bar\\b", "..\\b"],
      ["\\\\É\\bar", "\\\\é\\BAR\\x", "x"],
      ["\\\\É\\share\\a", "\\\\é\\SHARE", ".."],
      ["\\\\É\\share", "\\\\é\\SHARE", ""],
      ["\\\\foo\\É", "\\\\foo\\baz", "..\\baz"],
      ["\\\\foo\\É\\a", "\\\\foo\\é\\b", "..\\b"],
      ["\\\\É\\bar", "\\\\baz\\qux", "\\\\baz\\qux\\"],
      ["\\\\É\\bar\\a", "\\\\baz\\qux\\b", "\\\\baz\\qux\\b"],
      ["\\\\É\\bar\\a", "\\\\é\\qux\\b", "..\\..\\qux\\b"],
      ["\\\\É\\bar", "C:\\x", "C:\\x"],
      ["C:\\É", "\\\\C:\\É", "..\\É"],
      ["C:\\É", "\\\\srv\\share\\é\\x", "\\\\srv\\share\\é\\x"],
      ["\\\\srv\\share\\éa", "\\\\srv\\share\\é\\x", "..\\é\\x"],
      ["\\\\Éa\\bar\\x", "\\\\Éb\\bar\\y", "\\\\Éb\\bar\\y"],
      ["\\\\É\\bar\\x", "\\\\Éb\\bar\\y", "\\\\Éb\\bar\\y"],
      ["\\\\srv\\É\\x", "\\\\srw\\É\\y", "\\\\srw\\É\\y"],
      ["\\\\SRV\\Share\\é\\a", "\\\\srv\\share\\É\\b", "..\\b"],
      ["\\\\SRV\\Share\\é", "\\\\srv\\share\\é\\b", "b"],
      ["\\\\😀Σ\\bar", "\\\\baz\\qux", "\\\\baz\\qux\\"],
      ["\\\\\u{10400}Σ\\bar\\a", "\\\\baz\\qux\\b", "\\\\baz\\qux\\b"],
      ["\\\\Σa\\bar", "\\\\σb\\qux", "\\\\σb\\qux\\"],
      ["\\\\aΣ\\bar", "\\\\aς\\qux", "..\\qux"],
      // With İ in one of the paths Node compares part by part, and two UNC paths have their first two parts in common.
      ["\\\\İ\\bar", "\\\\baz\\qux", "..\\..\\baz\\qux"],
      ["\\\\foo\\İ", "\\\\baz\\qux", "..\\..\\baz\\qux"],
      ["\\\\baz\\qux", "\\\\foo\\İ", "..\\..\\foo\\İ"],
      ["\\\\İ\\bar\\a", "\\\\baz\\qux\\b", "..\\..\\..\\baz\\qux\\b"],
      ["\\\\İ\\bar\\a", "\\\\i\u0307\\BAR\\b", "..\\b"],
      ["\\\\İ\\bar", "\\\\i\u0307\\bar\\a\\b", "a\\b"],
      ["\\\\İ\\bar\\a\\b", "\\\\i\u0307\\bar", "..\\.."],
      ["\\\\İ\\bar", "\\\\i\u0307\\bar", ""],
      ["C:\\İ", "\\\\foo\\bar", "\\\\foo\\bar\\"],
      ["\\\\foo\\bar", "C:\\İ", "C:\\İ"],
      ["\\\\İa\\bar\\x", "\\\\İb\\bar\\y", "..\\..\\..\\İb\\bar\\y"],
      ["\\\\İ\\bar\\a", "\\\\İ\\bar\\b", "..\\b"],
      ["\\\\İ\\bar\\a", "\\\\İ\\qux\\b", "..\\..\\qux\\b"],
      ["\\\\srv\\share\\İ\\a", "\\\\srv\\share\\i\u0307\\b", "..\\b"],
      ["\\\\SRV\\Share\\İ\\a", "\\\\srv\\share\\i\u0307\\b", "..\\b"],
      ["\\\\İΣ\\bar", "\\\\baz\\qux", "..\\..\\baz\\qux"],
      // A NUL ends nothing.
      ["C:\\é\0a", "C:\\é\0b", "..\\é\0b"],
      ["C:\\a\0é", "C:\\A\0É\\b", "b"],
      ["C:\\a\0b", "C:\\A\0B", ""],
      ["C:\\a\0b", "C:\\a\0c", "..\\a\0c"],
      ["C:\\a\0b", "C:\\A\0B\\c", "c"],
      ["C:\\e\0a\\x", "C:\\E\0b\\y", "..\\..\\E\0b\\y"],
      // win32.resolve takes the drive of the working directory for these, so the values hold where it has none.
      ...(isWindows
        ? []
        : [
            ["/É", "/é", ""],
            ["/É/a", "/é/b", "..\\b"],
            ["\\É\\share", "\\\\É\\share", "..\\share"],
            ["\\\\É\\share", "\\É\\share", "..\\share"],
            ["\\\\É", "\\\\É\\share", "share\\"],
            ["/ΑΣ", "/ΑΣΑ", "\\ΑΣΑ"],
            ["/İ", "/i\u0307\\a", "a"],
            ["/İ\\a", "/b", "..\\..\\b"],
            ["/a", "/İ", "..\\İ"],
            ["/", "//É/share/x", "É\\share\\x"],
            ["/", "//İ/share/x", "\\İ\\share\\x"],
            ["/c\\É", "/C\\é\\x", "x"],
            ["/\u212A\\é", "/k\\É\\x", "x"],
            ["/İ", "/İa", "..\\İa"],
            // Node counts UTF-16 code units: é is one, and no device root. 😀 is two.
            ["/é", "/éa", "..éa"],
            ["\\é", "\\éa", "..éa"],
            ["/éa", "/é", "..é"],
            ["/É", "/éa", "..éa"],
            ["/É", "/É.", "..É."],
            ["/😀", "/😀a", "a"],
            ["/😀a", "/😀", ""],
            ["/éa", "//éab/share", "b\\share\\"],
            ["/😀ab", "/😀", ".."],
            ["/xyé\\a", "/xy", ".."],
            ["/xy😀", "/xy", ".."],
            ["/xyé", "/xy", ""],
          ]),
    ];
    expect(rows.map(([from, to]) => [from, to, path.win32.relative(from, to)])).toEqual(rows);
  });

  // The two operands are ASCII and the working directory is not: the lower case of K (U+212A) is "k".
  test.concurrent("win32 compares what the working directory adds to a path without case", async () => {
    using dir = tempDir("path-relative", { "\u212A": {} });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(require("node:path").win32.relative(".", "../k/x"))`],
      env: bunEnv,
      cwd: path.join(String(dir), "\u212A"),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "x\n", stderr: "", exitCode: 0 });
  });

  // Node.js v22.7.0 is the first that compares part by part when a lower case is longer (nodejs/node#53991).
  const node = nodeExeAtLeast("22.7.0");
  test.concurrent.skipIf(!node)("win32 answers what Node.js answers for pairs of paths from a seed", async () => {
    const pairs = seededPairs(3000);
    using dir = tempDir("path-relative-seeded", { "\u212A": { "pairs.json": JSON.stringify(pairs) } });
    const script = `const pairs = JSON.parse(require("node:fs").readFileSync("pairs.json", "utf8"));
      console.log(JSON.stringify(pairs.map(([from, to]) => require("node:path").win32.relative(from, to))));`;
    const run = async exe => {
      await using proc = Bun.spawn({
        cmd: [exe, "-e", script],
        env: bunEnv,
        cwd: path.join(String(dir), "\u212A"),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const [ofBun, ofNode] = await Promise.all([run(bunExe()), run(node)]);
    expect({ stderr: ofBun.stderr, exitCode: ofBun.exitCode, exitCodeOfNode: ofNode.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
      exitCodeOfNode: 0,
    });
    const [answers, answersOfNode] = [JSON.parse(ofBun.stdout), JSON.parse(ofNode.stdout)];
    const different = pairs
      .map(([from, to], at) => ({ from, to, bun: answers[at], node: answersOfNode[at] }))
      .filter(row => row.bun !== row.node);
    expect({ count: different.length, first: different.slice(0, 5) }).toEqual({ count: 0, first: [] });
  });

  // The answers of `bun lint` have "/" for "\".
  test.concurrent.skipIf(!hasPathRunner)("win32 compares the paths of bun lint without case too", async () => {
    using dir = tempDir("path-relative-lint", {});
    const rows = [
      ["C:/Ünï/Wd", "C:/ünï/wd/f.txt", "f.txt"],
      ["//sérver/share/a", "//SÉRVER/share/a/b.js", "b.js"],
      ["C:/İ/a", "C:/i\u0307/a/b", "b"],
    ];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lint", "--run-path-tests", "windows", ...rows.flatMap(([from, to]) => ["relative", from, to])],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ answers: stdout.split("\n").slice(0, -1), stderr, exitCode }).toEqual({
      answers: rows.map(row => row[2]),
      stderr: "",
      exitCode: 0,
    });
  });

  // A byte that is in no sequence of UTF-8 is a character of its own, in no case. No string has such a byte: a path of
  // `bun lint` and the working directory can.
  test.concurrent.skipIf(!hasPathRunner || !isLinux)(
    "win32 compares bytes that are not UTF-8 as they are",
    async () => {
      using dir = tempDir("path-relative-bytes", {});
      // [from, to, answer] in Latin-1: one character is one byte.
      const rows = [
        // The same byte in both paths, behind a letter in another case.
        ["C:/\xc3\x89/\xff/a", "C:/\xc3\xa9/\xff/b", "../b"],
        // Another byte, U+FFFD and a letter of Latin-1 are other characters.
        ["C:/\xc3\x89/\xff/a", "C:/\xc3\xa9/\xfe/b", "../../\xfe/b"],
        ["C:/\xc3\x89/\xff/a", "C:/\xc3\xa9/\xef\xbf\xbd/b", "../../\xef\xbf\xbd/b"],
        ["C:/\xc3\x89/\xc9/a", "C:/\xc3\xa9/\xe9/b", "../../\xe9/b"],
        // A sequence that is cut, and half of a surrogate pair.
        ["C:/\xc3\x89/\xf0\x9f\x98/a", "C:/\xc3\xa9/\xf0\x9f\x98/b/c", "../b/c"],
        ["C:/\xc3\x89/\xed\xa0\x80/a", "C:/\xc3\xa9/\xed\xa0\x81/b", "../../\xed\xa0\x81/b"],
        ["C:/\xc3\x89/\x80/a", "C:/\xc3\xa9/\xed\xb2\x80/b", "../../\xed\xb2\x80/b"],
        // With İ, where Node compares part by part.
        ["C:/\xc4\xb0/\xff/a", "C:/i\xcc\x87/\xff/b", "../b"],
        ["C:/\xc4\xb0/\xff/a", "C:/i\xcc\x87/\xfe/b", "../../\xfe/b"],
        // With Σ, whose lower case is ς at the end of a word: such a byte ends the word.
        ["C:/\xce\x91\xce\xa3\xff\xce\x91/a", "C:/\xce\xb1\xcf\x82\xff\xce\xb1/b", "../b"],
        ["C:/\xc3\x89/\xff\xce\x91\xce\xa3/a", "C:/\xc3\xa9/\xff\xce\xb1\xcf\x82/b", "../b"],
        // UNC paths.
        ["//\xc3\x89/\xff/a", "//\xc3\xa9/\xff/b", "../b"],
        ["//srv/\xff/a", "//srv/\xfe/a", "../../\xfe/a"],
      ];
      const octal = bytes => bytes.replace(/[^\x20-\x7e]/g, byte => "\\" + byte.charCodeAt(0).toString(8));
      const args = rows.map(([from, to]) => `relative "$(printf '${octal(from)}')" "$(printf '${octal(to)}')"`);
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `exec "$0" lint --run-path-tests windows ${args.join(" ")}`, bunExe()],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      const answers = Buffer.from(stdout).toString("latin1").split("\n");
      expect(rows.map(([from, to], at) => [from, to, answers[at]])).toEqual(rows);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    },
  );

  test("very long paths", () => {
    // Regression test: buffer overflow with very long paths
    // This used to panic because the buffer didn't account for the null terminator
    const longPath1 = "/home/" + "a".repeat(50000);
    const longPath2 = "/home/" + "b".repeat(50000);
    const result = path.relative(longPath1, longPath2);
    // Should return something like "../bbb...bbb"
    assert.ok(result.startsWith(".."));
    assert.ok(result.includes("b"));
  });

  test("very long win32 paths with a letter outside of ASCII", () => {
    const long = Buffer.alloc(50000, "a").toString();
    expect([
      path.win32.relative(`C:\\É${long}\\x`, `C:\\é${long}\\y`),
      // The folder that both are in is not compared.
      path.win32.relative(`C:\\${long}\\É`, `C:\\${long}\\é\\b`),
      // Σ has its lower case from the characters around it.
      path.win32.relative(`C:\\Σ${long}\\x`, `C:\\σ${long}\\y`),
      // With an İ Node compares part by part.
      path.win32.relative(`C:\\İ${long}\\x`, `C:\\i\u0307${long}\\y`),
    ]).toEqual(["..\\y", "b", "..\\y", "..\\y"]);
  });
});
