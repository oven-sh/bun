// Since ecosystem tests can be flaky, this file is responsible for running the tests
// in the `ecosystem` directory and figuring out if things are broken or not.

import { spawnSync, Glob } from "bun";
import { join } from "node:path";
import { EOL } from "node:os";
import { bunEnv, bunExe } from "harness";

const cwd = join(import.meta.dir, "ecosystem");
const [...patterns] = process.argv.slice(2);
const globs = patterns.length ? patterns.map(pattern => new Glob(pattern)) : [new Glob("**/*.test.ts")];
const files = globs.flatMap(glob => [...glob.scanSync({ cwd })]);

if (!files.length) {
  throw "No tests found";
}

for (const file of files) {
  runTest(file);
}

function runTest(file: string) {
  const { exitCode, stderr } = spawnSync({
    cwd,
    cmd: [bunExe(), "test", file],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  const buffer: string[] = [];
  const names: Set<string> = new Set();
  const results: { type: string; name: string; logs: string }[] = [];

  for (const line of stderr.toString().split(EOL)) {
    const text = stripAnsi(line);

    let type: string | undefined;
    if (text.startsWith("(pass)") || text.startsWith("✓")) {
      type = "pass";
    } else if (text.startsWith("(fail)") || text.startsWith("✖")) {
      type = "fail";
    } else if (text.startsWith("(todo)") || text.startsWith("✏")) {
      type = "todo";
    } else if (text.startsWith("(skip)") || text.startsWith("⏩")) {
      type = "skip";
    } else if (!text.startsWith("minimalloc:")) {
      buffer.push(line);
    }

    if (type) {
      const eol = text.lastIndexOf("[");
      const name = text.substring(7, eol ? eol - 1 : undefined);
      if (names.has(name)) {
        continue;
      }
      names.add(name);
      results.push({
        type,
        name,
        logs: buffer.join("\n"),
      });
      buffer.length = 0;
    }
  }

  if (results.length === 1 && results[0].type === "todo") {
    return;
  }

  let summary = "";
  for (const { type, name } of results.sort((a, b) => a.type.localeCompare(b.type))) {
    summary += `(${type}) ${name}\n`;
  }

  console.log(file, summary);
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[\d+m/g, "");
}
