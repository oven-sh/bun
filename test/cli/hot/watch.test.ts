import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  forEachLine,
  isASAN,
  isAndroid,
  isBroken,
  isDebug,
  isLinux,
  isWindows,
  tempDir,
} from "harness";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

describe.todoIf(isBroken && isWindows)("--watch works", async () => {
  for (const watchedFile of ["entry.js", "tmp.js"]) {
    test(`with ${watchedFile}`, async () => {
      await using tmpdir_ = tempDir("watch-fixture", {
        "tmp.js": "console.log('hello #1')",
        "entry.js": "import './tmp.js'",
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
      });
      await Bun.sleep(1000);
      const tmpfile = join(tmpdir_, "tmp.js");
      const process = spawn({
        cmd: [bunExe(), "--watch", join(tmpdir_, watchedFile)],
        cwd: tmpdir_,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const { stdout } = process;

      const iter = forEachLine(stdout);
      let { value: line, done } = await iter.next();
      expect(done).toBe(false);
      expect(line).toBe("hello #1");

      await writeFile(tmpfile, "console.log('hello #2')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #2");

      await writeFile(tmpfile, "console.log('hello #3')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #3");

      await writeFile(tmpfile, "console.log('hello #4')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #4");

      await writeFile(tmpfile, "console.log('hello #5')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #5");

      process.kill("SIGKILL");
      await process.exited;
    });
  }
});

// An uncaught error leaves the process to the watcher's own loop driver, which has to keep
// running what the entry point started. Sequential, so that a watcher which never prints is
// killed with its test.
describe.each(["--hot", "--watch"])("%s after an uncaught error", flag => {
  // A debug build needs seconds to start the watcher and a Worker.
  const timeout = isDebug || isASAN ? 30_000 : undefined;

  async function firstLine(files: Record<string, string>, env: Record<string, string> = {}) {
    using dir = tempDir("watch-after-error", files);
    await using proc = spawn({
      cmd: [bunExe(), flag, "entry.js"],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const { value } = await forEachLine(proc.stdout).next();
    return value;
  }

  // A Worker's messages are delivered in batches, and each batch after the first is a task that
  // waits for the loop to poll.
  test(
    "delivers every message of a Worker that posts more than one batch",
    async () => {
      const line = await firstLine({
        "worker.js": [
          `self.onmessage = event => {`,
          `  for (let i = 0; i < event.data; i++) postMessage(i);`,
          `};`,
          `postMessage("ready");`,
        ].join("\n"),
        "entry.js": [
          `const count = 5000;`,
          `let received = 0;`,
          `const worker = new Worker(new URL("./worker.js", import.meta.url).href);`,
          `worker.onmessage = event => {`,
          `  if (event.data === "ready") {`,
          `    worker.postMessage(count);`,
          `    throw new Error("the uncaught error");`,
          `  }`,
          `  if (++received === count) console.log("received " + received);`,
          `};`,
        ].join("\n"),
      });
      expect(line).toBe("received 5000");
    },
    timeout,
  );

  // Without pidfd_open the exit of a child is such a task too.
  test.skipIf(!isLinux && !isAndroid)(
    "reports the exit of a child on the waiter thread",
    async () => {
      const line = await firstLine(
        {
          "entry.js": [
            `Bun.spawn({`,
            `  cmd: ["true"],`,
            `  stdio: ["ignore", "ignore", "ignore"],`,
            `  onExit: (child, exitCode) => console.log("exit " + exitCode),`,
            `});`,
            `throw new Error("the uncaught error");`,
          ].join("\n"),
        },
        // The flag is read when BUN_GARBAGE_COLLECTOR_LEVEL is set, and bunEnv sets it.
        { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
      );
      expect(line).toBe("exit 0");
    },
    timeout,
  );
});
