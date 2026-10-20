// Web Platform Tests against bun:dom. expectations.json names each test that runs and the subtests of it that do not pass.
// Everything else has to pass, and what is listed has to fail: a fix takes its lines out (update-expectations.js).
import { describe, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runTestFile } from "./run-process.js";

const wptDirectory = process.env.BUN_WPT_DIRECTORY ?? join(import.meta.dir, "web-platform-tests");
const expectationsFile = process.env.BUN_WPT_EXPECTATIONS ?? join(import.meta.dir, "expectations.json");

type Expectations = Record<string, Record<string, string> | string>;
type Subtest = { name: string; status: string; message: string | null };

function list(title: string, subtests: Subtest[]) {
  if (!subtests.length) return [];
  const shown = subtests
    .slice(0, 5)
    .flatMap(({ name, status, message }) => [
      `  ${status} ${name}`,
      ...(message ? [`       ${message.split("\n")[0].slice(0, 200)}`] : []),
    ]);
  return [
    `${subtests.length} ${title}`,
    ...shown,
    ...(subtests.length > 5 ? [`  ... ${subtests.length - 5} more`] : []),
  ];
}

describe.skipIf(!existsSync(wptDirectory))("wpt", () => {
  const expectations: Expectations = existsSync(expectationsFile)
    ? JSON.parse(readFileSync(expectationsFile, "utf8"))
    : {};
  for (const [path, expected] of Object.entries(expectations)) {
    if (typeof expected === "string") {
      test.skip(`${path} (${expected})`, () => {});
      continue;
    }
    test.concurrent(
      path,
      async () => {
        const result = await runTestFile({ bun: bunExe(), env: bunEnv, wptDirectory, path });
        const subtests: Subtest[] = result.subtests;
        const names = new Set(subtests.map(subtest => subtest.name));
        const report = [
          ...(result.status === "OK" ? [] : [`the file ended with ${result.status}: ${result.message}`]),
          ...list(
            "subtests that passed before do not pass:",
            subtests.filter(({ name, status }) => status !== "PASS" && !Object.hasOwn(expected, name)),
          ),
          ...list(
            "subtests are listed in expectations.json and pass now. Take them out with update-expectations.js:",
            subtests.filter(({ name, status }) => status === "PASS" && Object.hasOwn(expected, name)),
          ),
          ...list(
            "subtests are listed in expectations.json and were not reported:",
            Object.keys(expected)
              .filter(name => !names.has(name))
              .map(name => ({ name, status: "MISSING", message: null })),
          ),
        ];
        if (report.length)
          throw new Error(
            `${report.join("\n")}\nAll of it: bun --expose-internals ${join(import.meta.dir, "run-test-file.js")} ${wptDirectory} '${path}'`,
          );
      },
      90_000,
    );
  }
});
