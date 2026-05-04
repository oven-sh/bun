import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
it("should log to console correctly", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-timeLog.js")],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  const outText = await stderr.text();
  const expectedText = (await file(join(import.meta.dir, "console-timeLog.expected.txt")).text()).replaceAll(
    "\r\n",
    "\n",
  );

  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
});

// https://github.com/oven-sh/bun/issues/30017 — console.timeEnd()/timeLog()
// must apply console.group() indentation per the WHATWG Console spec.
it("console.timeEnd / timeLog respect console.group indentation", async () => {
  const src = `
    console.time("top");
    console.timeEnd("top");

    console.group("a");
    console.time("t1");
    console.timeEnd("t1");
    console.group("b");
    console.time("t2");
    console.timeLog("t2", "msg");
    console.timeLog("t2", { x: 1, y: 2 });
    console.timeEnd("t2");
    console.groupEnd();
    console.groupEnd();
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Group labels go to stdout; timer output goes to stderr.
  expect(stdout.replaceAll("\r\n", "\n")).toBe("a\n  b\n");
  // Strip the elapsed-time prefix so the stderr check focuses on indentation.
  const normalized = stderr.replaceAll("\r\n", "\n").replace(/\[.+?m?s\] /g, "");
  expect(normalized).toBe(
    [
      "top", // no group → no indent
      "  t1", // inside one group → 2 spaces
      "    t2 msg", // inside nested group → 4 spaces
      "    t2 {", // multi-line object opens at nested indent
      "      x: 1,", // inner fields indented by group depth + object depth
      "      y: 2,",
      "    }",
      "    t2",
      "",
    ].join("\n"),
  );
  // Assert the exit code last for more useful failure diagnostics.
  expect(exitCode).toBe(0);
});
