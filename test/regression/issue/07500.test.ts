// @known-failing-on-windows: 1 failing
import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";
test("7500 - Bun.stdin.text() doesn't read all data", async () => {
  const filename = join(tmpdir(), "bun.test.offset." + Date.now() + ".txt");
  const text = "contents of file to be read with several lines of text and lots and lots and lots and lots of bytes! "
    .repeat(1000)
    .repeat(9)
    .split(" ")
    .join("\n");
  await Bun.write(filename, text);
  const bunCommand = `${bunExe()} ${join(import.meta.dir, "7500-repro-fixture.js")}`;
  const shellCommand = `cat ${filename} | ${bunCommand}`;

  const cmd = process.platform === "win32" ? ["pwsh.exe", `-Command='${shellCommand}'`] : ["bash", "-c", shellCommand];
  const proc = Bun.spawnSync({
    cmd,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  const output = proc.stdout.toString().replaceAll("\r\n", "\n");
  if (output !== text) {
    expect(output).toHaveLength(text.length);
    throw new Error("Output didn't match!\n");
  }

  expect(proc.exitCode).toBe(0);
}, 100000);
