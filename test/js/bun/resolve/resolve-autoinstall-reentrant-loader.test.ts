import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// The resolver's auto-install path reaches PackageManager::enqueue_dependency_to_root
// from inside HostLoadImportedModule and waits for the registry round-trip. That
// wait must not drive jsc::EventLoop::tick(): if it does, a sibling module's
// transpile completion runs ModuleLoadStep -> loadRequestedModules -> innerModuleLoading
// while the outer graph walk is still mid-hostLoadImportedModule on the same
// referrer, and finishLoadingImportedModule populates a different request key in
// referrer.[[LoadedModules]] from under it. On an asserts build that trips
// `needsErrorReaction != loadedModules().contains(requestKey)`; on release the
// ModuleGraphLoadingError reaction is skipped for a still-pending edge.
test("auto-install wait inside HostLoadImportedModule does not re-enter the module loader", async () => {
  // Registry that HOLDS every manifest request until the child signals "siblings
  // dispatched" on stdout. This makes the test deterministic: by the time the
  // package-manager wait loop polls I/O, the sibling transpile completions are
  // already queued on the JS event loop's concurrent-task queue.
  let releaseAll: (() => void) | null = null;
  const released = new Promise<void>(r => (releaseAll = () => r()));
  using registry = Bun.serve({
    port: 0,
    async fetch() {
      await released;
      return new Response("not found", { status: 404 });
    },
  });

  // `index.mjs` imports a handful of sibling modules first (they go to the
  // concurrent transpiler pool and return pending loadPromises), then a bare
  // package specifier whose resolve() triggers the auto-install wait. Each
  // sibling imports `index.mjs` back so that the ModuleLoadStep for a completed
  // sibling walks `index` (still status New) and reaches the synchronous
  // finishLoadingImportedModule path for one of the earlier sibling requests.
  const SIBLINGS = 6;
  const files: Record<string, string> = {};
  let hubSrc = "";
  for (let i = 0; i < SIBLINGS; i++) {
    hubSrc += `import { v as v${i} } from "./s${i}.mjs";\n`;
    // Each sibling re-imports the hub so that when its ModuleLoadStep::Main
    // runs loadRequestedModules, the fresh graph walk reaches `hub` (still
    // status New) and synchronously populates hub.[[LoadedModules]].
    files[`s${i}.mjs`] = `import * as hub from "./hub.mjs";\nexport const v = ${i} + (hub ? 0 : 1);\n`;
  }
  // The bare specifier is a *static* import so its resolve() runs during
  // innerModuleLoading's walk of `hub`, after the siblings have been handed to
  // the concurrent transpiler.
  hubSrc += `import "autoinstall-reentrancy-pkg";\n`;
  hubSrc += `export const sum = ${Array.from({ length: SIBLINGS }, (_, i) => `v${i}`).join(" + ")};\n`;
  files["hub.mjs"] = hubSrc;
  // The entry module signals when hub's siblings are in flight, then imports
  // hub so the graph walk runs while the registry is still being held.
  files["index.mjs"] =
    `process.stdout.write("siblings-dispatched\\n");\n` +
    `const hub = await import("./hub.mjs").catch(e => ({ sum: "<" + e.message + ">" }));\n` +
    `console.log("sum", hub.sum);\n`;
  files["bunfig.toml"] = `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`;

  using dir = tempDir("autoinstall-reentrant-loader", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=fallback", "index.mjs"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Release the registry once the child has dispatched the sibling imports, so
  // the auto-install wait sees their completions sitting on the concurrent task
  // queue.
  let stdout = "";
  let releasedOnce = false;
  const stdoutDone = (async () => {
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString("utf8");
      if (!releasedOnce && stdout.includes("siblings-dispatched")) {
        releasedOnce = true;
        releaseAll!();
      }
    }
  })();
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (!releasedOnce) releaseAll!();
  await stdoutDone;

  // Before the fix the auto-install wait ran jsc::EventLoop::tick(); the nested
  // graph walk re-visited `hub` while the outer host-load for req_pkg was still
  // on the stack. On an asserts build that trips `needsErrorReaction !=
  // contains(requestKey)` and aborts; on a release build the error reaction for
  // a still-pending edge is skipped and the resolve failure surfaces as an
  // unhandled error instead of flowing through the caught import() rejection.
  // After the fix the wait only polls the usockets loop; the sibling
  // completions dispatch after the wait returns and the import rejects cleanly.
  expect(stderr).toBe("");
  expect(stdout).toContain("siblings-dispatched");
  expect(stdout).toContain("sum <");
  expect(stdout).toContain("autoinstall-reentrancy-pkg");
  expect(exitCode).toBe(0);
});
