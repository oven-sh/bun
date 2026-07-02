import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import path from "node:path";

test("dev server deinitializes itself", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "fixtures/deinitialization/test.ts")],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
  });
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
});

// A dev server whose framework fails to resolve is dropped a few microseconds
// after it spawned the file watcher thread, so `Watcher::shutdown` runs while
// that thread may not have been scheduled yet. The watcher allocation has to
// survive until the thread is done with it; only ASAN sees the stray write.
// An unresolvable `bun:` specifier keeps the window between the two as small as
// possible, since it fails without any filesystem probing.
const FAILED_INITS_PER_PROCESS = 50;
const PROCESSES = 3;

const failedInitFixture = `
  let frameworkErrors = 0;
  const otherErrors = [];
  for (let i = 0; i < ${FAILED_INITS_PER_PROCESS}; i++) {
    try {
      Bun.serve({
        port: 0,
        development: true,
        app: {
          framework: {
            fileSystemRouterTypes: [
              { root: "routes", style: "nextjs-pages", serverEntryPoint: "bun:does-not-exist" },
            ],
          },
        },
      }).stop(true);
      otherErrors.push("Bun.serve() unexpectedly succeeded");
    } catch (error) {
      if (error.message === "Framework is missing required files!") frameworkErrors++;
      else otherErrors.push(error.message);
    }
  }
  console.log(JSON.stringify({ frameworkErrors, otherErrors }));
`;

test.skipIf(!isASAN)("file watcher survives a dev server that fails to initialize", async () => {
  using dir = tempDir("failed-dev-server-init", {});
  const env = {
    ...bunEnv,
    // Symbolizing an ASAN report against the debug binary takes several seconds,
    // which would exhaust the test timeout before the exit status is asserted.
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":"),
  };

  // Each failed init leaves a watcher thread parked on its inotify instance for
  // the life of the process, so the attempts are spread across several
  // short-lived processes to stay well under `fs.inotify.max_user_instances`.
  const runs: unknown[] = [];
  for (let i = 0; i < PROCESSES; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", failedInitFixture],
      env,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    runs.push({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode });
  }

  const expected = {
    stdout: JSON.stringify({ frameworkErrors: FAILED_INITS_PER_PROCESS, otherErrors: [] }),
    exitCode: 0,
    signalCode: null,
  };
  expect(runs).toEqual(Array.from({ length: PROCESSES }, () => expected));
});
