import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, realpathSync, statSync } from "fs";
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

  // Node.js reads ill-formed UTF-8 as U+FFFD. Bun read a stray byte as Latin-1: "\xA9" was "©".
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

    test("the runtime transpiler cache keeps one entry for it and uses it", async () => {
      // Over the 4 KiB cache minimum. The parser asks the cache after the first token (`0`), before it lexes the rest.
      const padded = Buffer.concat([Buffer.from("0;\n// " + Buffer.alloc(8 * 1024, "-").toString() + "\n"), source]);
      using dir = tempDir("cache-not-utf8", { "latin1.js": padded });
      const cacheDir = join(String(dir), "cache");
      const env = {
        ...bunEnv,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
        BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
      };
      const entries = () => readdirSync(cacheDir).map(name => [name, statSync(join(cacheDir, name)).mtimeMs]);
      const runs = [];
      for (let i = 0; i < 3; i++) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "latin1.js"],
          cwd: String(dir),
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        runs.push({ stdout, stderr, exitCode, entries: entries() });
      }
      const written = runs[0].entries;
      expect(written).toHaveLength(1);
      expect(runs).toEqual([0, 1, 2].map(() => ({ stdout: decoded, stderr: "", exitCode: 0, entries: written })));
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
