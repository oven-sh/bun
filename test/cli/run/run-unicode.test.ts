import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, bunRun, tempDir, textThatIsNotUtf8 } from "harness";
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

  test("importing text that is not UTF-8 works", async () => {
    const table = textThatIsNotUtf8(3);
    using dir = tempDir("run-text-not-utf8", {
      "table.txt": table.bytes,
      "entry.ts": `import text from "./table.txt"; process.stdout.write(JSON.stringify(text));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(table.linesThatDiffer(JSON.parse(stdout))).toEqual([]);
    expect(exitCode).toBe(0);
  });
});
