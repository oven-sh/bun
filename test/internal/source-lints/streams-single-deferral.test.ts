import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A streams job that runs later must run in the async context of the code that queued it, as the
// promise reaction it replaces does. Otherwise a user callback it reaches (a sink's write() or
// close(), a source's pull(), a transformer's flush()) reads no AsyncLocalStorage store and runs
// outside its Bun.ModuleGraph. queueStreamsMicrotask in WebStreamsInternals.h carries that context.
// A QueuedTask built anywhere else in the directory can drop it again.
test("webcore/streams queues microtasks only through queueStreamsMicrotask", async () => {
  const streams = path.resolve(import.meta.dir, "..", "..", "..", "src", "jsc", "bindings", "webcore", "streams");
  const definedIn = "WebStreamsInternals.h";
  const rawDeferral = /\bQueuedTask\b|\bInternalMicrotask::|\bqueueMicrotask\s*\(/;
  const violations: string[] = [];
  let scanned = 0;
  let definitions = 0;

  for await (const file of new Glob("*.{h,cpp}").scan({ cwd: streams })) {
    scanned++;
    const lines = readFileSync(path.join(streams, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      if (!rawDeferral.test(code)) return;
      if (file === definedIn) definitions++;
      else violations.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }

  // A moved test file or a renamed directory must not make the ban pass with nothing scanned.
  expect(scanned).toBeGreaterThan(0);
  expect(violations).toEqual([]);
  // The two lines of the one definition: the QueuedTask and vm.queueMicrotask().
  expect(definitions).toBe(2);
});
