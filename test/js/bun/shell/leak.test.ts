import { $ } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, isPosix, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";
import { bunExe } from "./test_builder";
import { createTestBuilder } from "./util";
const TestBuilder = createTestBuilder(import.meta.path);
type TestBuilder = InstanceType<typeof TestBuilder>;

$.env(bunEnv);
$.cwd(process.cwd());
$.nothrow();

const DEFAULT_THRESHOLD = process.platform === "darwin" ? 100 * (1 << 20) : 150 * (1 << 20);

const TESTS: [name: string, builder: () => TestBuilder, runs?: number][] = [
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
    500,
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
    100,
  ],
];

describe.concurrent("fd leak", () => {
  function fdLeakTest(name: string, builder: () => TestBuilder, runs: number = 1000, threshold: number = 5) {
    test(`fdleak_${name}`, async () => {
      const testcode = await Bun.file(join(import.meta.dirname, "./test_builder.ts")).text();

      const impl = /* ts */ `
              import { openSync, closeSync } from "node:fs";
              import { devNull } from "os";
              const TestBuilder = createTestBuilder(import.meta.path);

              const runs = ${runs};
              const threshold = ${threshold};

              Bun.gc(true);
              const baseline = openSync(devNull, "r");
              closeSync(baseline);

              for (let i = 0; i < runs; i++) {
                await ${builder.toString().slice("() =>".length)}.quiet().run();
              }
              // Run the GC, because the interpreter closes file descriptors when it
              // deinitializes when its finalizer is called
              Bun.gc(true);
              const fd = openSync(devNull, "r");
              closeSync(fd);
              if (fd - baseline > threshold) {
                console.error('FD leak detected:', fd - baseline, 'leaked (threshold:', threshold, ')');
                process.exit(1);
              }
            `;

      using dir = tempDir("fdleak", {
        "script.ts": testcode + impl,
      });

      const { exited, stderr: stream } = Bun.spawn([process.argv0, "--smol", "test", join(dir, "script.ts")], {
        env: bunEnv,
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([exited, stream.text()]);
      if (exitCode != 0) {
        console.log("\n\nSTDERR:", stderr);
      }
      expect(exitCode).toBe(0);
    }, 100_000);
  }

  function memLeakTest(
    name: string,
    builder: () => TestBuilder,
    runs: number = 500,
    threshold: number = DEFAULT_THRESHOLD,
  ) {
    test(`memleak_${name}`, async () => {
      const testcode = await Bun.file(join(import.meta.dirname, "./test_builder.ts")).text();

      const impl = /* ts */ `
              import { heapStats } from "bun:jsc";
              const TestBuilder = createTestBuilder(import.meta.path);

              const threshold = ${threshold}
              let prev: number | undefined = undefined;
              let prevprev: number | undefined = undefined;
              for (let i = 0; i < ${runs}; i++) {
                Bun.gc(true);
                await (async function() {
                  await ${builder.toString().slice("() =>".length)}.quiet().runAsTest('iter:', i)
                })()
                Bun.gc(true);
                Bun.gc(true);

                const objectTypeCounts = heapStats().objectTypeCounts;
                heapStats().objectTypeCounts.ParsedShellScript
                if (objectTypeCounts.ParsedShellScript > 3 || objectTypeCounts.ShellInterpreter > 3) {
                  console.error('TOO many ParsedShellScript or ShellInterpreter objects', objectTypeCounts.ParsedShellScript, objectTypeCounts.ShellInterpreter)
                  process.exit(1);
                }

                const val = process.memoryUsage.rss();
                if (prev === undefined) {
                  prev = val;
                  prevprev = val;
                } else {
                  // console.error('Prev', prev, 'Val', val, 'Diff', Math.abs(prev - val), 'Threshold', threshold);
                  if (!(Math.abs(prev - val) < threshold)) process.exit(1);
                }
              }
            `;

      using dir = tempDir("memleak", {
        "script.ts": testcode + impl,
      });

      const { exited, stderr: stream } = Bun.spawn([process.argv0, "--smol", "test", join(dir, "script.ts")], {
        env: bunEnv,
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([exited, stream.text()]);
      if (exitCode != 0) {
        console.log("\n\nSTDERR:", stderr);
      }
      expect(exitCode).toBe(0);
    }, 100_000);
  }

  TESTS.forEach(args => {
    fdLeakTest(...args);
    memLeakTest(...args);
  });

  // Use text of this file so its big enough to cause a leak
  memLeakTest("ArrayBuffer", () => TestBuilder.command`cat ${import.meta.filename} > ${new ArrayBuffer(128)}`, 100);
  memLeakTest("Buffer", () => TestBuilder.command`cat ${import.meta.filename} > ${Buffer.alloc(128)}`, 100);
  memLeakTest(
    "Blob_something",
    () =>
      TestBuilder.command`cat < ${new Blob([
        Array(128 * 1024)
          .fill("a")
          .join(""),
      ])}`.stdout(str =>
        expect(str).toEqual(
          Array(128 * 1024)
            .fill("a")
            .join(""),
        ),
      ),
    100,
  );
  memLeakTest(
    "Blob_nothing",
    () =>
      TestBuilder.command`echo hi < ${new Blob([
        Array(128 * 1024)
          .fill("a")
          .join(""),
      ])}`.stdout("hi\n"),
    100,
  );
  memLeakTest("String", () => TestBuilder.command`echo ${Array(4096).fill("a").join("")}`.stdout(() => {}), 100);

  function memLeakTestProtect(
    name: string,
    className: string,
    constructStmt: string,
    builder: string,
    posixOnly: boolean = false,
    runs: number = 5,
  ) {
    const runTheTest = !posixOnly ? true : isPosix;
    test.if(runTheTest)(
      `memleak_protect_${name}`,
      async () => {
        const testcode = await Bun.file(join(import.meta.dirname, "./test_builder.ts")).text();

        const impl = /* ts */ `
              import { heapStats } from "bun:jsc";
              const TestBuilder = createTestBuilder(import.meta.path);

              Bun.gc(true);
              const startValue = heapStats().protectedObjectTypeCounts.${className} ?? 0;
              for (let i = 0; i < ${runs}; i++) {
                await (async function() {
                  let val = ${constructStmt}
                  await ${builder}
                })()
                Bun.gc(true);

                let value = heapStats().protectedObjectTypeCounts.${className} ?? 0;

                if (value > startValue) {
                  console.error('Leaked ${className} objects')
                  process.exit(1);
                }
              }
            `;

        using dir = tempDir("memleak_protect", {
          "script.ts": testcode + impl,
        });

        const { stderr: stream, exited } = Bun.spawn([process.argv0, "--smol", "test", join(dir, "script.ts")], {
          env: bunEnv,
          stdout: "ignore",
          stderr: "pipe",
        });
        const [exitCode, stderr] = await Promise.all([exited, stream.text()]);
        if (exitCode != 0) {
          console.log("\n\nSTDERR:", stderr);
        }
        expect(exitCode).toBe(0);
      },
      100_000,
    );
  }

  memLeakTestProtect(
    "ArrayBuffer",
    "ArrayBuffer",
    "new ArrayBuffer(64)",
    "TestBuilder.command`cat ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "Buffer",
    "Buffer",
    "Buffer.alloc(64)",
    "TestBuilder.command`cat ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "ArrayBuffer_builtin",
    "ArrayBuffer",
    "new ArrayBuffer(64)",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "Buffer_builtin",
    "Buffer",
    "Buffer.alloc(64)",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );

  memLeakTestProtect(
    "Uint8Array",
    "Uint8Array",
    "new Uint8Array(64)",
    "TestBuilder.command`cat ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "Uint8Array_builtin",
    "Uint8Array",
    "new Uint8Array(64)",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );

  memLeakTestProtect(
    "DataView",
    "DataView",
    "new DataView(new ArrayBuffer(64))",
    "TestBuilder.command`cat ${import.meta.filename} > ${val}`",
  );
  memLeakTestProtect(
    "DataView_builtin",
    "DataView",
    "new DataView(new ArrayBuffer(64))",
    "TestBuilder.command`echo ${import.meta.filename} > ${val}`",
  );

  memLeakTestProtect(
    "String_large_input",
    "String",
    "Array(4096).fill('test').join('')",
    "TestBuilder.command`echo ${val}`",
  );
  memLeakTestProtect(
    "String_pipeline",
    "String",
    "Array(1024).fill('data').join('')",
    "TestBuilder.command`echo ${val} | cat`",
  );

  // Complex nested pipelines
  memLeakTestProtect(
    "ArrayBuffer_nested_pipeline",
    "ArrayBuffer",
    "new ArrayBuffer(256)",
    "TestBuilder.command`echo ${val} | head -n 10 | tail -n 5 | wc -l`",
    true,
  );
  memLeakTestProtect(
    "Buffer_triple_pipeline",
    "Buffer",
    "Buffer.alloc(256)",
    "TestBuilder.command`echo ${val} | cat | grep -v nonexistent | wc -c`",
    true,
  );
  memLeakTestProtect(
    "String_complex_pipeline",
    "String",
    "Array(512).fill('pipeline').join('\\n')",
    "TestBuilder.command`echo ${val} | sort | uniq | head -n 3`",
    true,
  );

  // Subshells with JS objects
  memLeakTestProtect(
    "ArrayBuffer_subshell",
    "ArrayBuffer",
    "new ArrayBuffer(128)",
    "TestBuilder.command`echo $(echo ${val} | wc -c)`",
    true,
  );
  memLeakTestProtect(
    "Buffer_nested_subshell",
    "Buffer",
    "Buffer.alloc(128)",
    "TestBuilder.command`echo $(echo ${val} | head -c 10) done`",
    true,
  );
  memLeakTestProtect(
    "String_subshell_pipeline",
    "String",
    "Array(256).fill('sub').join('')",
    "TestBuilder.command`echo start $(echo ${val} | wc -c | cat) end`",
    true,
  );

  // Mixed builtin and subprocess commands
  memLeakTestProtect(
    "ArrayBuffer_mixed_commands",
    "ArrayBuffer",
    "new ArrayBuffer(192)",
    "TestBuilder.command`mkdir -p tmp && echo ${val} > tmp/test.txt && cat tmp/test.txt && rm -rf tmp`",
  );
  memLeakTestProtect(
    "Buffer_builtin_external_mix",
    "Buffer",
    "Buffer.alloc(192)",
    "TestBuilder.command`echo ${val} | ${bunExe()} -e 'process.stdin.on(\"data\", d => process.stdout.write(d))' | head -c 50`",
  );
  memLeakTestProtect(
    "String_cd_operations",
    "String",
    "Array(128).fill('dir').join('')",
    "TestBuilder.command`mkdir -p testdir && cd testdir && echo ${val} > file.txt && cd .. && cat testdir/file.txt && rm -rf testdir`",
  );

  // Conditional execution
  memLeakTestProtect(
    "ArrayBuffer_conditional",
    "ArrayBuffer",
    "new ArrayBuffer(64)",
    "TestBuilder.command`echo ${val} && echo success || echo failure`",
  );
  memLeakTestProtect(
    "Buffer_test_conditional",
    "Buffer",
    "Buffer.alloc(64)",
    "TestBuilder.command`test -n ${val} && echo 'has content' || echo 'empty'`",
    true,
  );

  describe.serial("#11816", async () => {
    function doit(builtin: boolean) {
      test(builtin ? "builtin" : "external", async () => {
        const files = tempDirWithFiles("hi", {
          "input.txt": Array(2048).fill("a").join(""),
        });
        for (let j = 0; j < 10; j++) {
          const promises = [];
          for (let i = 0; i < 10; i++) {
            if (builtin) {
              promises.push($`cat ${files}/input.txt`.quiet());
            } else {
              promises.push(
                $`${bunExe()} -e ${/* ts */ `console.log(Array(1024).fill('a').join(''))`}`.env(bunEnv).quiet(),
              );
            }
          }

          await Promise.all(promises);
          Bun.gc(true);
        }

        const { ShellInterpreter, ParsedShellScript } = heapStats().objectTypeCounts;
        if (ShellInterpreter > 3 || ParsedShellScript > 3) {
          console.error("TOO many ParsedShellScript or ShellInterpreter objects", ParsedShellScript, ShellInterpreter);
          throw new Error("TOO many ParsedShellScript or ShellInterpreter objects");
        }
      });
    }
    doit(false);
    doit(true);
  });

  describe.serial("not leaking ParsedShellScript when ShellInterpreter never runs", () => {
    function doit(builtin: boolean) {
      test(builtin ? "builtin" : "external", async () => {
        const files = tempDirWithFiles("hi", {
          "input.txt": Array(2048).fill("a").join(""),
        });
        // wrapping in a function
        // because of an optimization
        // which will hoist the `promise` array to the top (to avoid creating it in every iteration)
        // this causes the array to be kept alive for the scope
        function run() {
          for (let j = 0; j < 10; j++) {
            const promises = [];
            for (let i = 0; i < 10; i++) {
              if (builtin) {
                promises.push($`cat ${files}/input.txt`);
              } else {
                promises.push($`${bunExe()} -e ${/* ts */ `console.log(Array(1024).fill('a').join(''))`}`.env(bunEnv));
              }
            }

            Bun.gc(true);
          }
        }
        run();
        Bun.gc(true);

        const { ShellInterpreter, ParsedShellScript } = heapStats().objectTypeCounts;
        if (ShellInterpreter > 3 || ParsedShellScript > 3) {
          console.error("TOO many ParsedShellScript or ShellInterpreter objects", ParsedShellScript, ShellInterpreter);
          throw new Error("TOO many ParsedShellScript or ShellInterpreter objects");
        }
      });
    }

    doit(false);
    doit(true);
  });
});
