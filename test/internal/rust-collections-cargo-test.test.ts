// Runs bun_collections' own unit tests as the native libtest binary, i.e. with
// several tests alive at once. The only CI lane that runs these tests today is
// `bun run rust:miri`, which runs them one at a time, so it never sees the
// failure this guards against:
//
// The tests in src/collections/pool.rs count `Tracked` drops in a process-wide
// counter and serialize on a mutex, while every `object_pool!(.., threadsafe, ..)`
// free list is a `thread_local!` that drops whatever it still caches when the
// thread running the test exits. A test releases the mutex when its function
// returns, and its thread's TLS destructors run after that, so a pool test that
// returned with a node still cached bumped the counter inside whichever test was
// already waiting on the mutex:
//
//   test pool::tests::push_get::push_then_get_if_exists ... FAILED
//   assertion `left == right` failed
//     left: 2
//    right: 1
//
// The pool tests now run their bodies on a thread they join (which waits for
// that thread's TLS destructors) before releasing the mutex. The race needs
// another test to be waiting, so `--test-threads` is passed explicitly: libtest
// sizes it from available_parallelism, which a CPU quota can put at 1, and with
// one test thread the next test is not started until the previous one has been
// joined. It also needs two CPUs to run on and then hits a few percent of runs
// (4% to 17% measured on 2 to 12 CPUs), so the pool tests are run a few hundred
// times, each run checked to have actually run them: libtest exits 0 when a
// filter matches nothing.
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
const POOL_FILTER = "pool::";
const POOL_TESTS = [
  "pool::tests::capped::pool_over_max_count_destroys_the_node",
  "pool::tests::push_get::push_then_get_if_exists",
  "pool::tests::recycle::pool_recycles_the_same_node",
];

async function run(cmd: string[], env: Record<string, string | undefined> = process.env) {
  await using proc = Bun.spawn({ cmd, cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(isWindows || !cargo || !workspaceResolvable)(
  "bun_collections unit tests pass with several tests running at once",
  async () => {
    // json-render-diagnostics rather than json: compile errors still go to
    // stderr as text, where the assertion below shows them.
    const build = await run(
      [
        cargo!,
        "test",
        "--locked",
        "-p",
        "bun_collections",
        "--lib",
        "--no-run",
        "--message-format=json-render-diagnostics",
      ],
      { ...process.env, CARGO_TERM_COLOR: "never" },
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toMatchObject({ exitCode: 0 });

    const executables = build.stdout
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

    expect(await run([testBinary])).toMatchObject({ exitCode: 0 });

    for (let attempt = 1; attempt <= POOL_TEST_RUNS; attempt++) {
      const pool = await run([testBinary, POOL_FILTER, "--test-threads=4"]);
      const notRun = POOL_TESTS.filter(name => !pool.stdout.includes(`test ${name} ... ok`));
      expect({ attempt, notRun, ...pool }).toMatchObject({ exitCode: 0, notRun: [] });
    }
  },
  // A fresh target dir compiles bun_core and its dependencies first (about 15s
  // on 12 cores); warm, the cargo step takes well under a second and the runs
  // a few seconds under a debug build.
  120_000,
);
