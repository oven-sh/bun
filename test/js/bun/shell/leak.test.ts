import { $ } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isPosix, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "path";
import { createTestBuilder } from "./util";
const TestBuilder = createTestBuilder(import.meta.path);
type TestBuilder = InstanceType<typeof TestBuilder>;

$.env(bunEnv);
$.cwd(process.cwd());
$.nothrow();

// Every leak these tests guard against costs at least one unit (fd, JS object,
// protected object) per run, so a leak puts RUNS units on the detector. The
// bounds below allow for legitimate residue: heapStats() counts each class's
// prototype (so ShellInterpreter and ParsedShellScript read 1 each once a script
// has run, and never less), the last run's objects can stay conservatively
// rooted through Bun.gc(true), and an interpreter that has not been finalized
// yet can still hold an fd or two. 100 runs puts a one-unit-per-run leak at 20x
// the fd bound and 33x the object bound.
const RUNS = 100;
const WARMUP_RUNS = 1;
const FD_LEAK_BOUND = 5;
const MAX_SHELL_OBJECTS = 3;
// Bound on RSS growth across the measured runs (11-56 MB measured under ASAN,
// less without it). ASAN's quarantine keeps freed allocations resident
// (256 MB by default), so the bound is wider under bun-asan.
const MAX_RSS_GROWTH = (isASAN ? 350 : process.platform === "darwin" ? 100 : 150) * (1 << 20);

const TESTS: [name: string, builder: () => TestBuilder][] = [
  ["redirect_file", () => TestBuilder.command`echo hello > test.txt`.fileEquals("test.txt", "hello\n")],
  ["change_cwd", () => TestBuilder.command`cd ${TestBuilder.tmpdir()} && cd -`],
  ["pipeline", () => TestBuilder.command`echo hi | cat`.stdout("hi\n")],
  ["pipeline2", () => TestBuilder.command`echo hi | echo lol | cat`.stdout("lol\n")],
  [
    "ls",
    () =>
      TestBuilder.command`mkdir foo; touch ./foo/lol ./foo/nice ./foo/lmao; mkdir foo/bar; touch ./foo/bar/great; touch ./foo/bar/wow; ls -R foo/`
        .ensureTempDir()
        .stdout(stdout =>
          expect(
            stdout
              .split("\n")
              .filter(s => s.length > 0)
              .sort(),
          ).toEqual(["lmao", "lol", "nice", "foo/bar:", "bar", "great", "wow"].sort()),
        ),
  ],
  [
    "rm",
    () =>
      TestBuilder.command`mkdir foo; touch ./foo/lol ./foo/nice ./foo/lmao; mkdir foo/bar; touch ./foo/bar/great; touch ./foo/bar/wow; rm -rfv foo/`
        .ensureTempDir()
        .stdout(stdout =>
          expect(
            stdout
              .split("\n")
              .filter(s => s.length > 0)
              .sort(),
          ).toEqual(["foo/", "foo/bar", "foo/bar/great", "foo/bar/wow", "foo/lmao", "foo/lol", "foo/nice"].sort()),
        ),
  ],
];

const testBuilderSource = readFileSync(join(import.meta.dirname, "test_builder.ts"), "utf8");

/** The builders above are never called here; their source text becomes the body of a child process. */
function snippet(builder: () => TestBuilder): string {
  return builder.toString().slice("() =>".length);
}

/**
 * Spawns a bun that runs `once` (source of an expression evaluating to a
 * promise) WARMUP_RUNS times, so lazily-initialized state is not attributed to
 * the measured runs, and then hands `measure` (source of an async function) a
 * `run` callback that performs the `runs` measured executions. Whatever
 * `measure` returns is printed as JSON and returned here.
 *
 * Helpers available to `measure`: fdCount(), shellObjectCounts(),
 * protectedObjectCounts() and settle(sample, ok), which samples after a full GC
 * on successive event loop turns until `ok` accepts the sample (or 50 turns
 * pass) and returns the last sample: a dead interpreter can stay visible to
 * heapStats for a turn, a real leak never goes away.
 *
 * Every child also reports how many ShellInterpreter cells exist when it is
 * done. The class prototype is created the first time a script executes, so
 * this is 0 exactly when the snippet never reached the shell, which is how an
 * earlier version of this file passed while its children ran nothing.
 */
