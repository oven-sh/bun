import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir, tls } from "harness";
import { readdirSync } from "node:fs";

// Every case spawns a coordinator plus two to four worker processes, and the
// cases run concurrently (bun caps that at 5 under ASAN, 20 otherwise), so on a
// debug/ASAN build a dozen or more bun processes can be booting at once.
setDefaultTimeout(isASAN || isDebug ? 120_000 : 30_000);

/** Spawn every remaining worker as soon as the first one is busy, instead of after the production 5ms delay. */
const scaleNow = { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" };

type Dir = { toString(): string };

async function spawnTest(dir: Dir, args: string[], env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, pid: proc.pid };
}

/** `bun test <args>` in `dir`, with timings, versions and paths normalized out of the output. */
async function run(dir: Dir, args: string[], env: Record<string, string | undefined> = bunEnv) {
  const r = await spawnTest(dir, args, env);
  return {
    ...r,
    stdout: normalizeBunSnapshot(r.stdout, String(dir)),
    stderr: normalizeBunSnapshot(r.stderr, String(dir)),
  };
}

/** The block of counts the run ends with (" N pass" ... "Ran N tests across M files."). */
function summaryOf(stderr: string) {
  const i = stderr.lastIndexOf("\n\n");
  return i < 0 ? stderr : stderr.slice(i + 2);
}

/**
 * The lines printed under each file header, keyed by file and sorted, so a
 * run can be compared with one `toEqual` no matter how the workers' output
 * interleaved. Whenever the coordinator switches files it re-emits the header,
 * so a line belongs to the nearest header above it. Only status lines are kept
 * unless `keep` says otherwise.
 */
function resultsByFile(stderr: string, keep = /^\((?:pass|fail|skip|todo)\) /) {
  const out: Record<string, string[]> = {};
  let file = "";
  for (const line of stderr.split("\n")) {
    const header = /^(\S+\.test\.[jt]s):$/.exec(line);
    if (header) file = header[1];
    else if (keep.test(line)) (out[file] ??= []).push(line);
  }
  for (const lines of Object.values(out)) lines.sort();
  return out;
}

const normalizeJunit = (xml: string) => xml.replace(/ (?:time|hostname)="[^"]*"/g, "").trim();

const passing = (name: string) => `import {test,expect} from "bun:test"; test("${name}",()=>expect(1).toBe(1));`;
const failing = (name: string) => `import {test,expect} from "bun:test"; test("${name}",()=>expect(1).toBe(2));`;

// Prelude for fixtures that have to prove something about *when* files ran.
// Instead of sleeping and hoping, a file parks until a marker file exists in
// the run's cwd (the case's own tempDir, so concurrent cases never see each
// other's markers). A scheduling regression then shows up as the parked test
// failing with the condition it was waiting on, not as a hang. `T` is the
// timeout parked tests pass to test(); it has to outlive the deadline.
const parkMs = isASAN || isDebug ? 60_000 : 15_000;
const prelude = `
  import { test, expect } from "bun:test";
  const T = ${parkMs + 5_000};
  const exists = marker => Bun.file(marker).exists();
  const arrived = dir => Array.fromAsync(new Bun.Glob("*").scan(dir)).then(names => names.length);
  async function waitFor(cond) {
    const deadline = Date.now() + ${parkMs};
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("gave up waiting for " + cond);
      await Bun.sleep(5);
    }
  }
`;

