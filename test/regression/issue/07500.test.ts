import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";
test("7500 - Bun.stdin.text() doesn't read all data", async () => {
  const filename = join(tmpdir(), "/bun.test.offset.txt");
  const text = "contents of file to be read with several lines of text and lots and lots and lots and lots of bytes! "
    .repeat(1000)
    .repeat(9)
    .split(" ")
    .join("\n");
  await Bun.write(filename, text);

  const bunCommand = `${bunExe()} ${join(import.meta.dir, "7500-repro-fixture.js")}`;
  const shellCommand = `cat ${filename} | ${bunCommand}`;
  const proc = Bun.spawnSync({
    cmd: ["bash", "-c", shellCommand],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  const output = proc.stdout.toString();
  expect(output).toBe(text);
  expect(proc.exitCode).toBe(0);
}, 100000);
