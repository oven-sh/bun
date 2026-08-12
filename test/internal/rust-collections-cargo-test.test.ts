// Runs bun_collections' own unit tests as the native libtest binary, i.e. with
// libtest's default of one thread per test running concurrently. The only CI
// lane that runs these tests today is `bun run rust:miri`, which runs them one
// at a time, so it never sees the failure this guards against:
//
// The tests in src/collections/pool.rs count `Tracked` drops in a process-wide
// counter and serialize on a mutex, while every `object_pool!(.., threadsafe, ..)`
// free list is a `thread_local!` that drops whatever it still caches when the
// thread running the test exits. libtest reports a test as finished before its
// thread has exited, so a pool test that returned with a node still cached
// bumped the counter after releasing the mutex, inside whichever test held it
// next:
//
//   test pool::tests::push_get::push_then_get_if_exists ... FAILED
//   assertion `left == right` failed
//     left: 2
//    right: 1
//
// The pool tests now run their bodies on a thread they join (which waits for
// that thread's TLS destructors) before asserting. The race needs two CPUs the
// test threads can actually run on and then hits a few percent of runs (4% to
// 17% measured on 2 to 12 CPUs), so the pool tests are run a few hundred times.
// `--test-threads` is passed explicitly because libtest otherwise sizes its
// pool from available_parallelism, which a CPU quota can put at 1, and with a
// single test thread libtest joins each test before starting the next.
//
// Cargo resolves the whole workspace before applying -p, so like
// rust-windows-sys-link.test.ts this needs the configured tree (vendor/lolhtml
// and build_options.rs) and skips on the test-only CI lanes, which run a
// prebuilt bun without one. On Windows hosts the test binary of any bun_core
// dependent does not link yet (link.exe rejects the unresolved FFI references
// that lld discards as dead; #37575), so it is skipped there too.
import { which } from "bun";
import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(repoRoot, "build", "debug", "codegen", "build_options.rs"));

const POOL_TEST_RUNS = 300;
const POOL_TESTS = [
  "pool::tests::capped::pool_over_max_count_destroys_the_node",
  "pool::tests::push_get::push_then_get_if_exists",
  "pool::tests::recycle::pool_recycles_the_same_node",
];

test.skipIf(isWindows || !cargo || !workspaceResolvable)(
  "bun_collections unit tests pass under libtest's thread-per-test concurrency",
  () => {
    const build = Bun.spawnSync({
      cmd: [cargo!, "test", "--locked", "-p", "bun_collections", "--lib", "--no-run", "--message-format=json"],
      cwd: repoRoot,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: build.stderr.toString(), exitCode: build.exitCode }).toMatchObject({ exitCode: 0 });

    const executables = build.stdout
      .toString()
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line))
      .filter(
        message =>
          message.reason === "compiler-artifact" &&
          message.target.name === "bun_collections" &&
          message.profile.test &&
          message.executable,
      )
      .map(message => message.executable as string);
    expect(executables).toHaveLength(1);
    const [testBinary] = executables;

    const whole = Bun.spawnSync({ cmd: [testBinary], cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    const wholeStdout = whole.stdout.toString();
    expect({ stdout: wholeStdout, stderr: whole.stderr.toString(), exitCode: whole.exitCode }).toMatchObject({
      exitCode: 0,
    });
    // The loop below filters on `pool::`; make sure that still names these tests.
    for (const name of POOL_TESTS) {
      expect(wholeStdout).toContain(`test ${name} ... ok`);
    }

    for (let run = 1; run <= POOL_TEST_RUNS; run++) {
      const pool = Bun.spawnSync({
        cmd: [testBinary, "pool::", "--test-threads=4"],
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect({
        run,
        stdout: pool.stdout.toString(),
        stderr: pool.stderr.toString(),
        exitCode: pool.exitCode,
      }).toMatchObject({ exitCode: 0 });
    }
  },
  // A fresh target dir compiles bun_core and its dependencies first (about 15s
  // on 12 cores); warm, the cargo step takes well under a second and the runs
  // about a second.
  120_000,
);
