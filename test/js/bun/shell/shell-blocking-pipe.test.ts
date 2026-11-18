import { $, generateHeapSnapshot } from "bun";

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// We skip this test on Windows becasue:
// 1. Windows didn't have this problem to begin with
// 2. We need system cat.
test.skipIf(isWindows)("writing > send buffer size doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const massiveComamnd = "echo " + expected + " | " + Bun.which("cat");
  const pendingResult = $`${{
    raw: massiveComamnd,
  }}`.text();

  // Ensure that heap snapshot works, to excercise the memoryCost & estimated fields.
  generateHeapSnapshot("v8");

  const result = await pendingResult;

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

test.skipIf(isWindows)("writing > send buffer size (with a variable) doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const result = await $`echo ${expected} | ${Bun.which("cat")}`.text();

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

test("builtins that wait for their input do not hold up file calls", async () => {
  using dir = tempDir("shell-waiting-builtins", {
    "file.txt": "read",
    "producer.js": `
      require("fs").writeFileSync("started-" + process.argv[2], "");
      while (!require("fs").existsSync("go")) Bun.sleepSync(1);
      console.log(process.argv[2]);
    `,
    "main.js": `
      const fs = require("fs");
      const pipelines = Array.from({ length: 8 }, (_, i) => Bun.$\`\${process.execPath} producer.js \${i} | cat | cat\`.text());
      while (fs.readdirSync(".").filter(name => name.startsWith("started-")).length < 8) await Bun.sleep(1);
      console.log(await Bun.file("file.txt").text());
      fs.writeFileSync("go", "");
      console.log((await Promise.all(pipelines)).join(""));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "read\n0\n1\n2\n3\n4\n5\n6\n7\n\n", stderr: "", exitCode: 0 });
});
