import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { sep } from "node:path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe.if(isPosix)("IOWriter epipe", () => {
  TestBuilder.command`yes | head`
    .exitCode(0)
    .stdout("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n")
    .runAsTest("builtin pipe to command");

  test("concurrent", async () => {
    const promises = Array(100)
      .fill(0)
      .map(() => Bun.$`yes | head`.text());

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result).toBe("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n");
    }
  });
});

// These builtins queue several chunks and wait for each of them to complete or fail: `ls` and `rm` one
// per operand or directory, `mkdir` one per page of lines.
describe.concurrent("a pipeline stage whose reader exits without reading", () => {
  const names = Array.from({ length: 64 }, (_, i) => `entry${i}`);
  const operands = names.join(" ");
  const dirs = Object.fromEntries(names.map(name => [name, {}]));

  test.each([
    ["ls -d", `ls -d ${operands} | true`, dirs],
    ["ls -R", `ls -R . | true`, dirs],
    ["rm -rv", `rm -rv ${operands} | true`, dirs],
    ["mkdir -v", `mkdir -v ${operands} | true`, {}],
  ])("%s", async (_, pipeline, files) => {
    using dir = tempDir("shell-epipe-stage", files);
    const { stdout, exitCode } = await $`${{ raw: pipeline }}`.cwd(String(dir)).quiet().nothrow();
    expect({ stdout: stdout.toString(), exitCode }).toEqual({ stdout: "", exitCode: 0 });
  });

  // Every second operand fails, and the lines of the others fill several pages. The error lines go to
  // stderr in operand order while the chunks for stdout fail.
  test("mkdir -v of several pages with failing operands", async () => {
    using dir = tempDir("shell-epipe-stage", {});
    const operands = Array.from({ length: 600 }, (_, i) => (i % 2 ? `missing/entry${i}` : `entry${i}`));
    const { stdout, stderr, exitCode } = await $`${{ raw: `mkdir -v ${operands.join(" ")} | true` }}`
      .cwd(String(dir))
      .quiet()
      .nothrow();
    expect({
      stdout: stdout.toString(),
      stderr: stderr.toString().replaceAll(String(dir) + sep, ""),
      exitCode,
    }).toEqual({
      stdout: "",
      stderr: operands
        .filter((_, i) => i % 2)
        .map(name => `mkdir: ${name.replaceAll("/", sep)}: No such file or directory\n`)
        .join(""),
      exitCode: 0,
    });
  });

  // These two finish at their first failed chunk, with more chunks queued behind it.
  test.if(isPosix).each([
    ["builtin cat", "await $`head -c 1048576 /dev/zero | cat | true`.quiet();"],
    [
      "relayed subprocess output",
      `const { writeSync } = require("node:fs");
       // The parent closes the read end of stdout right after the spawn.
       while (true) {
         try {
           writeSync(1, "still has a reader\\n");
         } catch (e) {
           if (e.code === "EPIPE") break;
           if (e.code !== "EAGAIN") throw e;
         }
         await Bun.sleep(1);
       }
       for (let run = 0; run < 10; run++) await $\`head -c 1048576 /dev/zero\`;`,
    ],
  ])("%s", async (_, script) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const { $ } = Bun; $.nothrow(); ${script} console.error("settled");`],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.stdout.cancel();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "settled\n", exitCode: 0 });
  });
});
