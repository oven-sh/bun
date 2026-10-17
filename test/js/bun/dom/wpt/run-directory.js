// Runs every Web Platform Test under the given directories, one process per test, and prints one line of JSON per test:
// how many subtests have each status, and each subtest that did not pass, with WebKit's own result for it.
//
//   bun run-directory.js <wpt directory> [--jobs=<number>] [--timeout-multiplier=<number>] [--all-subtests] [--files-read] <directory or test>...
//
// WPT is code we did not write. Until it is vendored, use run-in-sandbox.sh, not this file.
import { availableParallelism } from "node:os";
import { runTestFile } from "./run-process.js";
import { isCrashTest, listTests } from "./test-files.js";
import { namesMissingFrom, readWebKitResults } from "./webkit-results.js";

const flags = process.argv.slice(2).filter(argument => argument.startsWith("--"));
const [wptDirectory, ...targets] = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const flagValue = (name, fallback) => Number(flags.find(flag => flag.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const jobs = flagValue("jobs", Math.min(16, availableParallelism()));
const timeoutMultiplier = flagValue("timeout-multiplier", 1);
const keepAllSubtests = flags.includes("--all-subtests");
const keepFilesRead = flags.includes("--files-read");

const tests = targets.flatMap(target =>
  /\.html?(?:\?.*)?$/.test(target)
    ? [{ path: "/" + target.replace(/^\/+/, ""), kind: isCrashTest(target) ? "crashtest" : "testharness" }]
    : listTests(wptDirectory, target.replace(/^\/+/, "")),
);

const shorten = text => (text === null || text === undefined ? null : String(text).slice(0, 300));

async function run(test) {
  if (test.kind === "skipped") return { test: test.path, status: "SKIPPED", message: test.reason };
  const { subtests, filesRead, ...result } = await runTestFile({ wptDirectory, path: test.path, timeoutMultiplier });
  const webkit = readWebKitResults(wptDirectory, test.path);
  for (const [key, value] of Object.entries(result)) if (Array.isArray(value) && !value.length) delete result[key];
  return {
    ...result,
    kind: test.kind,
    message: shorten(result.message),
    counts: Object.fromEntries(Map.groupBy(subtests, subtest => subtest.status).entries().map(([status, list]) => [status, list.length])),
    failures: subtests
      .filter(subtest => subtest.status !== "PASS")
      .map(subtest => ({ ...subtest, message: shorten(subtest.message), webkit: webkit?.statusOf(subtest.name) ?? null })),
    webkit: webkit && { harnessError: webkit.harnessError, total: webkit.total, passed: webkit.passed, missingHere: namesMissingFrom(subtests, webkit) },
    ...(keepAllSubtests && { subtests }),
    ...(keepFilesRead && { filesRead }),
  };
}

let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < tests.length) console.log(JSON.stringify(await run(tests[next++])));
  }),
);
