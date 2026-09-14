import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe.concurrent("run-unicode", () => {
  test("running a weird filename works", async () => {
    const troll = process.platform == "win32" ? "💥'​\\" : "💥'\"​\n";
    const dir = join(realpathSync(tmpdir()), "bun-run-test" + troll);
    mkdirSync(dir, { recursive: true });
    console.log("dir", dir);
    // i this it's possible that the filesystem rejects the path
    await Bun.write(join(dir, troll + ".js"), "console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, troll + ".js")],
      cwd: dir,
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test("ts enum with utf16 works", async () => {
    const result = await bunRun(join(import.meta.dir, "ts-enum-fixture.ts"));
    expect(result).toSpawn(`{
  "1": "aaaa\u5FEB\u00E9\u00E9",
  "123": "bbb",
  "\u5B89\u5168\u4E32\u884C": "\u5B89\u5168\u4E32\u884C",
  aaa: "\u5E73\u8861\u4E32\u884C",
  "aa\u90ED": "\u5FEB\u901F\u4E32\u884C",
  "\u5B89\u5168\u5E76\u884C": "\u5B89\u5168\u5E76\u884C",
  "\u5E73\u8861\u5E76\u884C": "\u5E73\u8861\u5E76\u884C",
  "\u5FEB\u901F\u5E76\u884C": "\u5FEB\u901F\u5E76\u884C",
  "aaaa\u5FEB\u00E9\u00E9": 1,
  "Fran\u00E7ais": 123,
  bbb: 123,
}`);
  });

  // Node.js decodes a module as UTF-8 and turns each ill-formed sequence into
  // U+FFFD before it parses. Bun read a byte that cannot start a sequence as
  // Latin-1, so "\xA9" was "©" and `v\xFB` was an identifier.
  describe("a source file that is not UTF-8", () => {
    const latin1 = (s: string) => Buffer.from(s, "latin1");
    const source = latin1(
      [
        "/*! (c) Soci\xE9t\xE9 */",
        "console.log(JSON.stringify([",
        '  "s\xA9 caf\xE9", `t\xFB caf\xE9`, { "k\xA9": 1 }, "p\xE2\x82q", "s\xED\xA0\x80",',
        '  /^r\xA9$/.test("r\\uFFFD"), /^r\xA9$/.test("r\\u00A9"),',
        "]));",
        "",
      ].join("\n"),
    );
    const decoded =
      '["s\uFFFD caf\uFFFD","t\uFFFD caf\uFFFD",{"k\uFFFD":1},"p\uFFFDq","s\uFFFD\uFFFD\uFFFD",true,false]\n';

    test("runs with the text Node.js sees", async () => {
      using dir = tempDir("run-not-utf8", { "latin1.js": source });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "latin1.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: decoded, stderr: "", exitCode: 0 });
    });

    test("bun build --no-bundle writes valid UTF-8", async () => {
      using dir = tempDir("transpile-not-utf8", { "latin1.js": source });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", "latin1.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
      expect(text).toContain("/*! (c) Soci\uFFFDt\uFFFD */");
      expect(text).toContain("/^r\uFFFD$/");
      expect(exitCode).toBe(0);
    });

    test("a byte that is a letter in Latin-1 does not start an identifier", async () => {
      using dir = tempDir("ident-not-utf8", { "latin1.js": latin1("const v\xFB0 = 1;\nconsole.log(v\xFB0);\n") });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "latin1.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(stderr).toContain('Expected ";" but found "\uFFFD"');
      expect(exitCode).toBe(1);
    });
  });
});
