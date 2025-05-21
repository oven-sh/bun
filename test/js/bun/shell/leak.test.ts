import { $ } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, tempDirWithFiles } from "harness";
import { appendFileSync, closeSync, openSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "os";
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

describe("fd leak", () => {
  function fdLeakTest(name: string, builder: () => TestBuilder, runs: number = 1000, threshold: number = 5) {
    test(`fdleak_${name}`, async () => {
      Bun.gc(true);
      const baseline = openSync(devNull, "r");
      closeSync(baseline);

      for (let i = 0; i < runs; i++) {
        await builder().quiet().run();
      }
      // Run the GC, because the interpreter closes file descriptors when it
      // deinitializes when its finalizer is called
      Bun.gc(true);
      const fd = openSync(devNull, "r");
      closeSync(fd);
      expect(fd - baseline).toBeLessThanOrEqual(threshold);
    }, 100_000);
  }

  function memLeakTest(
    name: string,
    builder: () => TestBuilder,
    runs: number = 500,
    threshold: number = DEFAULT_THRESHOLD,
  ) {
    test(`memleak_${name}`, async () => {
      const tempfile = join(tmpdir(), "script.ts");

      const filepath = import.meta.dirname;
      const testcode = await Bun.file(join(filepath, "./test_builder.ts")).text();

      writeFileSync(tempfile, testcode);

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
                  if (!(Math.abs(prev - val) < threshold)) process.exit(1);
                }
              }
            `;

      appendFileSync(tempfile, impl);

      // console.log("THE CODE", readFileSync(tempfile, "utf-8"));

      const { stdout, stderr, exitCode } = Bun.spawnSync([process.argv0, "--smol", "test", tempfile], {
        env: bunEnv,
      });
      // console.log('STDOUT:', stdout.toString(), '\n\nSTDERR:', stderr.toString());
      if (exitCode != 0) {
        console.log("\n\nSTDERR:", stderr.toString());
      }
      expect(exitCode).toBe(0);
    }, 100_000);
  }

  TESTS.forEach(args => {
    fdLeakTest(...args);
    memLeakTest(...args);
  });

  // Use text of this file so its big enough to cause a leak
  memLeakTest("ArrayBuffer", () => TestBuilder.command`cat ${import.meta.filename} > ${new ArrayBuffer(1 << 20)}`, 100);
  memLeakTest("Buffer", () => TestBuilder.command`cat ${import.meta.filename} > ${Buffer.alloc(1 << 20)}`, 100);
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

  describe("#11816", async () => {
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

  describe("not leaking ParsedShellScript when ShellInterpreter never runs", async () => {
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
