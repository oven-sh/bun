// @known-failing-on-windows: panic "TODO on Windows"

import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv } from "harness";
import { appendFileSync, closeSync, openSync, writeFileSync } from "node:fs";
import { tmpdir, devNull } from "os";
import { join } from "path";
import { TestBuilder } from "./util";

$.env(bunEnv);
$.cwd(process.cwd());

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
    100,
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
  function fdLeakTest(name: string, builder: () => TestBuilder, runs: number = 500) {
    test(`fdleak_${name}`, async () => {
      for (let i = 0; i < 5; i++) {
        await builder().quiet().run();
      }

      const baseline = openSync(devNull, "r");
      closeSync(baseline);

      for (let i = 0; i < runs; i++) {
        await builder().quiet().run();
      }
      const fd = openSync(devNull, "r");
      closeSync(fd);
      expect(fd).toBe(baseline);
    }, 100_000);
  }

  function memLeakTest(
    name: string,
    builder: () => TestBuilder,
    runs: number = 500,
    threshold: number = 100 * (1 << 20),
  ) {
    test(`memleak_${name}`, async () => {
      const tempfile = join(tmpdir(), "script.ts");

      const filepath = import.meta.dirname;
      const testcode = await Bun.file(join(filepath, "./test_builder.ts")).text();

      writeFileSync(tempfile, testcode);

      const impl = /* ts */ `



            test("${name}", async () => {
              const hundredMb = ${threshold}
              let prev: number | undefined = undefined;
              for (let i = 0; i < ${runs}; i++) {
                Bun.gc(true);
                await (async function() {
                  await ${builder.toString().slice("() =>".length)}.quiet().run()
                })()
                Bun.gc(true);
                const val = process.memoryUsage.rss();
                if (prev === undefined) {
                  prev = val;
                } else {
                  expect(Math.abs(prev - val)).toBeLessThan(hundredMb)
                }
              }
            }, 1_000_000)
            `;

      appendFileSync(tempfile, impl);

      // console.log("THE CODE", readFileSync(tempfile, "utf-8"));

      const { stdout, stderr, exitCode } = Bun.spawnSync([process.argv0, "--smol", "test", tempfile], {
        env: bunEnv,
      });
      // console.log('STDOUT:', stdout.toString(), '\n\nSTDERR:', stderr.toString());
      console.log("\n\nSTDERR:", stderr.toString());
      expect(exitCode).toBe(0);
    }, 100_000);
  }

  TESTS.forEach(args => {
    fdLeakTest(...args);
    memLeakTest(...args);
  });

  // Use text of this file so its big enough to cause a leak
  memLeakTest(
    "ArrayBuffer",
    () => TestBuilder.command`cat ${import.meta.filename} > ${new ArrayBuffer((1 << 20) * 100)}`,
    100,
  );
  memLeakTest("Buffer", () => TestBuilder.command`cat ${import.meta.filename} > ${Buffer.alloc((1 << 20) * 100)}`, 100);
  memLeakTest("String", () => TestBuilder.command`echo ${Array(4096).fill("a").join("")}`.stdout(() => {}), 100, 4096);
});
