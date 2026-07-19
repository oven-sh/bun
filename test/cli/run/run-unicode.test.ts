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

  test("ts enum with utf16 works", () => {
    const result = bunRun(join(import.meta.dir, "ts-enum-fixture.ts"));
    expect(result.stdout).toBe(`{
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

  test("runs UTF-16BE source with a BOM", async () => {
    using dir = tempDir("run-utf16be", {
      "index.js": Buffer.from("\uFEFFconsole.log('utf16be')", "utf16le").swap16(),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("utf16be\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
