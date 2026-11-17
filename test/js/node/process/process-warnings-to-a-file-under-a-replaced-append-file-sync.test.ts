// A warning that NODE_REDIRECT_WARNINGS sends to a file reaches the file whatever a program has stored in fs.appendFileSync, as in node.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("a replaced fs.appendFileSync is not called for a warning", async () => {
  using directory = tempDir("warnings-to-a-file", {});
  const file = join(String(directory), "warnings.txt");
  const program = `
    let calls = 0;
    require("node:fs").appendFileSync = function () { calls++; };
    process.emitWarning("the kettle is dry", "KettleWarning");
    setTimeout(() => console.log(calls), 50);
  `;
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", program],
    env: { ...bunEnv, NODE_REDIRECT_WARNINGS: file },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
  expect(readFileSync(file, "utf8")).toContain("KettleWarning: the kettle is dry");
});