describe.concurrent("bun test --parallel", () => {
  test("each worker gets its own JEST_WORKER_ID and BUN_TEST_WORKER_ID", async () => {
    // Every file parks until three files are in flight, so three workers have
    // to be alive at once: worker 1 cannot finish early and steal the others'
    // files, which would make one process report every file.
    const fixture = `${prelude}
      test("t", async () => {
        await Bun.write("gate/" + process.pid, "");
        await waitFor(async () => (await arrived("gate")) >= 3);
        console.log("WID=" + process.env.JEST_WORKER_ID + " " + process.env.BUN_TEST_WORKER_ID + " pid=" + process.pid);
      }, T);`;
    using dir = tempDir("parallel-worker-id", { "a.test.js": fixture, "b.test.js": fixture, "c.test.js": fixture });
    const { stdout, stderr, exitCode } = await run(dir, ["--parallel=3"], scaleNow);

    const seen = [...stderr.matchAll(/^WID=(\S+) (\S+) pid=(\d+)$/gm)].map(m => ({ jest: m[1], bun: m[2], pid: m[3] }));
    expect(seen.map(s => s.jest).sort()).toEqual(["1", "2", "3"]);
    expect(seen.map(s => s.bun)).toEqual(seen.map(s => s.jest));
    expect(new Set(seen.map(s => s.pid)).size).toBe(3);
    expect(stdout).toMatchInlineSnapshot(`"bun test <version> (<revision>) 3x PARALLEL"`);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 3 pass
       0 fail
      Ran 3 tests across 3 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("a single file runs in the coordinator itself and still gets worker id 1", async () => {
    // Jest sets JEST_WORKER_ID=1 even with --maxWorkers=1, so tests can rely on
    // the variable whenever --parallel was passed.
    using dir = tempDir("parallel-worker-id-single", {
      "a.test.js": `import {test} from "bun:test"; test("t", () => console.log("WID=" + process.env.JEST_WORKER_ID + " " + process.env.BUN_TEST_WORKER_ID + " pid=" + process.pid));`,
    });
    const { stdout, stderr, exitCode, pid } = await run(dir, ["--parallel=5"]);
    expect(stdout.replace(String(pid), "<coordinator pid>")).toMatchInlineSnapshot(`
      "bun test <version> (<revision>) 5x PARALLEL
      WID=1 1 pid=<coordinator pid>"
    `);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 1 pass
       0 fail
      Ran 1 test across 1 file."
    `);
    expect(exitCode).toBe(0);
  });

  test("runs files across workers and aggregates the totals", async () => {
    using dir = tempDir("parallel-basic", {
      "a.test.js": `import {test,expect} from "bun:test"; test("a1",()=>expect(1).toBe(1)); test("a2",()=>expect(1).toBe(1));`,
      "b.test.js": passing("b1"),
      "c.test.js": `import {test,expect} from "bun:test"; test("c1",()=>expect(1).toBe(1)); test("c2",()=>expect(1).toBe(1)); test("c3",()=>expect(1).toBe(1));`,
      "d.test.js": passing("d1"),
    });
    const { stdout, stderr, exitCode } = await run(dir, ["--parallel=2"]);

    expect(stdout).toMatchInlineSnapshot(`"bun test <version> (<revision>) 2x PARALLEL"`);
    // Workers are an implementation detail; the output never mentions them.
    expect(stderr).not.toContain("worker");
    expect(resultsByFile(stderr)).toEqual({
      "a.test.js": ["(pass) a1", "(pass) a2"],
      "b.test.js": ["(pass) b1"],
      "c.test.js": ["(pass) c1", "(pass) c2", "(pass) c3"],
      "d.test.js": ["(pass) d1"],
    });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 7 pass
       0 fail
       7 expect() calls
      Ran 7 tests across 4 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("surfaces failures and exits non-zero", async () => {
    using dir = tempDir("parallel-fail", { "ok.test.js": passing("ok"), "bad.test.js": failing("bad") });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"]);

    expect(resultsByFile(stderr)).toEqual({ "bad.test.js": ["(fail) bad"], "ok.test.js": ["(pass) ok"] });
    expect(stderr).toContain("expect(received).toBe(expected)");
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 1 pass
       1 fail
       2 expect() calls
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("a file whose worker exits mid-run is failed once and never retried", async () => {
    // A retry could mask an intermittent worker crash with a passing second attempt.
    using dir = tempDir("parallel-crash", {
      "a.test.js": passing("a"),
      "b.test.js": passing("b"),
      "boom.test.js": `import {test} from "bun:test"; test("boom",()=>process.exit(7));`,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"]);

    expect(resultsByFile(stderr)).toEqual({ "a.test.js": ["(pass) a"], "b.test.js": ["(pass) b"] });
    expect(stderr.match(/^\S+ boom\.test\.js \(.*$/gm)).toEqual(["✗ boom.test.js (worker crashed: exit code 7)"]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 2 pass
       1 fail
       2 expect() calls
      Ran 3 tests across 3 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("--parallel without a count uses the CPU count", async () => {
    using dir = tempDir("parallel-default", { "a.test.js": passing("a"), "b.test.js": passing("b") });
    const { stdout, stderr, exitCode } = await run(dir, ["--parallel"]);

    expect(stdout).toMatch(/^bun test <version> \(<revision>\) \d+x PARALLEL$/);
    expect(resultsByFile(stderr)).toEqual({ "a.test.js": ["(pass) a"], "b.test.js": ["(pass) b"] });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 2 pass
       0 fail
       2 expect() calls
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("forwards -t to the workers", async () => {
    // The drop_* tests would fail if a worker ran them.
    using dir = tempDir("parallel-filter", {
      "a.test.js": `import {test,expect} from "bun:test"; test("keep_a",()=>expect(1).toBe(1)); test("drop_a",()=>expect(1).toBe(2));`,
      "b.test.js": failing("drop_b"),
      "c.test.js": passing("keep_c"),
      "d.test.js": failing("drop_d"),
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "-t", "keep"]);

    expect(resultsByFile(stderr)).toEqual({ "a.test.js": ["(pass) keep_a"], "c.test.js": ["(pass) keep_c"] });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 2 pass
       3 filtered out
       0 fail
       2 expect() calls
      Ran 2 tests across 4 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("--bail stops dispatching files once the threshold is reached", async () => {
    // Every file fails, so whichever files the two workers pick up first trip
    // the bail; the other four must never start.
    const files: Record<string, string> = {};
    for (const f of ["a", "b", "c", "d", "e", "f"]) files[`${f}.test.js`] = failing(f);
    using dir = tempDir("parallel-bail", files);
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--bail=1"]);

    const ran = Object.entries(resultsByFile(stderr));
    expect(ran.length).toBeWithin(1, 3);
    for (const [file, lines] of ran) expect(lines).toEqual([`(fail) ${file[0]}`]);
    expect(stderr).toContain("\nBailed out after 1 failure\n");
    expect(summaryOf(stderr)).toMatch(
      /^ 0 pass\n [12] fail\n [12] expect\(\) calls\nRan [12] tests? across [12] files?\.$/,
    );
    expect(exitCode).toBe(1);
  });

  test("--bail: a worker that dies mid-file after the bail is reported as a crash, not as a panic", async () => {
    // `a` fails (tripping --bail=1) only once `b` is running; `b` then waits
    // for a's worker to be shut down by the bail and exits mid-file. Only a
    // worker panic makes sibling deaths collateral, a plain bail does not.
    using dir = tempDir("parallel-bail-then-exit", {
      "a.test.js": `${prelude}
        test("fail once b is running", async () => {
          await waitFor(() => exists("b-started"));
          await Bun.write("a-pid", String(process.pid));
          expect(1).toBe(2);
        }, T);`,
      "b.test.js": `${prelude}
        test("exit once a's worker is gone", async () => {
          await Bun.write("b-started", "");
          await waitFor(() => exists("a-pid"));
          const pid = Number(await Bun.file("a-pid").text());
          await waitFor(async () => { try { process.kill(pid, 0); return false; } catch { return true; } });
          process.exit(7);
        }, T);`,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--bail=1"], scaleNow);

    expect(resultsByFile(stderr)).toEqual({ "a.test.js": ["(fail) fail once b is running"] });
    expect(stderr).toContain("\nBailed out after 1 failure\n");
    expect(stderr.match(/^\S+ b\.test\.js \(.*$/gm)).toEqual(["✗ b.test.js (worker crashed: exit code 7)"]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 0 pass
       2 fail
       1 expect() calls
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  // A worker killed by a fatal signal is a bug in Bun or an addon, so the whole
  // run aborts with a banner and the siblings are torn down, even when --bail
  // has already stopped the run. (On Windows a crash caught by Bun's crash
  // handler exits with code 3, indistinguishable from process.exit(3); the
  // Windows classification below works on raw NTSTATUS exit codes instead.)
  // A deliberate crash must not upload a report: CI sets BUN_CRASH_REPORT_URL,
  // and an upload would get pinned on the next unrelated failing test.
  const crashEnv = { ...scaleNow, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };
  const hang = `import {test} from "bun:test"; test("hang", async () => { await new Promise(() => {}); }, 999999);`;
  const crashWith = (method: string) =>
    `import {test} from "bun:test"; import { crash_handler } from "bun:internal-for-testing"; test("${method}", () => { crash_handler.${method}(); });`;

  test.skipIf(isWindows)("--bail: a worker panic still aborts the run with the panic banner", async () => {
    using dir = tempDir("parallel-bail-panic", { "a-hang.test.js": hang, "b-panic.test.js": crashWith("segfault") });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--bail=1"], crashEnv);

    expect(stderr).toContain("Segmentation fault at address");
    expect(stderr).toContain("\nBailed out after 1 failure\n");
    expect(stderr).toContain(
      "error: a test worker process crashed with SIGSEGV while running b-panic.test.js.\n" +
        "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
    );
    expect(stderr.match(/^\S+ [ab]-\S+\.test\.js \(.*$/gm)!.sort()).toEqual([
      "✗ a-hang.test.js (aborted: sibling worker panicked)",
      "✗ b-panic.test.js (worker crashed: SIGSEGV)",
    ]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 0 pass
       2 fail
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  // Windows delivers no signals: a native fault that bypasses Bun's crash
  // handler (__fastfail: UCRT abort(), Rust aborts in addons, /GS checks)
  // terminates the worker with the raw NTSTATUS as its exit code. The
  // coordinator must recognize that as a crash and abort the run, not narrow
  // 0xC0000409 to "exit code 9" and carry on as if the test had called
  // process.exit(9). The hung sibling has to be terminated, not waited for.
  test.skipIf(!isWindows)("a worker dying with a fatal NTSTATUS prints the crash banner and aborts", async () => {
    using dir = tempDir("parallel-ntstatus", { "a-hang.test.js": hang, "b-fastfail.test.js": crashWith("fastfail") });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"], crashEnv);

    // 0xC0000409 = STATUS_STACK_BUFFER_OVERRUN, reported untruncated and in hex.
    expect(stderr).toContain(
      "error: a test worker process crashed with exit code 0xC0000409 while running b-fastfail.test.js.\n" +
        "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
    );
    expect(stderr.match(/^\S+ [ab]-\S+\.test\.js \(.*$/gm)!.sort()).toEqual([
      "✗ a-hang.test.js (aborted: sibling worker panicked)",
      "✗ b-fastfail.test.js (worker crashed: exit code 0xC0000409)",
    ]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 0 pass
       2 fail
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  // POSIX twin: fastfail resets the SIGABRT disposition and raises it, so the
  // worker dies by the raw signal with no crash-handler banner of its own.
  test.skipIf(isWindows)("a worker dying of a raw SIGABRT aborts the run", async () => {
    using dir = tempDir("parallel-fastfail-posix", {
      "a-hang.test.js": hang,
      "b-fastfail.test.js": crashWith("fastfail"),
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"], crashEnv);

    expect(stderr).toContain(
      "error: a test worker process crashed with SIGABRT while running b-fastfail.test.js.\n" +
        "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
    );
    expect(stderr.match(/^\S+ [ab]-\S+\.test\.js \(.*$/gm)!.sort()).toEqual([
      "✗ a-hang.test.js (aborted: sibling worker panicked)",
      "✗ b-fastfail.test.js (worker crashed: SIGABRT)",
    ]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 0 pass
       2 fail
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("prints each test's line under its own file's header", async () => {
    using dir = tempDir("parallel-output", {
      "a.test.js": `import {test,expect} from "bun:test";
        test("alpha-one",()=>expect(1).toBe(1));
        test("alpha-two",()=>expect(1).toBe(1));`,
      "b.test.js": `import {test,expect} from "bun:test";
        test("bravo-one",()=>expect(1).toBe(1));
        test("bravo-two",()=>expect(1).toBe(1));`,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"], scaleNow);

    // Two workers' result lines may interleave; the header is re-emitted on
    // every switch, so each line still sits under its own file's header.
    expect(resultsByFile(stderr)).toEqual({
      "a.test.js": ["(pass) alpha-one", "(pass) alpha-two"],
      "b.test.js": ["(pass) bravo-one", "(pass) bravo-two"],
    });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 4 pass
       0 fail
       4 expect() calls
      Ran 4 tests across 2 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("streams each result as the test finishes instead of buffering until the file is done", async () => {
    // Each file has a fast test and a test that parks until this process
    // writes `release`, which it does only after a fast result has shown up
    // on the coordinator's stderr. With per-file buffering nothing could show
    // up before a file finished, and no file can finish before the release.
    const fixture = (tag: string) => `${prelude}
      test("${tag}-fast", () => expect(1).toBe(1));
      test("${tag}-slow", async () => { await waitFor(() => exists("release")); }, T);`;
    using dir = tempDir("parallel-realtime", { "a.test.js": fixture("a"), "b.test.js": fixture("b") });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const decoder = new TextDecoder();
    let streamed = "";
    let seenBeforeRelease: string[] | undefined;
    for await (const chunk of proc.stderr) {
      streamed += decoder.decode(chunk, { stream: true });
      if (seenBeforeRelease === undefined && /^\(pass\) [ab]-fast/m.test(streamed)) {
        seenBeforeRelease = Object.values(resultsByFile(normalizeBunSnapshot(streamed))).flat();
        await Bun.write(`${dir}/release`, "");
      }
    }
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const stderr = normalizeBunSnapshot(streamed, String(dir));

    // Whatever had been printed by then came from tests whose file was still
    // running: the slow tests were all still parked.
    expect(seenBeforeRelease!.length).toBeGreaterThanOrEqual(1);
    expect(seenBeforeRelease!.filter(line => !line.endsWith("-fast"))).toEqual([]);
    expect(resultsByFile(stderr)).toEqual({
      "a.test.js": ["(pass) a-fast", "(pass) a-slow"],
      "b.test.js": ["(pass) b-fast", "(pass) b-slow"],
    });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 4 pass
       0 fail
       2 expect() calls
      Ran 4 tests across 2 files."
    `);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun test <version> (<revision>) 2x PARALLEL"`);
    expect(exitCode).toBe(0);
  });

  test("repeats the failures at the end of a long run", async () => {
    // 25+ tests make the reporter print the "N tests failed:" section after
    // the per-file output; the failure has to be carried over from its worker.
    const files: Record<string, string> = { "bad.test.js": failing("uniquefail") };
    const expected: Record<string, string[]> = { "bad.test.js": ["(fail) uniquefail"] };
    for (let i = 0; i < 24; i++) {
      files[`ok${i}.test.js`] = passing(`ok${i}`);
      expected[`ok${i}.test.js`] = [`(pass) ok${i}`];
    }
    using dir = tempDir("parallel-repeat", files);
    const { stderr, exitCode } = await run(dir, ["--parallel=4"]);

    const repeatAt = stderr.indexOf("\n1 tests failed:\n");
    expect(repeatAt).toBeGreaterThan(0);
    expect(resultsByFile(stderr.slice(0, repeatAt))).toEqual(expected);
    expect(stderr.slice(repeatAt + 1)).toMatchInlineSnapshot(`
      "1 tests failed:
      (fail) uniquefail

       24 pass
       1 fail
       25 expect() calls
      Ran 25 tests across 25 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("--reporter=junit merges every worker's suites into one report", async () => {
    using dir = tempDir("parallel-junit", {
      "a.test.js": passing("ta"),
      "b.test.js": passing("tb"),
      "c.test.js": failing("tc"),
    });
    const { exitCode } = await run(dir, ["--parallel=2", "--reporter=junit", "--reporter-outfile=out.xml"]);

    expect(normalizeJunit(await Bun.file(`${dir}/out.xml`).text())).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <testsuites name="bun test" tests="3" assertions="3" failures="1" skipped="0">
        <testsuite name="a.test.js" file="a.test.js" tests="1" assertions="1" failures="0" skipped="0">
          <testcase name="ta" classname="" file="a.test.js" assertions="1" />
        </testsuite>
        <testsuite name="b.test.js" file="b.test.js" tests="1" assertions="1" failures="0" skipped="0">
          <testcase name="tb" classname="" file="b.test.js" assertions="1" />
        </testsuite>
        <testsuite name="c.test.js" file="c.test.js" tests="1" assertions="1" failures="1" skipped="0">
          <testcase name="tc" classname="" file="c.test.js" assertions="1">
            <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">AssertionError: expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;&#10;</failure>
          </testcase>
        </testsuite>
      </testsuites>"
    `);
    expect(exitCode).toBe(1);
  });

  test("--reporter=junit keeps the suites a worker finished before it crashed", async () => {
    // Sorted, the four files split into [a-wait, b] for worker 1 and
    // [c-pass, z-crash] for worker 2. a-wait parks until z-crash has written
    // its pid, so worker 2 is the one that runs c-pass and then dies; c-pass
    // printing the same pid proves it. Its suite must survive the crash.
    using dir = tempDir("parallel-junit-crash", {
      "a-wait.test.js": `${prelude} test("wait for the crash", async () => { await waitFor(() => exists("crashed-pid")); }, T);`,
      "b.test.js": passing("b"),
      "c-pass.test.js": `import {test,expect} from "bun:test"; test("finished before the crash", () => { console.log("PID=" + process.pid); expect(1).toBe(1); });`,
      "z-crash.test.js": `import {test} from "bun:test"; test("boom", async () => { await Bun.write("crashed-pid", String(process.pid)); process.exit(7); });`,
    });
    const { stderr, exitCode } = await run(
      dir,
      ["--parallel=2", "--reporter=junit", "--reporter-outfile=out.xml"],
      scaleNow,
    );

    expect(stderr.match(/^PID=(\d+)$/m)![1]).toBe(await Bun.file(`${dir}/crashed-pid`).text());
    expect(normalizeJunit(await Bun.file(`${dir}/out.xml`).text())).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <testsuites name="bun test" tests="4" assertions="2" failures="1" skipped="0">
        <testsuite name="a-wait.test.js" file="a-wait.test.js" tests="1" assertions="0" failures="0" skipped="0">
          <testcase name="wait for the crash" classname="" file="a-wait.test.js" assertions="0" />
        </testsuite>
        <testsuite name="b.test.js" file="b.test.js" tests="1" assertions="1" failures="0" skipped="0">
          <testcase name="b" classname="" file="b.test.js" assertions="1" />
        </testsuite>
        <testsuite name="c-pass.test.js" file="c-pass.test.js" tests="1" assertions="1" failures="0" skipped="0">
          <testcase name="finished before the crash" classname="" file="c-pass.test.js" assertions="1" />
        </testsuite>
        <testsuite name="z-crash.test.js" file="z-crash.test.js" tests="1" assertions="0" failures="1" skipped="0">
          <testcase name="(worker crashed)" classname="z-crash.test.js">
            <failure message="worker process crashed before reporting results"></failure>
          </testcase>
        </testsuite>
      </testsuites>"
    `);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 3 pass
       1 fail
       2 expect() calls
      Ran 4 tests across 4 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("--reporter=junit carries a multi-megabyte per-file report intact over IPC", async () => {
    const cases = 4000;
    const pad = Buffer.alloc(240, "x").toString();
    using dir = tempDir("parallel-junit-large", {
      "big.test.js": `import {test,expect} from "bun:test";
        const pad = ${JSON.stringify(pad)};
        for (let i = 0; i < ${cases}; i++) test("big-" + i + "-" + pad, () => expect(1).toBe(1));`,
      "other.test.js": passing("other"),
    });
    const { stderr, exitCode } = await spawnTest(dir, [
      "--parallel=2",
      "--reporter=junit",
      "--reporter-outfile=out.xml",
    ]);

    const xml = await Bun.file(`${dir}/out.xml`).text();
    expect(xml.length).toBeGreaterThan(1024 * 1024);
    expect(xml.match(/<testcase name="big-(\d+)-x/g)).toHaveLength(cases);
    expect(xml).toContain('<testcase name="other"');
    expect(xml.match(/<\/?testsuites[ >]/g)).toEqual(["<testsuites ", "</testsuites>"]);
    expect(xml.match(/<testsuites [^>]*\btests="(\d+)"/)![1]).toBe(String(cases + 1));
    expect(stderr).toContain(`\n ${cases + 1} pass\n 0 fail\n`);
    expect(exitCode).toBe(0);
  });

  test("--reporter=junit gives a crashed file a suite of its own, so the totals add up", async () => {
    using dir = tempDir("parallel-junit-killed", {
      "ok.test.js": passing("ok"),
      "crash.test.js": `import {test} from "bun:test"; test("boom",()=>process.kill(process.pid, "SIGKILL"));`,
    });
    const { exitCode } = await run(dir, ["--parallel=2", "--reporter=junit", "--reporter-outfile=out.xml"], scaleNow);

    expect(normalizeJunit(await Bun.file(`${dir}/out.xml`).text())).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <testsuites name="bun test" tests="2" assertions="1" failures="1" skipped="0">
        <testsuite name="crash.test.js" file="crash.test.js" tests="1" assertions="0" failures="1" skipped="0">
          <testcase name="(worker crashed)" classname="crash.test.js">
            <failure message="worker process crashed before reporting results"></failure>
          </testcase>
        </testsuite>
        <testsuite name="ok.test.js" file="ok.test.js" tests="1" assertions="1" failures="0" skipped="0">
          <testcase name="ok" classname="" file="ok.test.js" assertions="1" />
        </testsuite>
      </testsuites>"
    `);
    expect(exitCode).toBe(1);
  });

  // Coverage fixtures: a and b park until both are running, so the two files
  // are guaranteed to run in two different workers and the coordinator really
  // has two coverage fragments to merge (one worker running both files would
  // pass these assertions without merging anything). Debug builds of bun
  // include test files in coverage by default; pin the release default so the
  // reports below are the same on both.
  const coverageBunfig = { "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n` };
  const covered = (name: string, imports: string, check: string) => `${prelude}
    ${imports}
    test("${name}", async () => {
      await Bun.write("gate/${name}", "");
      await waitFor(() => exists("gate/${name === "a" ? "b" : "a"}"));
      ${check}
    }, T);`;

  test("--coverage merges the workers' LCOV records", async () => {
    using dir = tempDir("parallel-coverage-lcov", {
      ...coverageBunfig,
      "shared.js": `export function hit() { return 1; }\nexport function miss() { return 2; }\n`,
      "only-a.js": `export function fa() { return 1; }\n`,
      "a.test.js": covered(
        "a",
        `import {hit} from "./shared.js"; import {fa} from "./only-a.js";`,
        `expect(hit() + fa()).toBe(2);`,
      ),
      "b.test.js": covered("b", `import {hit} from "./shared.js";`, `expect(hit()).toBe(1);`),
    });
    // Reference: one process loading shared.js once and calling hit() once,
    // which is exactly what each of the two workers above does with it.
    using single = tempDir("parallel-coverage-lcov-single", {
      ...coverageBunfig,
      "shared.js": `export function hit() { return 1; }\nexport function miss() { return 2; }\n`,
      "b.test.js": `import {test,expect} from "bun:test"; import {hit} from "./shared.js"; test("b", () => expect(hit()).toBe(1));`,
    });
    const coverage = ["--coverage", "--coverage-reporter=lcov", "--coverage-dir=./cov"];
    const [merged, reference] = await Promise.all([
      run(dir, ["--parallel=2", ...coverage], scaleNow),
      run(single, coverage),
    ]);
    expect(resultsByFile(merged.stderr)).toEqual({ "a.test.js": ["(pass) a"], "b.test.js": ["(pass) b"] });
    expect(merged.stderr).not.toContain("not yet aggregated");
    expect(reference.exitCode).toBe(0);

    const record = (lcov: string, file: string) =>
      lcov
        .split("end_of_record\n")
        .find(r => r.includes(`SF:${file}\n`))
        ?.trim() ?? `no record for ${file} in:\n${lcov}`;
    const lcov = await Bun.file(`${dir}/cov/lcov.info`).text();
    const referenceLcov = await Bun.file(`${single}/cov/lcov.info`).text();
    expect(lcov.match(/^SF:.*$/gm)).toEqual(["SF:only-a.js", "SF:shared.js"]);
    // Both workers executed shared.js the same way, so every merged DA hit
    // count is exactly double the reference's, while the function and line
    // totals (FNF/FNH/LF/LH) are recomputed rather than added.
    const doubled = record(referenceLcov, "shared.js").replace(
      /^DA:(\d+),(\d+)$/gm,
      (_, line, hits) => `DA:${line},${Number(hits) * 2}`,
    );
    expect(record(lcov, "shared.js")).toBe(doubled);
    // only-a.js was loaded by one worker, so its record passes through as is
    // (the hit count itself is an engine detail).
    expect(record(lcov, "only-a.js").replace(/^DA:1,[1-9]\d*$/m, "DA:1,<hits>")).toMatchInlineSnapshot(`
      "TN:
      SF:only-a.js
      FNF:1
      FNH:1
      DA:1,<hits>
      LF:1
      LH:1"
    `);
    expect(merged.exitCode).toBe(0);
  });

  test("--coverage prints one text table for all workers", async () => {
    using dir = tempDir("parallel-coverage-text", {
      ...coverageBunfig,
      "lib-a.js": `export function used() { return 1; }\nexport function unused() { return 2; }\n`,
      "lib-b.js": `export function go() { return 3; }\n`,
      "a.test.js": covered("a", `import {used} from "./lib-a.js";`, `expect(used()).toBe(1);`),
      "b.test.js": covered("b", `import {go} from "./lib-b.js";`, `expect(go()).toBe(3);`),
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--coverage", "--coverage-reporter=text"], scaleNow);

    expect(resultsByFile(stderr)).toEqual({ "a.test.js": ["(pass) a"], "b.test.js": ["(pass) b"] });
    const lines = stderr.split("\n").map(line => line.trimEnd());
    const table = lines.slice(
      lines.findIndex(l => l.startsWith("-----")),
      lines.findLastIndex(l => l.startsWith("-----")) + 1,
    );
    expect(table.join("\n")).toMatchInlineSnapshot(`
      "-----------|---------|---------|-------------------
      File       | % Funcs | % Lines | Uncovered Line #s
      -----------|---------|---------|-------------------
       lib-a.js  |   50.00 |  100.00 |
       lib-b.js  |  100.00 |  100.00 |
      All files  |   75.00 |  100.00 |
      -----------|---------|---------|-------------------"
    `);
    expect(exitCode).toBe(0);
  });

  test("--coverage enforces coverageThreshold with either reporter", async () => {
    // lib.js has one of three functions covered, far below the 0.9 threshold,
    // so both runs must fail even though every test passed. In particular the
    // lcov-only run: nothing is printed, so the exit code is the only signal.
    using dir = tempDir("parallel-coverage-threshold", {
      "bunfig.toml": `[test]\ncoverageThreshold = 0.9\ncoverageSkipTestFiles = true\n`,
      "lib.js": `export function used() { return 1; }\nexport function unused() { return 2; }\nexport function alsoUnused() { return 3; }\n`,
      "a.test.js": `import {test,expect} from "bun:test"; import {used} from "./lib.js"; test("a",()=>expect(used()).toBe(1));`,
      "b.test.js": `import {test,expect} from "bun:test"; import {used} from "./lib.js"; test("b",()=>expect(used()).toBe(1));`,
    });
    const runs = await Promise.all(
      (["lcov", "text"] as const).map(async reporter => {
        const { stderr, exitCode } = await run(dir, [
          "--parallel=2",
          "--coverage",
          `--coverage-reporter=${reporter}`,
          `--coverage-dir=./cov-${reporter}`,
        ]);
        return { reporter, results: resultsByFile(stderr), exitCode };
      }),
    );
    const results = { "a.test.js": ["(pass) a"], "b.test.js": ["(pass) b"] };
    expect(runs).toEqual([
      { reporter: "lcov", results, exitCode: 1 },
      { reporter: "text", results, exitCode: 1 },
    ]);
    expect(await Bun.file(`${dir}/cov-lcov/lcov.info`).text()).toContain("SF:lib.js\n");
  });

  test("--dots prints one character per test and a full line per failure", async () => {
    using dir = tempDir("parallel-dots", {
      "a.test.js": `import {test,expect} from "bun:test";
        test("a1",()=>expect(1).toBe(1));
        test("a2",()=>expect(1).toBe(1));
        test.skip("a3",()=>{});
        test("a4",()=>expect(1).toBe(2));`,
      "b.test.js": `import {test,expect} from "bun:test";
        test("b1",()=>expect(1).toBe(1));
        test("b2",()=>expect(1).toBe(1));
        test("b3",()=>expect(1).toBe(1));
        test("b4",()=>expect(1).toBe(1));`,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--dots"]);

    // 6 passes + 1 skip are dots (runs of dots from the two workers may be
    // joined or split across lines); the failure is the only status line, and
    // a.test.js is the only file that gets a header because of it.
    expect((stderr.match(/^\.+$/gm) ?? []).join("")).toHaveLength(7);
    expect(resultsByFile(stderr)).toEqual({ "a.test.js": ["(fail) a4"] });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      "6 pass
      1 skip
      1 fail
      7 expect() calls
      Ran 8 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("never interleaves console output of one file with another's", async () => {
    // Test i of each file logs a marker and then parks until the other file's
    // test i has logged its marker too, so both files' output is in flight at
    // the same moment in both workers. Output is still printed in per-test
    // blocks under the right header: it is buffered per test and flushed with
    // that test's result line.
    const fixture = (tag: string, other: string) => `${prelude}
      console.error("PID-${tag}=" + process.pid);
      for (let i = 0; i < 3; i++) test("${tag}" + i, async () => {
        console.error("MARK-${tag}-" + i);
        await Bun.write("gate/${tag}-" + i, "");
        await waitFor(() => exists("gate/${other}-" + i));
      }, T);`;
    using dir = tempDir("parallel-no-interleave", { "a.test.js": fixture("a", "b"), "b.test.js": fixture("b", "a") });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"], scaleNow);

    expect(resultsByFile(stderr, /^(?:MARK-|\(pass\) |PID-)/)).toEqual({
      "a.test.js": [
        "(pass) a0",
        "(pass) a1",
        "(pass) a2",
        "MARK-a-0",
        "MARK-a-1",
        "MARK-a-2",
        expect.stringMatching(/^PID-a=\d+$/),
      ],
      "b.test.js": [
        "(pass) b0",
        "(pass) b1",
        "(pass) b2",
        "MARK-b-0",
        "MARK-b-1",
        "MARK-b-2",
        expect.stringMatching(/^PID-b=\d+$/),
      ],
    });
    const [pidA, pidB] = [/^PID-a=(\d+)$/m, /^PID-b=(\d+)$/m].map(re => stderr.match(re)![1]);
    expect(pidA).not.toBe(pidB);
    // A marker is followed by its own test's result line (or, if the worker's
    // pipe was read after its result frame, by the rest of that file's block),
    // never by the other file's marker.
    const lines = stderr.split("\n");
    const followers = lines.flatMap((line, i) => (line.startsWith("MARK-") ? [`${line} -> ${lines[i + 1]}`] : []));
    expect(followers.filter(f => !/^MARK-(\w)-\d -> (?:\(pass\) \1|MARK-\1|$)/.test(f))).toEqual([]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 6 pass
       0 fail
      Ran 6 tests across 2 files."
    `);
    expect(exitCode).toBe(0);
  });

  // Workers start lazily: only the first one is spawned up front, and the rest
  // only once every running worker has been busy for the scale-up delay
  // (--parallel-delay / BUN_TEST_PARALLEL_SCALE_MS). Each fixture prints its
  // worker's pid, so the number of distinct pids is the number of workers used.
  test("stays on one worker while every file finishes within the scale-up delay", async () => {
    const fixture = `import {test} from "bun:test"; test("t", () => console.error("PID=" + process.pid));`;
    using dir = tempDir("parallel-lazy-fast", {
      "a.test.js": fixture,
      "b.test.js": fixture,
      "c.test.js": fixture,
      "d.test.js": fixture,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=4"], { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "60000" });

    const pids = [...stderr.matchAll(/^PID=(\d+)$/gm)].map(m => m[1]);
    expect(pids).toHaveLength(4);
    expect(new Set(pids).size).toBe(1);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 4 pass
       0 fail
      Ran 4 tests across 4 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("scales up once a file outlasts the (default) scale-up delay", async () => {
    // Every file parks until a second worker has started a file, so the run
    // can only finish if the first file's busy time triggered the scale-up.
    const fixture = `${prelude}
      test("t", async () => {
        console.error("PID=" + process.pid);
        await Bun.write("gate/" + process.pid, "");
        await waitFor(async () => (await arrived("gate")) >= 2);
      }, T);`;
    using dir = tempDir("parallel-lazy-slow", {
      "a.test.js": fixture,
      "b.test.js": fixture,
      "c.test.js": fixture,
      "d.test.js": fixture,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=4"]);

    const pids = [...stderr.matchAll(/^PID=(\d+)$/gm)].map(m => m[1]);
    expect(pids).toHaveLength(4);
    // How many of the other three workers get a file before the first two
    // release the rest depends on boot timing, so only the lower bound is exact.
    expect(new Set(pids).size).toBeGreaterThanOrEqual(2);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 4 pass
       0 fail
      Ran 4 tests across 4 files."
    `);
    expect(exitCode).toBe(0);
  });

  // Files are sorted and split into one contiguous range per worker, so files
  // from the same directory land in the same process; a worker dispatches its
  // range front to back and, once it is empty, steals the back half of the
  // largest range left (including that of a worker that has not started yet).
  const row = `console.error("ROW=" + process.pid + " " + import.meta.file);`;
  const rows = (stderr: string) => [...stderr.matchAll(/^ROW=(\d+) (\S+)$/gm)].map(m => ({ pid: m[1], file: m[2] }));

  test("partitions the sorted files by range, one directory per worker here", async () => {
    // 4 directories x 4 files, K=4: each worker's range is one directory. Every
    // file parks until all four workers have started one, so no worker can run
    // out of its own range and steal before every worker has shown which file
    // it started with: that file has to be the first of its own directory.
    const fixture = `${prelude}
      test("t", async () => {
        ${row}
        await Bun.write("gate/" + process.pid, "");
        await waitFor(async () => (await arrived("gate")) >= 4);
      }, T);`;
    const files: Record<string, string> = {};
    for (const d of ["a", "b", "c", "d"]) for (let i = 0; i < 4; i++) files[`${d}/${d}${i}.test.js`] = fixture;
    using dir = tempDir("parallel-affinity", files);
    const { stderr, exitCode } = await run(dir, ["--parallel=4"], scaleNow);

    const all = rows(stderr);
    expect(all).toHaveLength(16);
    const firstFileByPid = new Map<string, string>();
    for (const r of all) if (!firstFileByPid.has(r.pid)) firstFileByPid.set(r.pid, r.file);
    expect([...firstFileByPid.values()].sort()).toEqual(["a0.test.js", "b0.test.js", "c0.test.js", "d0.test.js"]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 16 pass
       0 fail
      Ran 16 tests across 16 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("a worker drains its own range first, then steals from the back of another's", async () => {
    // K=2 splits [a, b, c, d] into [a, b] and [c, d]; with scale-up disabled the
    // only worker runs its own range, then steals d (the back half of [c, d]),
    // then c, so the file headers come out in exactly that order.
    using dir = tempDir("parallel-steal-order", {
      "a.test.js": passing("a"),
      "b.test.js": passing("b"),
      "c.test.js": passing("c"),
      "d.test.js": passing("d"),
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--parallel-delay=1000000"]);

    expect(stderr.match(/^\S+\.test\.js:$/gm)).toEqual(["a.test.js:", "b.test.js:", "d.test.js:", "c.test.js:"]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 4 pass
       0 fail
       4 expect() calls
      Ran 4 tests across 4 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("work stealing rebalances an uneven split", async () => {
    // 8 files under a/ and one each under b/, c/, d/ sort to a0..a7, b0, c0, d0;
    // K=4 makes the ranges [a0,a1] [a2,a3,a4] [a5,a6,a7] [b0,c0,d0]. The fast
    // files record their worker's pid; every a/ file parks until an a/ file has
    // run on that worker (that run is the steal, and it writes `stolen`), so
    // the run can only complete if the worker that drained the fast range
    // stole from an a/ range.
    const slow = `${prelude}
      test("t", async () => {
        ${row}
        const fastPid = (await exists("fast-pid")) ? await Bun.file("fast-pid").text() : "";
        if (fastPid === String(process.pid)) await Bun.write("stolen", import.meta.file);
        else await waitFor(() => exists("stolen"));
      }, T);`;
    const fast = `import {test} from "bun:test";
      test("t", async () => { ${row} await Bun.write("fast-pid", String(process.pid)); });`;
    const files: Record<string, string> = { "b/b0.test.js": fast, "c/c0.test.js": fast, "d/d0.test.js": fast };
    for (let i = 0; i < 8; i++) files[`a/a${i}.test.js`] = slow;
    using dir = tempDir("parallel-steal", files);
    const { stderr, exitCode } = await run(dir, ["--parallel=4"], scaleNow);

    const all = rows(stderr);
    const fastPid = await Bun.file(`${dir}/fast-pid`).text();
    const stolen = await Bun.file(`${dir}/stolen`).text();
    expect(stolen).toMatch(/^a\d\.test\.js$/);
    // The whole fast range ran on one worker, and that worker also ran the stolen a/ file.
    expect(all.filter(r => r.pid === fastPid).map(r => r.file)).toEqual(
      expect.arrayContaining(["b0.test.js", "c0.test.js", "d0.test.js", stolen]),
    );
    expect(all.map(r => r.file).sort()).toEqual(
      Object.keys(files)
        .map(f => f.slice(2))
        .sort(),
    );
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 11 pass
       0 fail
      Ran 11 tests across 11 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("writes new snapshots from every worker", async () => {
    const snap = (n: number) =>
      `import {test,expect} from "bun:test"; test("snap",()=>expect("value-${n}").toMatchSnapshot());`;
    using dir = tempDir("parallel-snapshots", {
      "a.test.js": snap(1),
      "b.test.js": snap(2),
      "c.test.js": snap(3),
      "d.test.js": snap(4),
    });
    const env = { ...scaleNow, CI: "false" };
    const results = {
      "a.test.js": ["(pass) snap"],
      "b.test.js": ["(pass) snap"],
      "c.test.js": ["(pass) snap"],
      "d.test.js": ["(pass) snap"],
    };

    // Snapshots are normally flushed when the next file opens its own snapshot
    // file; whichever file a worker runs last relies on the flush before exit.
    const first = await run(dir, ["--parallel=4", "--update-snapshots"], env);
    expect(resultsByFile(first.stderr)).toEqual(results);
    expect(first.exitCode).toBe(0);
    const written = await Promise.all(
      [1, 2, 3, 4].map(n => Bun.file(`${dir}/__snapshots__/${"abcd"[n - 1]}.test.js.snap`).text()),
    );
    expect(written).toEqual(
      [1, 2, 3, 4].map(
        n => `// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[\`snap 1\`] = \`"value-${n}"\`;\n`,
      ),
    );

    // A second run must pass against what the first one wrote.
    const second = await run(dir, ["--parallel=4"], env);
    expect(resultsByFile(second.stderr)).toEqual(results);
    expect(summaryOf(second.stderr)).toMatchInlineSnapshot(`
      " 4 pass
       0 fail
       4 expect() calls
      Ran 4 tests across 4 files."
    `);
    expect(second.exitCode).toBe(0);
  });

  test("a result line over the 64MB IPC frame limit is truncated, not treated as a crash", async () => {
    // The test name alone exceeds the frame limit, so the status line does
    // too. The encoder has to truncate it; dropping the channel would mark the
    // whole file as crashed.
    using dir = tempDir("parallel-huge-frame", {
      "huge.test.js": `import {test,expect} from "bun:test"; test(Buffer.alloc(68_000_000, "X").toString(),()=>expect(1).toBe(2));`,
      "ok.test.js": passing("ok"),
    });
    const { stdout, stderr, exitCode } = await spawnTest(dir, ["--parallel=2"], scaleNow);

    expect(stdout).toContain("PARALLEL");
    expect(stderr).not.toContain("crashed");
    expect(stderr).toContain("[output truncated:");
    expect(stderr).toContain("(pass) ok");
    expect(stderr).toContain("\n 1 pass\n 1 fail\n");
    expect(exitCode).toBe(1);
  });

  test("back-to-back huge result lines drain in linear time without corrupting the channel", async () => {
    // Two status lines just under the 64MB frame cap from the same worker:
    // the second frame is queued while the first backlog is still draining,
    // which exercises the write cursor, the amortized compaction, and
    // appending to a partially-sent backlog. The 60s kill is the regression
    // signal: draining by memmoving the whole remainder after every partial
    // write is quadratic in the frame size, and on macOS (~8KB socketpair
    // buffers) one 64MB frame alone took ~90s of memmove.
    const TITLE_LENGTH = 60_000_000;
    using dir = tempDir("parallel-huge-backlog", {
      "huge.test.js": `import {test,expect} from "bun:test";
          test(Buffer.alloc(${TITLE_LENGTH}, "A").toString(), () => expect(1).toBe(2));
          test(Buffer.alloc(${TITLE_LENGTH}, "B").toString(), () => expect(1).toBe(2));`,
      "ok.test.js": passing("ok"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2"],
      env: scaleNow,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("PARALLEL");
    expect(stderr).not.toContain("crashed");
    // Each title must arrive as one contiguous run of exactly TITLE_LENGTH
    // characters: dropped bytes leave indexOf at -1, duplicated bytes put the
    // title's letter right after the first match. Index math keeps a failure
    // from dumping 60MB strings into the log.
    for (const letter of ["A", "B"]) {
      const start = stderr.indexOf(Buffer.alloc(TITLE_LENGTH, letter).toString());
      expect(start).toBeGreaterThanOrEqual(0);
      expect(stderr[start + TITLE_LENGTH]).not.toBe(letter);
    }
    expect(stderr).toContain("(pass) ok");
    expect(stderr).toContain("\n 1 pass\n 2 fail\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  }, 90_000);

  test("a test writing garbage to the IPC fd gets its worker killed without hanging the coordinator", async () => {
    using dir = tempDir("parallel-hostile-fd3", {
      "ok.test.js": passing("ok"),
      "bad.test.js": `import {test} from "bun:test"; import {writeSync} from "fs";
        test("bad",()=>{ writeSync(3, Buffer.from([0xff,0xff,0xff,0xff,0x42])); });`,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2"], scaleNow);

    // bad.test.js's worker is killed as soon as its channel turns to garbage
    // and, like any crash, is not retried; ok.test.js still passes.
    expect(resultsByFile(stderr)).toEqual({ "ok.test.js": ["(pass) ok"] });
    expect(stderr.match(/^\S+ bad\.test\.js \(.*$/gm)).toEqual([
      isWindows ? expect.stringContaining("bad.test.js (worker crashed: ") : "✗ bad.test.js (worker crashed: SIGKILL)",
    ]);
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 1 pass
       1 fail
       1 expect() calls
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("--randomize without --seed is reproducible via the printed seed", async () => {
    const fixture = (tag: string) =>
      `import {test,expect} from "bun:test";\n` +
      [..."abcdefgh"].map(n => `test("${n}",()=>{console.error("ORDER:${tag}:${n}");expect(1).toBe(1);});`).join("\n");
    using dir = tempDir("parallel-randomize-seed", { "a.test.ts": fixture("a"), "b.test.ts": fixture("b") });

    const shuffled = async (extra: string[]) => {
      const { stderr, exitCode } = await run(
        dir,
        ["--parallel=2", "--randomize", ...extra, "./a.test.ts", "./b.test.ts"],
        scaleNow,
      );
      expect(exitCode).toBe(0);
      const order = (tag: string) =>
        [...stderr.matchAll(new RegExp(`^ORDER:${tag}:(\\w)$`, "gm"))].map(m => m[1]).join("");
      return { a: order("a"), b: order("b"), seed: stderr.match(/^ --seed=(\d+)$/m)?.[1], summary: summaryOf(stderr) };
    };

    const first = await shuffled([]);
    expect(first.summary.replace(first.seed!, "<seed>")).toMatchInlineSnapshot(`
      " --seed=<seed>
       16 pass
       0 fail
       16 expect() calls
      Ran 16 tests across 2 files."
    `);
    expect([...first.a].sort().join("")).toBe("abcdefgh");
    expect([...first.b].sort().join("")).toBe("abcdefgh");

    // Replaying the printed seed reproduces the order within each file exactly.
    const second = await shuffled([`--seed=${first.seed}`]);
    expect(second).toEqual(first);
  });

  test("forwards --experimental-http2-fetch to the workers", async () => {
    // Workers rewrite their argv to look like `bun <file>`, so assert the
    // effect: an h2-only server (allowHTTP1: false) answers 200 only when the
    // worker's fetch offered h2 via ALPN; without the flag it gets 403
    // "Missing ALPN Protocol". The second file only makes it a parallel run.
    using dir = tempDir("parallel-h2-flag", {
      "h2.test.js": `import {test,expect} from "bun:test";
        import {createSecureServer} from "node:http2";
        import {once} from "node:events";
        test("h2", async () => {
          const {key, cert} = JSON.parse(process.env.H2_TLS);
          const server = createSecureServer({key, cert, allowHTTP1: false}, (req, res) => res.end(req.httpVersion));
          server.listen(0); await once(server, "listening");
          try {
            const res = await fetch("https://localhost:" + server.address().port, {tls: {rejectUnauthorized: false}});
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("2.0");
          } finally { server.close(); }
        });`,
      "plain.test.js": passing("plain"),
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--experimental-http2-fetch"], {
      ...scaleNow,
      H2_TLS: JSON.stringify(tls),
    });

    expect(resultsByFile(stderr)).toEqual({ "h2.test.js": ["(pass) h2"], "plain.test.js": ["(pass) plain"] });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 2 pass
       0 fail
       3 expect() calls
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("forwards --conditions to the workers", async () => {
    using dir = tempDir("parallel-conditions", {
      "node_modules/condpkg/package.json": JSON.stringify({
        name: "condpkg",
        exports: { ".": { development: "./dev.js", default: "./prod.js" } },
      }),
      "node_modules/condpkg/dev.js": `export const variant = "dev";`,
      "node_modules/condpkg/prod.js": `export const variant = "prod";`,
      "a.test.ts": `import {test,expect} from "bun:test"; import {variant} from "condpkg"; test("a",()=>expect(variant).toBe("dev"));`,
      "b.test.ts": `import {test,expect} from "bun:test"; import {variant} from "condpkg"; test("b",()=>expect(variant).toBe("dev"));`,
    });
    const { stderr, exitCode } = await run(dir, ["--parallel=2", "--conditions=development"], scaleNow);

    expect(resultsByFile(stderr)).toEqual({ "a.test.ts": ["(pass) a"], "b.test.ts": ["(pass) b"] });
    expect(summaryOf(stderr)).toMatchInlineSnapshot(`
      " 2 pass
       0 fail
       2 expect() calls
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("SIGTERM on the coordinator kills the workers and their grandchildren", async () => {
    // Each worker spawns a grandchild; both record their pid as a file in
    // pids/ and then stay alive (bounded, so a failing run cannot leak them
    // for long). Workers run in their own process group, which is what the
    // coordinator's signal handler kills.
    const fixture = `import { test } from "bun:test";
      test("stay busy", async () => {
        Bun.spawn({ cmd: [process.execPath, "grandchild.js"], stdout: "ignore", stderr: "ignore" });
        await Bun.write("pids/worker-" + process.pid, "");
        await Bun.sleep(30_000);
      }, 60_000);`;
    using dir = tempDir("parallel-deathsig", {
      "a.test.ts": fixture,
      "b.test.ts": fixture,
      "grandchild.js": `await Bun.write("pids/grandchild-" + process.pid, ""); setTimeout(() => {}, 30_000);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2"],
      env: scaleNow,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });

    const recorded = () => {
      let names: string[] = [];
      try {
        names = readdirSync(`${dir}/pids`);
      } catch {}
      const pidsOf = (kind: string) =>
        names.filter(n => n.startsWith(`${kind}-`)).map(n => Number(n.slice(kind.length + 1)));
      return { workers: pidsOf("worker"), grandchildren: pidsOf("grandchild") };
    };
    const deadline = Date.now() + parkMs;
    let tree = recorded();
    while ((tree.workers.length < 2 || tree.grandchildren.length < 2) && Date.now() < deadline) {
      await Bun.sleep(10);
      tree = recorded();
    }
    expect(tree).toEqual({
      workers: [expect.any(Number), expect.any(Number)],
      grandchildren: [expect.any(Number), expect.any(Number)],
    });

    proc.kill("SIGTERM");
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // POSIX: the coordinator's handler reports what was interrupted and exits
    // 130 itself. On Windows kill() terminates the coordinator outright and the
    // kill-on-close job object is what takes the workers down.
    if (!isWindows) {
      expect(normalizeBunSnapshot(stderr).replace(/\(\d+s\)/g, "(<n>s)")).toMatchInlineSnapshot(`
        "Interrupted while still running:
          a.test.ts (<n>s)
          b.test.ts (<n>s)"
      `);
      expect(exitCode).toBe(130);
    }

    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const descendants = [...tree.workers, ...tree.grandchildren];
    const gone = Date.now() + parkMs;
    let outstanding = descendants.filter(alive);
    while (outstanding.length > 0 && Date.now() < gone) {
      await Bun.sleep(10);
      outstanding = descendants.filter(alive);
    }
    expect(outstanding).toEqual([]);
  });

  test("--no-isolate keeps one global and one module registry per worker", async () => {
    const files: Record<string, string> = { "shared.ts": `export let count = 0; export const bump = () => ++count;` };
    for (const f of ["a", "b", "c"]) {
      files[`${f}.test.ts`] =
        `import {test,expect} from "bun:test"; import {bump} from "./shared"; test("${f}", () => { console.log("COUNT " + bump() + " G " + ((globalThis as any).__g ??= "${f}")); });`;
    }
    using dir = tempDir("parallel-no-isolate", files);
    // With scale-up effectively disabled one worker runs all three files, so
    // whether state carries over between files is observable.
    const args = ["--parallel=2", "--parallel-delay=1000000"];
    const [isolated, shared] = await Promise.all([run(dir, args), run(dir, [...args, "--no-isolate"])]);
    const keep = /^(?:COUNT |\(pass\) )/;

    // Default (--isolate): every file starts from a fresh registry and global.
    expect(resultsByFile(isolated.stderr, keep)).toEqual({
      "a.test.ts": ["(pass) a", "COUNT 1 G a"],
      "b.test.ts": ["(pass) b", "COUNT 1 G b"],
      "c.test.ts": ["(pass) c", "COUNT 1 G c"],
    });
    expect(summaryOf(isolated.stderr)).toMatchInlineSnapshot(`
      " 3 pass
       0 fail
      Ran 3 tests across 3 files."
    `);
    expect(isolated.exitCode).toBe(0);

    // --no-isolate: the counter keeps climbing across files (one registry) and
    // every file sees the global the first one set, whichever file that was.
    const counts = [...shared.stderr.matchAll(/^COUNT (\d) G (\w)$/gm)];
    expect(counts.map(m => m[1])).toEqual(["1", "2", "3"]);
    expect(new Set(counts.map(m => m[2])).size).toBe(1);
    expect(resultsByFile(shared.stderr)).toEqual({
      "a.test.ts": ["(pass) a"],
      "b.test.ts": ["(pass) b"],
      "c.test.ts": ["(pass) c"],
    });
    expect(summaryOf(shared.stderr)).toMatchInlineSnapshot(`
      " 3 pass
       0 fail
      Ran 3 tests across 3 files."
    `);
    expect(shared.exitCode).toBe(0);
  });
});
