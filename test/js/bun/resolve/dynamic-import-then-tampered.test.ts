import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// ContinueDynamicImport settles the promise that import() returns only through
// its PromiseCapability, so nothing on that path may look up "then" on a
// %Promise%. A replaced Promise.prototype.then must not be able to decide what
// import() resolves with, and a failed import() must still reject.
test("import() settles with the loader's outcome when Promise.prototype.then is replaced", async () => {
  using dir = tempDir("dyn-import-then-tampered", {
    "dep.mjs": `export const dep = "from dependency";`,
    "with-dep.mjs": `import { dep } from "./dep.mjs"; export const value = 42; export { dep };`,
    "no-deps.mjs": `export const value = 43;`,
    // A namespace that exports a callable "then" is a thenable per spec; that
    // lookup happens on the namespace object, not on a promise, and must keep working.
    "exports-then.mjs": `export function then(resolve) { resolve("from the namespace's then"); }`,
    "main.mjs": `
      const originalThen = Promise.prototype.then;
      const results = {};
      let pending = 0;
      function track(label, promise) {
        pending++;
        const settle = (key, value) => {
          results[label] = { [key]: value };
          if (--pending === 0) {
            Promise.prototype.then = originalThen;
            console.log(JSON.stringify(results));
          }
        };
        originalThen.call(
          promise,
          ns => settle("fulfilled", typeof ns === "object" ? { value: ns.value, dep: ns.dep } : ns),
          e => settle("rejected", String(e?.message ?? e).split("\\n")[0]),
        );
      }

      Promise.prototype.then = function (onFulfilled) {
        onFulfilled("tampered");
      };
      track("withDep", import("./with-dep.mjs"));
      track("noDeps", import("./no-deps.mjs"));
      track("missing", import("./does-not-exist.mjs"));
      track("exportsThen", import("./exports-then.mjs"));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(JSON.parse(stdout)).toEqual({
    withDep: { fulfilled: { value: 42, dep: "from dependency" } },
    noDeps: { fulfilled: { value: 43 } },
    missing: { rejected: expect.stringContaining("Cannot find module") },
    exportsThen: { fulfilled: "from the namespace's then" },
  });
  // The loader's own rejected promise for the missing module is consumed by
  // import()'s promise, so it is not reported as unhandled a second time.
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
