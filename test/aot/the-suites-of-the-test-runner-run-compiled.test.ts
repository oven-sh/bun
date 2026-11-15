import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const root = join(import.meta.dir, "..", "..");
const linesOf = (file: string) =>
  readFileSync(join(import.meta.dir, file), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#"));
const suites = linesOf("the-suites-of-the-test-runner-run-compiled.suites.txt");
const known = linesOf("the-suites-of-the-test-runner-run-compiled.known.txt");

async function casesOf(flags: string[]) {
  const { stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--timeout=60000", "--max-concurrency=4", ...suites.map(suite => "./" + suite)],
    root,
    { ...bunEnv, NO_COLOR: "1" },
  );
  const lines = stderr.split("\n");
  const listedAgain = lines.findLastIndex(line => /^\d+ tests? failed:$/.test(line));
  const cases = lines
    .slice(0, listedAgain < 0 ? undefined : listedAgain)
    .filter(line => /^\((?:pass|fail|skip|todo)\) /.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, "").replace(/"\/[^"]*\/([\w-]+)-\w{6}\//g, '"$1/'));
  return { cases, exitCode };
}

function alone(cases: string[], others: string[]) {
  const left = new Map<string, number>();
  for (const line of others) left.set(line, (left.get(line) ?? 0) + 1);
  return cases.filter(line => {
    const count = left.get(line) ?? 0;
    if (count) left.set(line, count - 1);
    return !count;
  });
}

test.skipIf(isASAN)(
  "each case ends as it ends under bun test",
  async () => {
    const plain = await casesOf([]);
    const compiled = await casesOf(["--aot"]);
    expect(plain.cases.length).toBeGreaterThan(3000);
    expect(
      [
        ...alone(plain.cases, compiled.cases).map(line => "bun test: " + line),
        ...alone(compiled.cases, plain.cases).map(line => "bun test --aot: " + line),
      ].sort(),
    ).toEqual(known.toSorted());
    for (const { cases, exitCode } of [plain, compiled])
      expect(exitCode).toBe(cases.some(line => line.startsWith("(fail) ")) ? 1 : 0);
  },
  900_000,
);
