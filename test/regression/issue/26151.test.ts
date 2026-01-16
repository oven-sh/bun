import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

function runConsoleScript(name: string, code: string) {
  const dir = tempDirWithFiles(name, {
    "index.js": code,
  });
  const result = Bun.spawnSync([bunExe(), join(dir, "index.js")], {
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  return result;
}

const cases = [
  {
    name: "console.log",
    dir: "console-log-empty",
    code: `console.log("foo"); console.log(); console.log("bar");`,
    stdout: "foo\n\nbar\n",
    stderr: "",
  },
  {
    name: "console.info",
    dir: "console-info-empty",
    code: `console.info("foo"); console.info(); console.info("bar");`,
    stdout: "foo\n\nbar\n",
    stderr: "",
  },
  {
    name: "console.debug",
    dir: "console-debug-empty",
    code: `console.debug("foo"); console.debug(); console.debug("bar");`,
    stdout: "foo\n\nbar\n",
    stderr: "",
  },
  {
    name: "console.warn",
    dir: "console-warn-empty",
    code: `console.warn("foo"); console.warn(); console.warn("bar");`,
    stdout: "",
    stderr: "foo\n\nbar\n",
  },
  {
    name: "console.error",
    dir: "console-error-empty",
    code: `console.error("foo"); console.error(); console.error("bar");`,
    stdout: "",
    stderr: "foo\n\nbar\n",
  },
];

for (const { name, dir, code, stdout, stderr } of cases) {
  test(`${name}() with no args prints a blank line`, () => {
    const result = runConsoleScript(dir, code);
    expect(result.stdout.toString("utf8")).toBe(stdout);
    expect(result.stderr.toString("utf8")).toBe(stderr);
    expect(result.exitCode).toBe(0);
  });
}
