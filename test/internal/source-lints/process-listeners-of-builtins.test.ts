import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// `bun test --isolate=modules` runs every test file with one `process` and one copy of each built-in module. Before each
// next file it removes the listeners that were added to `process` since the first one started, as leftovers of the file
// (src/js/internal/test/globals.ts). A built-in that adds a listener for itself is then left believing in a listener that
// is gone, unless it says what the listener is. It says so through `process.$sharedByTestFiles`, which is only there in
// that mode:
//  - The listener serves what lives as long as the built-in, like the stream of `process.stdout`. The built-in adds it
//    with `($getByIdDirectPrivate(process, "sharedByTestFiles") ?? process).on(...)`, and the restore leaves it.
//  - The listener serves what the built-in holds for the test file, like the callbacks of `process.finalization`. The
//    built-in passes a function to `$getByIdDirectPrivate(process, "sharedByTestFiles")?.forget(...)`. It runs once,
//    before the next file, and drops that state, so that the built-in adds the listener again. The same goes for a
//    latch over anything else that the restore takes back, like a property of `globalThis`.
// A call that adds a listener to `process` in another way is listed here, with what makes that right or with what a
// later test file loses by it.

const root = path.resolve(import.meta.dir, "..", "..", "..", "src", "js");

const passesForget = "the built-in passes a `forget`";
const ofProcessObjectInternals: [event: string, why: string][] = [
  ["exit", "of a worker thread, which has a `process` of its own"],
  ["exit", passesForget],
  ["beforeExit", passesForget],
];
const ofTraceEvents = "lost: a later file that enables a category has neither this listener nor the wrapped timers";
const addedDirectly: Record<string, [event: string, why: string][]> = {
  "ahead-of-time/builtins/ProcessObjectInternals.ts": ofProcessObjectInternals,
  "ahead-of-time/builtins/stdio.ts": [["SIGWINCH", "a compiled program gives each test file a `process` of its own"]],
  "builtins/ProcessObjectInternals.ts": ofProcessObjectInternals,
  "internal/cluster/child.ts": [
    ["disconnect", "lost: in a `bun test` that is itself a cluster worker, later files have the worker without it"],
    ["disconnect", "added to end the process"],
  ],
  "internal/quic/quic.ts": [
    ["exit", "lost: the endpoints of later files are not released at exit, where the process closes their sockets"],
  ],
  "internal/readline/interface.ts": [["SIGCONT", "added while an interface of the test file has the process stopped"]],
  "internal/serve_cli.ts": [
    ["SIGINT", "`bun serve` runs no test file"],
    ["SIGHUP", "`bun serve` runs no test file"],
    ["SIGTERM", "`bun serve` runs no test file"],
  ],
  "internal/trace_events.ts": [
    ["exit", ofTraceEvents],
    ["unhandledRejection", ofTraceEvents],
    ["rejectionHandled", ofTraceEvents],
  ],
  "node/repl.ts": [
    ["newListener", "lost: a REPL that a file leaves open takes the guard from the REPLs of later files"],
  ],
};

const addsListener = /(?<![.\w$])process\.(?:on|once|addListener|prependListener|prependOnceListener)\((?:"([^"]*)")?/g;

test("a built-in that adds a listener to process says what becomes of it between test files", () => {
  const forget = `$getByIdDirectPrivate(process, "sharedByTestFiles")?.forget(`;
  const found: Record<string, string[]> = {};
  for (const entry of (readdirSync(root, { recursive: true }) as string[]).sort()) {
    if (!/\.[jt]s$/.test(entry) || entry.endsWith(".d.ts")) continue;
    const file = entry.replaceAll("\\", "/");
    // Line comments go, newlines stay.
    const code = readFileSync(path.join(root, entry), "utf8").replace(/^\s*(?:\/\/|\*).*$/gm, "");
    [...code.matchAll(addsListener)].forEach((match, i) => {
      (found[file] ??= []).push(match[1] ?? "(not a string)");
      if (addedDirectly[file]?.[i]?.[1] !== passesForget) return;
      // The `forget` stands a few lines above the listeners that go with what it drops.
      const above = code.slice(Math.max(0, match.index - 600), match.index);
      expect([file, match[1], above.includes(forget)]).toEqual([file, match[1], true]);
    });
  }
  expect(found).toEqual(
    Object.fromEntries(Object.entries(addedDirectly).map(([file, calls]) => [file, calls.map(call => call[0])])),
  );
});
