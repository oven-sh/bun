import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import wt from "worker_threads";

// The Worker constructor resolves each `preload` specifier on the thread that constructs the worker.
// One that does not resolve makes the constructor throw a TypeError.

// The text of bun 1.3: a `BuildMessage` of the resolver's error, as a string.
const unresolved = (specifier: string) => `BuildMessage: ModuleNotFound resolving "${specifier}" (entry point)`;

describe("a preload that does not resolve", () => {
  const entry = new URL("worker-fixture-preload-entry.js", import.meta.url);
  const relative = "./this-preload-does-not-exist.js";
  const absolute = path.join(import.meta.dir, "this-preload-does-not-exist.js");
  const nodeOptions: wt.WorkerOptions & { preload: string[] } = { preload: [relative] };

  test.each([
    ["Worker, string form", relative, () => new Worker(entry.href, { preload: relative })],
    ["Worker, array form", relative, () => new Worker(entry.href, { preload: [relative] })],
    ["Worker, absolute path", absolute, () => new Worker(entry.href, { preload: [absolute] })],
    ["worker_threads.Worker", relative, () => new wt.Worker(entry, nodeOptions)],
  ])("throws a TypeError that names it, each time (%s)", (_, specifier, construct) => {
    const thrown = [construct, construct].map(construct => {
      try {
        construct().terminate();
        return "did not throw";
      } catch (e) {
        return e instanceof TypeError ? e.message : e;
      }
    });
    expect(thrown).toEqual([unresolved(specifier), unresolved(specifier)]);
  });

  // What the resolver finds depends on the files beside the preload, so these cases get a directory of their own.
  test("the message is the resolver's last error, and the parent's log is untouched", async () => {
    using dir = tempDir("worker-preload-resolve", {
      "package.json": JSON.stringify({ imports: { "#fs": "node:fs" } }),
      "worker.js": `postMessage(globalThis.preloaded ?? "no preload");`,
      "ok.js": `globalThis.preloaded = "ok.js ran";`,
      "never.js": `console.log("never.js ran");`,
      "bad-tsconfig-1/tsconfig.json": `{ "compilerOptions": `,
      "bad-tsconfig-2/tsconfig.json": `{ "compilerOptions": `,
      "bad-tsconfig-2/ok.js": `globalThis.preloaded = "bad-tsconfig-2/ok.js ran";`,
      "main.js": `
        const results = [];
        for (const preload of [["fs"], ["#fs"], ["./never.js", "./missing.js"], ["./bad-tsconfig-1/missing.js"]]) {
          try {
            new Worker("./worker.js", { preload }).terminate();
            results.push("did not throw");
          } catch (e) {
            results.push(e.constructor.name + ": " + e.message);
          }
        }
        // The parent's own resolver still reports its failures.
        results.push(await import("./missing-import.js").then(() => "imported", e => e.name));
        for (const preload of ["./ok.js", "./bad-tsconfig-2/ok.js"]) {
          const worker = new Worker("./worker.js", { preload });
          results.push(
            await new Promise(resolve => {
              worker.onmessage = e => resolve(e.data);
              worker.onerror = e => resolve("error event: " + e.message);
            }),
          );
          worker.terminate();
        }
        console.log(JSON.stringify(results, null, 2));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = [
      "TypeError: " + unresolved("fs"),
      `TypeError: BuildMessage: Cannot use "#fs" as an entry point: it resolves to a builtin module`,
      "TypeError: " + unresolved("./missing.js"),
      "TypeError: " + unresolved("./bad-tsconfig-1/missing.js"),
      "ResolveMessage",
      "ok.js ran",
      "bad-tsconfig-2/ok.js ran",
    ];
    expect(stderr).toBe("");
    expect(stdout).toBe(JSON.stringify(expected, null, 2) + "\n");
    expect(exitCode).toBe(0);
  });
});
