// Runs the vendored Web Platform Tests streams suite (streams/**/*.any.js)
// against Bun's Web Streams implementation. The .any.js files and the
// streams/resources/*.js helpers are byte-identical to upstream; every
// adaptation lives in ../wpt-testharness-shim.ts and this driver, following the
// test/js/third_party/wpt-h2 pattern.
//
// Vendored from web-platform-tests/wpt @ 1cfa3004f4ac74aa007591529aba9e9246b1f1bf
// (see UPSTREAM.md for the file list and exclusions).
//
// Every WPT subtest that does not pass on the current implementation is
// listed in expectations.json, keyed by "<file> :: <subtest name>". How the
// expectation value's prefix maps onto bun:test:
//
//   CRASH...    -> test.todo (body-less: the body aborts the whole process)
//   TIMEOUT...  -> test.todo (body-less: the body would cost its full budget)
//   anything else (FAIL...) -> test.failing: the body still RUNS, its failure
//                  is expected, and a body that starts PASSING fails the run
//                  ("marked as failing but it passed") — the graduation signal.
//
// Everything not listed must pass. Regenerate the expectation data with:
//
//   rm -f /root/wpt-fix-scratch/j.jsonl
//   WPT_STREAMS_RECORD=/root/wpt-fix-scratch/j.jsonl bun bd test test/js/third_party/wpt-streams/wpt-streams.test.ts
//
// which appends one JSON line per subtest ({name, status, message}) to that
// path. The journal is append-only and a "RUNNING" line is written before
// each subtest body executes, so if a subtest brings the whole process down
// (a real bug class for streams + GC), the crashing subtest is the trailing
// RUNNING entry with no result. Add it to expectations.json with a value
// starting with "CRASH" and re-run: record mode never executes known-CRASH
// subtests, and never re-executes subtests that already have a result in the
// journal, so the sweep resumes and makes progress past every crasher. Once
// the sweep completes, rebuild expectations.json + RESULTS.md from the
// journal and update EXPECTED_FILES / EXPECTED_SUBTESTS below.

import { afterAll, describe, expect, test as bunTest } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { setRegistrar, wptTest } from "../wpt-testharness-shim";
import expectations from "./expectations.json";

const ROOT = import.meta.dir;
const expectedFailures = expectations.failures as Record<string, string>;

// These MUST be updated intentionally whenever the vendored set changes (a
// re-vendor, or adding/removing files). They pin exactly how many `.any.js`
// files were discovered and how many WPT subtests were registered, so a file
// that stops evaluating (or a subtest that stops being registered) turns the
// suite red instead of silently shrinking it while it stays green.
const EXPECTED_FILES = 68;
const EXPECTED_SUBTESTS = 1174;

// Record mode: run everything except known process-crashers (no todos), never
// fail the bun test, and journal every result so expectations.json /
// RESULTS.md can be regenerated.
const recordPath = process.env.WPT_STREAMS_RECORD;
type Status = "PASS" | "FAIL" | "TIMEOUT" | "CRASH" | "RUNNING";
function journal(name: string, status: Status, message?: string) {
  appendFileSync(recordPath!, JSON.stringify({ name, status, message }) + "\n");
}

// The journal is also the resume point: subtests that already have a final
// result in it are not re-executed, so a sweep interrupted by a crashing
// subtest picks up where it left off once the crasher is quarantined.
const alreadyRecorded = new Set<string>();
if (recordPath && existsSync(recordPath)) {
  for (const line of readFileSync(recordPath, "utf8").split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.status !== "RUNNING") alreadyRecorded.add(entry.name);
  }
}

let registeredSubtests = 0;
const expectationHits = new Map<string, number>();