async function runChild(
  name: string,
  { once, measure, runs }: { once: string; measure: string; runs: number },
): Promise<{ result: any; exitCode: number }> {
  const script = /* ts */ `
    ${testBuilderSource}
    import { heapStats } from "bun:jsc";
    import { closeSync, openSync, readdirSync } from "node:fs";
    import { devNull } from "node:os";
    const { expect } = Bun.jest(import.meta.path);
    const TestBuilder = createTestBuilder(import.meta.path);

    function fdCount(): number {
      if (process.platform === "darwin" || process.platform === "linux") {
        return readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").length;
      }
      const fd = openSync(devNull, "r");
      closeSync(fd);
      return fd;
    }
    function shellObjectCounts() {
      const counts = heapStats().objectTypeCounts;
      return { ShellInterpreter: counts.ShellInterpreter ?? 0, ParsedShellScript: counts.ParsedShellScript ?? 0 };
    }
    function protectedObjectCounts(): Record<string, number> {
      return heapStats().protectedObjectTypeCounts;
    }
    async function settle<T>(sample: () => T, ok: (value: T) => boolean): Promise<T> {
      for (let turn = 0; ; turn++) {
        Bun.gc(true);
        const value = sample();
        if (ok(value) || turn === 50) return value;
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    async function runTimes(n: number) {
      for (let i = 0; i < n; i++) await (${once});
    }

    await runTimes(${WARMUP_RUNS});
    Bun.gc(true);
    const result = await (${measure})(() => runTimes(${runs}));
    console.log(JSON.stringify({ result, shellInterpreters: shellObjectCounts().ShellInterpreter }));
  `;
  // The child's cwd and tmpdir both point here, so whatever the snippets create
  // (TestBuilder.tmpdir() makes a fresh directory per run) is removed with it.
  using dir = tempDir(`shell-leak-${name}`, { "child.ts": script });
  const cwd = String(dir);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "run", "child.ts"],
    cwd,
    env: { ...bunEnv, TMPDIR: cwd, TMP: cwd, TEMP: cwd },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\{.*\}\n$/);
  const { result, shellInterpreters } = JSON.parse(stdout);
  expect(shellInterpreters).toBeGreaterThanOrEqual(1);
  return { result, exitCode };
}

