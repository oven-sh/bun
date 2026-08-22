// fs.rm's `maxRetries` / `retryDelay` options: every flavor (rmSync, promises.rm
// and the callback rm, which goes through promises.rm) retries the errors node's
// rimraf retries (EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM), waiting
// retryDelay * attempt between attempts, and still fails immediately by default.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, promises, rmSync } from "node:fs";
import { join } from "node:path";

// `ulimit` is the POSIX way to get EMFILE cheaply (bun raises its soft fd limit
// to the hard one at startup, and `ulimit -n` lowers both); see the fixture.
describe.skipIf(isWindows)("fs.rm retries EMFILE when asked to", () => {
  const fixture = join(import.meta.dir, "rm-retry-fixture.js");

  async function runFixture(flavor: string, scenario: string) {
    using scratch = tempDir("rm-retry", {});
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 256; exec "$0" "$@"`, bunExe(), fixture, flavor, scenario, String(scratch)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout) as { probe: string; result: string; existsAfter: boolean; elapsedMs: number };
  }

  // The fixture's probe (no retry options) must fail with EMFILE before the
  // retrying call is made, so a passing result below can only come from retrying.
  const flavors = ["sync", "promise", "callback"];

  test.concurrent.each(flavors)("%s: gives up with the error after maxRetries, backing off linearly", async flavor => {
    const { probe, result, existsAfter, elapsedMs } = await runFixture(flavor, "gives-up");
    expect({ probe, result, existsAfter }).toEqual({ probe: "EMFILE", result: "EMFILE", existsAfter: true });
    // maxRetries: 2, retryDelay: 100 waits 100ms and then 200ms. Without retries
    // this takes a few ms; a constant delay would take 200ms. The slack covers
    // timers rounding down to the millisecond.
    expect(elapsedMs).toBeGreaterThanOrEqual(250);
  });

  test.concurrent.each(flavors)("%s: succeeds once the condition clears while retrying", async flavor => {
    const { probe, result, existsAfter } = await runFixture(flavor, "recovers");
    expect({ probe, result, existsAfter }).toEqual({ probe: "EMFILE", result: "ok", existsAfter: false });
  });

  // rimraf treats ENOENT on a retry as "somebody else removed it" even without
  // `force`, since the path was there when the first attempt ran.
  test.concurrent.each(["sync", "promise"])(
    "%s: succeeds when the path is removed by someone else between attempts",
    async flavor => {
      const { probe, result, existsAfter } = await runFixture(flavor, "vanishes");
      expect({ probe, result, existsAfter }).toEqual({ probe: "EMFILE", result: "ok", existsAfter: false });
    },
  );
});

// Errors outside rimraf's retry set are not retried: a retry here would be
// noticeable as a 5 second wait before the same ENOENT.
describe("fs.rm does not retry errors that retrying cannot fix", () => {
  const options = { recursive: true, maxRetries: 1, retryDelay: 5000 };

  test.concurrent("rmSync", () => {
    using root = tempDir("rm-retry-enoent", {});
    const missing = join(String(root), "missing");
    const start = performance.now();
    let error;
    try {
      rmSync(missing, options);
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ code: "ENOENT" });
    expect(performance.now() - start).toBeLessThan(2500);
  });

  test.concurrent("promises.rm", async () => {
    using root = tempDir("rm-retry-enoent", {});
    const missing = join(String(root), "missing");
    const start = performance.now();
    await expect(promises.rm(missing, options)).rejects.toMatchObject({ code: "ENOENT" });
    expect(performance.now() - start).toBeLessThan(2500);
  });
});

// The case the options exist for: Windows refuses to delete a directory that is
// some process's working directory, or a file another process has open without
// FILE_SHARE_DELETE, with EBUSY until that process goes away.
describe.skipIf(!isWindows)("fs.rm retries EBUSY on Windows when asked to", () => {
  // Each holder writes "ready" to stderr once it holds the target, keeps it for
  // about a second and then exits on its own. The rm attempts are not observable
  // from outside, so there is no signal to release the holder on; the hold only
  // has to outlast the first attempt, which runs as soon as ready is read, while
  // the retry schedule below keeps going for 41 seconds.
  const holders = {
    // bun running with the directory as its cwd.
    directory: [bunExe(), "-e", `process.stderr.write("ready\\n"); setTimeout(() => {}, 1000);`],
    // cmd keeps file.txt open (no FILE_SHARE_DELETE) as the block's stdout.
    file: ["cmd.exe", "/d", "/c", "(echo ready 1>&2 & ping -n 2 127.0.0.1 >nul) >> file.txt"],
  };

  async function removeWhileHeld(kind: keyof typeof holders, remove: (target: string) => unknown) {
    using root = tempDir("rm-retry-busy", { "held/file.txt": "x" });
    const dir = join(String(root), "held");
    const target = kind === "directory" ? dir : join(dir, "file.txt");
    await using holder = Bun.spawn({ cmd: holders[kind], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const stdout = holder.stdout.text();
    const { value } = await holder.stderr.getReader().read();
    expect(new TextDecoder().decode(value)).toStartWith("ready");

    // Precondition: with the default maxRetries of 0 the EBUSY surfaces at once.
    let probe;
    try {
      rmSync(target, { recursive: kind === "directory" });
    } catch (err) {
      probe = err;
    }
    expect(probe).toMatchObject({ code: "EBUSY", syscall: "rm" });
    expect(existsSync(target)).toBe(true);

    await remove(target);
    expect(existsSync(target)).toBe(false);
    expect({ stdout: await stdout, exitCode: await holder.exited }).toEqual({ stdout: "", exitCode: 0 });
  }

  const retries = { maxRetries: 40, retryDelay: 50 };

  test("rmSync removes a directory that was another process's cwd", async () => {
    await removeWhileHeld("directory", dir => rmSync(dir, { recursive: true, ...retries }));
  });

  test("promises.rm removes a directory that was another process's cwd", async () => {
    await removeWhileHeld("directory", dir => promises.rm(dir, { recursive: true, ...retries }));
  });

  test("rmSync removes a file another process had open", async () => {
    await removeWhileHeld("file", file => rmSync(file, retries));
  });

  test("promises.rm removes a file another process had open", async () => {
    await removeWhileHeld("file", file => promises.rm(file, retries));
  });
});
