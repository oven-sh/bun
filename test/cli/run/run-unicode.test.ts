import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe.concurrent("run-unicode", () => {
  // Windows argv is UTF-16, so an argument cannot carry an invalid byte there.
  test.skipIf(isWindows)("the script echo line is valid UTF-8 when a pass-through argument is not", async () => {
    using dir = tempDir("run-invalid-utf8-arg", {
      "package.json": JSON.stringify({ name: "run-invalid-utf8-arg", scripts: { p: "echo hi" } }),
    });
    // A JS string cannot put a lone 0xFF into argv, so let sh build the argument.
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", 'exec "$0" run p -- "a$(printf "\\377")b"', bunExe()],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.bytes(), proc.exited]);
    // The argument itself still reaches the script byte for byte.
    expect(Buffer.from(stdout)).toEqual(Buffer.concat([Buffer.from("hi a"), Buffer.from([0xff]), Buffer.from("b\n")]));
    // The `$ <script>` diagnostic replaces the invalid byte instead of copying it out.
    expect(Buffer.from(stderr)).toEqual(Buffer.from("$ echo hi a\uFFFDb\n"));
    expect(exitCode).toBe(0);
  });

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
});
