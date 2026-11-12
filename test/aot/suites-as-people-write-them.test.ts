// Projects of test files as people write them: hooks, tables, mocks, spies, snapshots, fake timers, decorators, barrels. Each runs under `bun test` and under `bun test --aot`, and all of them once as one
// project: what each test answers, what is printed, the exit code and the snapshots that are written must be the same.
// suites-as-people-write-them/*.txt: "=== name" begins a project, "+++ path" a file of it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

type Project = Record<string, string>;
const projects = new Map<string, Project>();
const folder = join(import.meta.dir, "suites-as-people-write-them");
for (const name of readdirSync(folder).sort()) {
  for (const block of readFileSync(join(folder, name), "utf8").split(/^=== /m).slice(1)) {
    const [head, ...parts] = block.split(/^\+\+\+ /m);
    const files: Project = { "package.json": `{ "name": "${head.trim()}", "private": true }\n` };
    for (const part of parts) {
      const end = part.indexOf("\n");
      files[part.slice(0, end).trim()] = part.slice(end + 1);
    }
    projects.set(head.trim(), files);
  }
}

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: "0", REPL_ID: undefined };
async function run(files: Project, flags: string[]) {
  using dir = tempDir("suites-as-people-write-them", files);
  const { stdout, stderr, exitCode } = await spawned([bunExe(), "test", ...flags], String(dir), env);
  const results = stderr
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
    .map(line => line.replace(/ ?\[[\d.]+ ?m?s\]/, "").trimEnd());
  const snapshots: Record<string, string> = {};
  for (const path in files) {
    const written = join(path, "..", "__snapshots__", path.split("/").at(-1) + ".snap");
    if (existsSync(join(String(dir), written))) snapshots[written] = readFileSync(join(String(dir), written), "utf8");
    if (/[._](test|spec)\.\w+$/.test(path)) snapshots[path] = readFileSync(join(String(dir), path), "utf8");
  }
  return {
    results,
    stdout: stdout.replace(/^bun test v.*\n/, "").replaceAll(String(dir), "<dir>"),
    exitCode,
    snapshots,
  };
}
async function compare(files: Project) {
  const [plain, compiled] = await Promise.all([run(files, []), run(files, ["--aot"])]);
  expect(plain.results.length).toBeGreaterThan(0);
  expect(compiled).toEqual(plain);
}

describe.skipIf(isDebug || isASAN)("each alone", () => {
  for (const [name, files] of projects) test(name, () => compare(files));
});

test.skipIf(isDebug || isASAN)("all of them as one project", () => {
  const all: Project = { "package.json": `{ "name": "all", "private": true }\n` };
  for (const [name, files] of projects) for (const path in files) all[`${name}/${path}`] = files[path];
  return compare(all);
});
