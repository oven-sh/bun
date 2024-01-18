import { $ } from "bun";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile, copyFile } from "fs/promises";
import { join, relative } from "path";
import { TestBuilder, redirect } from "./util";
import { tmpdir } from "os";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import {
  randomInvalidSurrogatePair,
  randomLoneSurrogate,
  runWithError,
  runWithErrorPromise,
  tempDirWithFiles,
} from "harness";
import { openSync, closeSync, writeFileSync, appendFileSync, readFileSync, mkdtempSync } from "node:fs";

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
          ).toEqual(["foo/",
          "foo/bar",
          "foo/bar/great",
          "foo/bar/wow",
          "foo/lmao",
          "foo/lol",
          "foo/nice"].sort()),
        ),
  ],
];

describe("fd leak", () => {
  function fdLeakTest(name: string, builder: () => TestBuilder, runs: number = 500) {
    // console.log(builder.toString());
    test(`fdleak_${name}`, async () => {
      const baseline = openSync("/dev/null", "r");
      closeSync(baseline);
      for (let i = 0; i < runs; i++) {
        // await builder().quiet().run();
        await builder().run();
      }
      const fd = openSync("/dev/null", "r");
      closeSync(fd);
      expect(fd).toBe(baseline);
    });
  }

  function memLeakTest(name: string, builder: () => TestBuilder, runs: number = 500) {
    test(`memleak_${name}`, async () => {
      const tempfile = join(tmpdir(), "script.ts");

      const filepath = import.meta.dirname;
      const testcode = new TextDecoder().decode(await Bun.file(join(filepath, "./test_builder.ts")).arrayBuffer());

      writeFileSync(tempfile, testcode);

      const impl = /* ts */ `



            test("${name}", async () => {
              const hundredMb = (1 << 20) * 100;
              let prev: number | undefined = undefined;
              for (let i = 0; i < ${runs}; i++) {
                Bun.gc(true);
                await (async function() {
                  await ${builder.toString().slice("() =>".length)}.run()
                })()
                Bun.gc(true);
                const val = process.memoryUsage.rss();
                if (prev === undefined) {
                  prev = val;
                } else {
                  expect(Math.abs(prev - val)).toBeLessThan(hundredMb)
                }
              }
            })
            `;

      appendFileSync(tempfile, impl);

      // console.log("THE CODE", readFileSync(tempfile, "utf-8"));

      const { stdout, stderr, exitCode } = Bun.spawnSync([process.argv0, "--smol", "test", tempfile]);
      console.log(stdout.toString(), stderr.toString());
      expect(exitCode).toBe(0);
    });
  }

  TESTS.forEach(args => {
    fdLeakTest(...args);
    memLeakTest(...args);
  });
});