let currentFile = "";
const register = (name: string, run: () => Promise<void>) => {
  registeredSubtests++;
  const key = `${currentFile} :: ${name}`;
  const expected = expectedFailures[key];
  if (expected !== undefined) expectationHits.set(key, (expectationHits.get(key) ?? 0) + 1);
  // A subtest that aborts the process (JSC assertion, segfault) can never be
  // executed, in either mode; it is still reported.
  const crashes = expected !== undefined && expected.startsWith("CRASH");
  if (recordPath) {
    if (crashes) {
      if (!alreadyRecorded.has(key)) journal(key, "CRASH", expected);
      return void bunTest.todo(name);
    }
    if (alreadyRecorded.has(key)) return void bunTest.todo(name);
    return void bunTest(name, async () => {
      journal(key, "RUNNING");
      try {
        await run();
        journal(key, "PASS");
      } catch (e: any) {
        journal(key, e?.name === "WPTTimeout" ? "TIMEOUT" : "FAIL", String(e?.message ?? e));
      }
    });
  }
  if (expected === undefined) return void bunTest(name, run);
  // TIMEOUT bodies would cost their full budget on every run; like CRASH
  // bodies they are never executed in normal mode.
  if (crashes || expected.startsWith("TIMEOUT")) return void bunTest.todo(name);
  // Expected assertion failures still RUN: a body that starts passing turns
  // into "marked as failing but it passed", which is the graduation signal.
  bunTest.failing(name, run);
};
setRegistrar(register);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const files = [...walk(join(ROOT, "streams"))].filter(f => f.endsWith(".any.js"));

// `// META: script=` includes are classic scripts sharing the test file's
// global scope in WPT, so they are concatenated ahead of the test source.
// Absolute paths (`/common/gc.js`) resolve against the vendored WPT root.
// The 5 distinct include files are referenced 81 times, so memoize them.
const includeCache = new Map<string, string>();
function readInclude(path: string): string {
  let source = includeCache.get(path);
  if (source === undefined) includeCache.set(path, (source = readFileSync(path, "utf8")));
  return source;
}

// Only `script` is acted on; `global`/`title`/`timeout` are recognized and
// ignored. Anything else means the vendored set now relies on a META key
// this runner does not understand, which must be a hard error.
const KNOWN_META_KEYS = new Set(["script", "global", "title", "timeout"]);
const META_RE = /^\/\/ META: ([^=]+)=(.*)$/;

for (const file of files) {
  // Expectation keys are always `/`-separated so they are identical on
  // every platform.
  const rel = relative(ROOT, file).split(sep).join("/");

  describe(rel, () => {
    currentFile = rel;
    // A throw anywhere in here — an unresolvable `// META: script=` include,
    // an unknown META key, a testharness API the shim only stubs, a syntax
    // error — must be LOUD, never a silently shorter file. The synthetic
    // subtest names the failure (and journals it in record mode) and the
    // rethrow errors the whole describe; EXPECTED_SUBTESTS independently
    // catches the shrink.
    try {
      const source = readFileSync(file, "utf8");
      const pieces: string[] = [];
      for (const line of source.split("\n")) {
        const match = META_RE.exec(line);
        if (!match) continue;
        const [, metaKey, metaValue] = match;
        if (!KNOWN_META_KEYS.has(metaKey)) throw new Error(`${rel}: unknown \`// META: ${metaKey}=\` key`);
        if (metaKey !== "script") continue;
        const ref = metaValue.trim();
        pieces.push(readInclude(ref.startsWith("/") ? join(ROOT, ref.slice(1)) : join(dirname(file), ref)));
      }
      pieces.push(source);
      // bun:test injects its own `test` binding into every module it
      // transpiles, which would shadow the WPT-style test(fn, name) global.
      // Evaluate the vendored sources inside a Function whose `test`
      // parameter is the shim's synchronous test(); all other testharness
      // identifiers resolve via globalThis (see ../wpt-testharness-shim.ts).
      new Function("test", pieces.join("\n;\n"))(wptTest);
    } catch (e) {
      register("harness: file failed to evaluate", () => Promise.reject(e));
      throw e;
    }
  });
}

afterAll(() => {
  expect(files.length).toBe(EXPECTED_FILES);
  expect(registeredSubtests).toBe(EXPECTED_SUBTESTS);
});

// Every expectations.json key must have matched exactly one registered
// subtest; a stale or renamed key would otherwise rot silently.
afterAll(() => {
  const unmatched = Object.keys(expectedFailures).filter(key => expectationHits.get(key) !== 1);
  expect(unmatched).toEqual([]);
});