describe.concurrent("fd leak", () => {
  function fdLeakTest(name: string, builder: () => TestBuilder) {
    test(`fdleak_${name}`, async () => {
      const { result, exitCode } = await runChild(`fd-${name}`, {
        once: `${snippet(builder)}.quiet().run()`,
        runs: RUNS,
        measure: /* ts */ `async (run) => {
          const baseline = fdCount();
          await run();
          // An interpreter closes the fds it still owns when it is finalized.
          const leakedFds = await settle(() => fdCount() - baseline, leaked => leaked <= ${FD_LEAK_BOUND});
          return { leakedFds };
        }`,
      });
      expect(result.leakedFds).toBeLessThanOrEqual(FD_LEAK_BOUND);
      expect(exitCode).toBe(0);
    });
  }

  function memLeakTest(name: string, builder: () => TestBuilder) {
    test(`memleak_${name}`, async () => {
      const { result, exitCode } = await runChild(`mem-${name}`, {
        once: `${snippet(builder)}.quiet().run()`,
        runs: RUNS,
        measure: /* ts */ `async (run) => {
          const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
          const rssBefore = rss();
          await run();
          const counts = await settle(
            shellObjectCounts,
            ({ ShellInterpreter, ParsedShellScript }) =>
              ShellInterpreter <= ${MAX_SHELL_OBJECTS} && ParsedShellScript <= ${MAX_SHELL_OBJECTS},
          );
          // Growth from the baseline is a leak; a drop is the allocator handing
          // memory back (the idle sweep does this on purpose).
          return { rssGrowth: rss() - rssBefore, ...counts };
        }`,
      });
      expect(result.ShellInterpreter).toBeLessThanOrEqual(MAX_SHELL_OBJECTS);
      expect(result.ParsedShellScript).toBeLessThanOrEqual(MAX_SHELL_OBJECTS);
      expect(result.rssGrowth).toBeLessThan(MAX_RSS_GROWTH);
      expect(exitCode).toBe(0);
    });
  }

  TESTS.forEach(args => {
    fdLeakTest(...args);
    memLeakTest(...args);
  });

  // The child script (test_builder.ts plus the harness above) is far bigger than
  // the 128 byte redirect targets.
  memLeakTest("ArrayBuffer", () => TestBuilder.command`cat ${import.meta.filename} > ${new ArrayBuffer(128)}`);
  memLeakTest("Buffer", () => TestBuilder.command`cat ${import.meta.filename} > ${Buffer.alloc(128)}`);
  memLeakTest("Blob_something", () =>
    TestBuilder.command`cat < ${new Blob([Buffer.alloc(128 * 1024, "a").toString()])}`.stdout(str =>
      expect(str).toEqual(Buffer.alloc(128 * 1024, "a").toString()),
    ),
  );
  memLeakTest("Blob_nothing", () =>
    TestBuilder.command`echo hi < ${new Blob([Buffer.alloc(128 * 1024, "a").toString()])}`.stdout("hi\n"),
  );
  memLeakTest("String", () => TestBuilder.command`echo ${Buffer.alloc(4096, "a").toString()}`.stdout(() => {}));

  /**
   * The shell pins a JS redirect target for as long as the command runs: one
   * reference per redirected stream (`&>` takes two) for both builtins and
   * subprocesses, and a builtin also pins a `< ${buffer}` stdin (a subprocess
   * copies it). heapStats() reports the pinned objects in
   * protectedObjectTypeCounts under their JSC class name (a Buffer is a
   * Uint8Array there; a string argument is copied and never appears), so the
   * whole table is compared before and after instead of looking up one class.
   *
   * `echo` and `cd` are builtins everywhere; `cat` is the system binary on
   * POSIX and the builtin on Windows, so the `cat` snippets cover the
   * subprocess paths on the POSIX lanes and the builtin paths on Windows.
   * Output redirected into `val` leaves stdout empty, which is what TestBuilder
   * expects unless a snippet says otherwise.
   */
  function memLeakTestProtect(
    name: string,
    constructStmt: string,
    builder: string,
    posixOnly: boolean = false,
    runs: number = 5,
  ) {
    test.if(!posixOnly || isPosix)(`memleak_protect_${name}`, async () => {
      const { result, exitCode } = await runChild(`protect-${name}`, {
        once: /* ts */ `(async () => {
          const val = ${constructStmt};
          await ${builder}.quiet().run();
        })()`,
        runs,
        measure: /* ts */ `async (run) => {
          const before = protectedObjectCounts();
          await run();
          const after = await settle(protectedObjectCounts, after => Bun.deepEquals(after, before));
          return { before, after };
        }`,
      });
      expect(result.after).toEqual(result.before);
      expect(exitCode).toBe(0);
    });
  }

  // The child script is far bigger than these 64 byte targets.
  memLeakTestProtect("ArrayBuffer", "new ArrayBuffer(64)", "TestBuilder.command`cat ${import.meta.filename} > ${val}`");
  memLeakTestProtect("Buffer", "Buffer.alloc(64)", "TestBuilder.command`cat ${import.meta.filename} > ${val}`");
  memLeakTestProtect(
    "ArrayBuffer_builtin",
    "new ArrayBuffer(64)",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "Buffer_builtin",
    "Buffer.alloc(64)",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );

  memLeakTestProtect("Uint8Array", "new Uint8Array(64)", "TestBuilder.command`cat ${import.meta.filename} > ${val}`");
  memLeakTestProtect(
    "Uint8Array_builtin",
    "new Uint8Array(64)",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );

  memLeakTestProtect(
    "DataView",
    "new DataView(new ArrayBuffer(64))",
    "TestBuilder.command`cat ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "DataView_builtin",
    "new DataView(new ArrayBuffer(64))",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );

  // Both streams pinned at once (#29531 leaked one of the two references).
  memLeakTestProtect(
    "ArrayBuffer_builtin_both_streams",
    "new ArrayBuffer(64)",
    "TestBuilder.command`echo hi &> ${val}`",
  );
  memLeakTestProtect(
    "Buffer_subprocess_both_streams",
    "Buffer.alloc(64)",
    "TestBuilder.command`${bunExe()} -e 'console.log(1); console.error(2)' &> ${val}`",
    false,
    2,
  );

  // stderr pinned by a command that fails, so the references are released on
  // the error path.
  memLeakTestProtect(
    "Uint8Array_missing_file_stderr",
    "new Uint8Array(128)",
    "TestBuilder.command`cat missing.txt 2> ${val}`.exitCode(1)",
  );
  memLeakTestProtect(
    "ArrayBuffer_failed_cd_stderr",
    "new ArrayBuffer(128)",
    "TestBuilder.command`cd missing-dir 2> ${val}`.exitCode(1)",
  );

  // stdin from a JS object.
  memLeakTestProtect("Buffer_stdin", "Buffer.from('hi\\n')", "TestBuilder.command`cat < ${val}`.stdout('hi\\n')");
  memLeakTestProtect(
    "Buffer_builtin_stdin",
    "Buffer.alloc(64)",
    "TestBuilder.command`echo hi < ${val}`.stdout('hi\\n')",
  );

  memLeakTestProtect(
    "String_large_input",
    "Buffer.alloc(4 * 4096, 'test').toString()",
    "TestBuilder.command`echo ${val}`.stdout(val + '\\n')",
  );
  memLeakTestProtect(
    "String_pipeline",
    "Buffer.alloc(4 * 1024, 'data').toString()",
    "TestBuilder.command`echo ${val} | cat`.stdout(val + '\\n')",
  );

  // Complex nested pipelines
  memLeakTestProtect(
    "ArrayBuffer_nested_pipeline",
    "new ArrayBuffer(256)",
    "TestBuilder.command`echo hello | head -n 10 | tail -n 5 | wc -l > ${val}`",
    true,
  );
  memLeakTestProtect(
    "Buffer_triple_pipeline",
    "Buffer.alloc(256)",
    "TestBuilder.command`echo hello | cat | grep -v nonexistent | wc -c > ${val}`",
    true,
  );
  memLeakTestProtect(
    "String_complex_pipeline",
    "Array(512).fill('pipeline').join('\\n')",
    "TestBuilder.command`echo ${val} | sort | uniq | head -n 3`.stdout('pipeline\\n')",
    true,
  );

  // Subshells with JS objects
  memLeakTestProtect(
    "ArrayBuffer_subshell",
    "new ArrayBuffer(128)",
    "TestBuilder.command`echo $(echo hello | wc -c) > ${val}`",
    true,
  );
  memLeakTestProtect(
    "Buffer_nested_subshell",
    "Buffer.alloc(128)",
    "TestBuilder.command`echo $(echo hello | head -c 3) done > ${val}`",
    true,
  );
  memLeakTestProtect(
    "String_subshell_pipeline",
    "Buffer.alloc(3 * 256, 'sub').toString()",
    "TestBuilder.command`echo start $(echo ${val} | cat) end`.stdout('start ' + val + ' end\\n')",
    true,
  );

  // Mixed builtin and subprocess commands
  memLeakTestProtect(
    "ArrayBuffer_mixed_commands",
    "new ArrayBuffer(192)",
    "TestBuilder.command`mkdir -p tmp && echo hello > tmp/test.txt && cat tmp/test.txt > ${val} && rm -rf tmp`",
  );
  // Every run here spawns a bun (about 0.3s each in a debug build). The check is
  // exact, so two measured runs detect a leak as surely as five.
  memLeakTestProtect(
    "Buffer_builtin_external_mix",
    "Buffer.alloc(192)",
    "TestBuilder.command`echo hello | ${bunExe()} -e 'Bun.stdin.text().then(text => Bun.write(Bun.stdout, text))' > ${val}`",
    false,
    2,
  );
  memLeakTestProtect(
    "String_cd_operations",
    "Buffer.alloc(3 * 128, 'dir').toString()",
    "TestBuilder.command`mkdir -p testdir && cd testdir && echo ${val} > file.txt && cd .. && cat testdir/file.txt && rm -rf testdir`.stdout(val + '\\n')",
  );

  // Conditional execution
  memLeakTestProtect(
    "ArrayBuffer_conditional",
    "new ArrayBuffer(64)",
    "TestBuilder.command`echo hello > ${val} && echo success || echo failure`.stdout('success\\n')",
  );
  memLeakTestProtect(
    "Buffer_test_conditional",
    "Buffer.alloc(64)",
    "TestBuilder.command`test -n hello && echo 'has content' > ${val} || echo 'empty'`",
    true,
  );

  // The rest measures this process's own heap, so it runs alone, after the
  // child-spawning tests above. #11816 leaked one ShellInterpreter per command;
  // 30 commands against a bound of 3 keep a 10x margin.
  const BATCHES = 3;
  const BATCH_SIZE = 10;

  function shellCommand(builtin: boolean, dir: string): $.ShellPromise {
    return builtin
      ? $`cat ${dir}/input.txt`
      : $`${bunExe()} -e ${/* ts */ `console.log(Buffer.alloc(1024, 'a').toString())`}`.env(bunEnv);
  }

  // Same settle loop as the children: the last batch can stay conservatively
  // rooted until the stack unwinds for an event loop turn.
  async function expectShellObjectsCollected() {
    let counts = { ShellInterpreter: 0, ParsedShellScript: 0 };
    for (let turn = 0; turn <= 50; turn++) {
      if (turn > 0) await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);
      const { ShellInterpreter = 0, ParsedShellScript = 0 } = heapStats().objectTypeCounts;
      counts = { ShellInterpreter, ParsedShellScript };
      if (ShellInterpreter <= MAX_SHELL_OBJECTS && ParsedShellScript <= MAX_SHELL_OBJECTS) break;
    }
    expect(counts.ShellInterpreter).toBeLessThanOrEqual(MAX_SHELL_OBJECTS);
    expect(counts.ParsedShellScript).toBeLessThanOrEqual(MAX_SHELL_OBJECTS);
  }

  describe.serial("#11816", () => {
    function doit(builtin: boolean) {
      test(builtin ? "builtin" : "external", async () => {
        await using files = tempDir("hi", {
          "input.txt": Buffer.alloc(2048, "a").toString(),
        });
        for (let j = 0; j < BATCHES; j++) {
          const promises: $.ShellPromise[] = [];
          for (let i = 0; i < BATCH_SIZE; i++) {
            promises.push(shellCommand(builtin, String(files)).quiet());
          }
          const outputs = await Promise.all(promises);
          expect(outputs.map(output => output.exitCode)).toEqual(Array(BATCH_SIZE).fill(0));
        }

        await expectShellObjectsCollected();
      });
    }
    doit(false);
    doit(true);
  });

  describe.serial("not leaking ParsedShellScript when ShellInterpreter never runs", () => {
    function doit(builtin: boolean) {
      test(builtin ? "builtin" : "external", async () => {
        await using files = tempDir("hi", {
          "input.txt": Buffer.alloc(2048, "a").toString(),
        });
        // wrapping in a function
        // because of an optimization
        // which will hoist the `promise` array to the top (to avoid creating it in every iteration)
        // this causes the array to be kept alive for the scope
        function run() {
          for (let j = 0; j < BATCHES; j++) {
            const promises: $.ShellPromise[] = [];
            for (let i = 0; i < BATCH_SIZE; i++) {
              promises.push(shellCommand(builtin, String(files)));
            }
          }
        }
        run();

        await expectShellObjectsCollected();
      });
    }
    doit(false);
    doit(true);
  });
});
