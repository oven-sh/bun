// Runs what the JSDoc in packages/bun-types/bun.d.ts says about runtime behavior.
// bun-types.test.ts type-checks the declarations. Nothing there executes an @example.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dtsPath = join(import.meta.dir, "..", "..", "..", "packages", "bun-types", "bun.d.ts");
const dts = readFileSync(dtsPath, "utf8");

/** The code in the `@example` fence of `export function <fn>` in `namespace <ns>`. */
function exampleOf(ns: string, fn: string): string {
  const namespace = dts.indexOf(`\n  namespace ${ns} {\n`);
  const declaration = namespace === -1 ? -1 : dts.indexOf(`\n    export function ${fn}(`, namespace);
  if (declaration === -1) throw new Error(`${dtsPath} does not declare ${ns}.${fn}`);

  const end = dts.lastIndexOf("*/", declaration);
  const jsdoc = dts.slice(dts.lastIndexOf("/**", end), end).replace(/^[ \t]*\* ?/gm, "");
  const fence = /^@example\n```\w*\n([\s\S]*?)\n```/m.exec(jsdoc);
  if (fence === null) throw new Error(`${dtsPath}: the JSDoc of ${ns}.${fn} has no @example fence`);
  return fence[1];
}

/** The `//` comment lines right after each `console.log(...);` are the output the example documents. */
function documentedOutput(example: string): string {
  const lines = example.split("\n");
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^console\.log\(.*\);$/.test(lines[i])) continue;
    while (lines[i + 1]?.startsWith("//")) output.push(lines[++i].replace(/^\/\/ ?/, ""));
  }
  return output.map(line => line + "\n").join("");
}

test.concurrent("the JSON5.stringify @example prints what its comments say", async () => {
  const example = exampleOf("JSON5", "stringify");
  const documented = documentedOutput(example);
  expect(documented).not.toBe("");

  using dir = tempDir("bun-types-jsdoc-example", { "example.ts": example });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "example.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe(documented);
  expect(exitCode).toBe(0);
});

// SpawnOptions.lazy: "Reading begins when you first read from the `stdout` or `stderr` stream [...]
// Accessing the property alone does not start it. Until reading begins, a child process that fills
// the operating system's pipe buffer blocks on its next write."
test.concurrent("SpawnOptions.lazy: reading begins at the first read, not at property access", async () => {
  // More than the pipe holds on any platform (macOS has the most, about 1 MiB).
  const SIZE = 4 * 1024 * 1024;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fs = require("fs");
      fs.writeSync(2, "started\\n");
      const chunk = Buffer.alloc(65536, 97);
      let written = 0;
      while (written < ${SIZE}) written += fs.writeSync(1, chunk, 0, Math.min(chunk.length, ${SIZE} - written));`,
    ],
    env: bunEnv,
    lazy: true,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout;

  // Wait until the child runs, so that the window below measures the pipe and not the startup of the child.
  const stderr = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("started\n")) {
    const { done, value } = await stderr.read();
    if (done) throw new Error(`the child closed stderr before it wrote "started": ${JSON.stringify(seen)}`);
    seen += decoder.decode(value, { stream: true });
  }
  stderr.releaseLock();

  // A reader that runs drains the pipe and the child exits in a few milliseconds.
  // Deadline-polled: the loop stops early if the child does exit.
  const deadline = Date.now() + 500;
  while (proc.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(proc.exitCode).toBeNull();

  expect((await stdout.text()).length).toBe(SIZE);
  expect(await proc.exited).toBe(0);
});
