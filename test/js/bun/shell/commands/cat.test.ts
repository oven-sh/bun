import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, isPosix, isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestBuilder } from "../test_builder";

const TestBuilder = createTestBuilder(import.meta.path);

$.env(bunEnv);
$.nothrow();

describe("cat", () => {
  TestBuilder.command`cat ${import.meta.path}`
    .quiet()
    .stdout(async out => expect(out).toEqual(await Bun.file(import.meta.path).text()))
    .exitCode(0)
    .runAsTest("single file");

  TestBuilder.command`cat ${import.meta.path} ${import.meta.path}`
    .quiet()
    .stdout(async out => {
      const self = await Bun.file(import.meta.path).text();
      expect(out).toEqual(self + self);
    })
    .exitCode(0)
    .runAsTest("multiple files");

  TestBuilder.command`cat /definitely/does/not/exist/anywhere`
    .quiet()
    .stderr(s => expect(s).toContain("cat:"))
    .exitCode(1)
    .runAsTest("nonexistent file");

  TestBuilder.command`echo hello | cat`.quiet().stdout("hello\n").exitCode(0).runAsTest("stdin");

  // These exercise Cat.deinit with state == .exec_filepath_args after normal completion.
  // Cat owns a refcounted *IOReader while reading each file; the inner
  // exec_filepath_args.deinit() releases it before bltn().done() cascades back into
  // Cat.deinit. Cat.deinit must be safe to run at that point (reader already released,
  // pointer nulled) without double-freeing, and must release the reader if a teardown
  // path ever reaches it while the reader is still live.
  describe("does not leak the file IOReader or its fd", () => {
    function fdCount(): number {
      return readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
    }

    test.skipIf(isWindows)("plain file (completes, then deinit)", async () => {
      using dir = tempDir("cat-fd", {
        "a.txt": Buffer.alloc(64 * 1024, "A").toString(),
      });
      const file = join(String(dir), "a.txt");

      // Prime.
      await $`cat ${file}`.quiet();
      Bun.gc(true);
      const baseline = fdCount();

      for (let i = 0; i < 100; i++) {
        const { exitCode } = await $`cat ${file}`.quiet();
        expect(exitCode).toBe(0);
      }
      Bun.gc(true);

      // IOReader.asyncDeinit hops through the event loop; let any queued closes drain.
      for (let i = 0; i < 10 && fdCount() > baseline + 5; i++) {
        await Bun.sleep(0);
        Bun.gc(true);
      }

      expect(fdCount()).toBeLessThanOrEqual(baseline + 5);
    });

    test.skipIf(isWindows)("multiple files including a nonexistent one", async () => {
      using dir = tempDir("cat-fd-multi", {
        "a.txt": Buffer.alloc(32 * 1024, "A").toString(),
      });
      const file = join(String(dir), "a.txt");

      await $`cat ${file} ${file}`.quiet();
      Bun.gc(true);
      const baseline = fdCount();

      for (let i = 0; i < 100; i++) {
        const { exitCode } = await $`cat ${file} /does/not/exist ${file}`.quiet();
        expect(exitCode).toBe(1);
      }
      Bun.gc(true);

      for (let i = 0; i < 10 && fdCount() > baseline + 5; i++) {
        await Bun.sleep(0);
        Bun.gc(true);
      }

      expect(fdCount()).toBeLessThanOrEqual(baseline + 5);
    });

    test.skipIf(!isPosix)("downstream closes early (EPIPE on stdout)", async () => {
      using dir = tempDir("cat-fd-pipe", {
        "big.txt": Buffer.alloc(512 * 1024, "A").toString(),
      });
      const file = join(String(dir), "big.txt");

      await $`cat ${file} | head -c 1`.quiet();
      Bun.gc(true);
      const baseline = fdCount();

      for (let i = 0; i < 30; i++) {
        await $`cat ${file} | head -c 1`.quiet();
      }
      Bun.gc(true);

      for (let i = 0; i < 10 && fdCount() > baseline + 5; i++) {
        await Bun.sleep(0);
        Bun.gc(true);
      }

      expect(fdCount()).toBeLessThanOrEqual(baseline + 5);
    });
  });
});
