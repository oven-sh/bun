import { spawn } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, cpSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, isWindows, tempDir, tmpdirSync, waitForFileToExist } from "harness";
import { join } from "path";

const timeout = isDebug ? Infinity : 10_000;
const longTimeout = isDebug ? Infinity : 30_000;

/**
 * Helper to parse stderr from a --hot process that throws errors.
 * Drives the reload cycle: reads error lines from stderr, verifies them,
 * and calls onReload to trigger the next file change.
 *
 * This fixes the original `continue outer` pattern which discarded any
 * remaining buffered lines from the current chunk when a duplicate error
 * was encountered, potentially losing data and causing test hangs.
 */
async function driveErrorReloadCycle(
  runner: ReturnType<typeof spawn>,
  opts: {
    targetCount: number;
    onReload: (counter: number) => void;
    verifyLine?: (errorLine: string, nextLine: string | undefined, counter: number) => void | "retry";
  },
): Promise<number> {
  const { targetCount, onReload, verifyLine } = opts;
  let reloadCounter = 0;
  let str = "";

  for await (const chunk of runner.stderr) {
    str += new TextDecoder().decode(chunk);
    // Need at least one error line followed by a newline, then another line followed by a newline
    if (!/error: .*[0-9]\n.*?\n/g.test(str)) continue;

    const lines = str.split("\n");
    // Preserve trailing partial line for the next chunk
    str = lines.pop() ?? "";
    let triggered = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("error:")) {
        // Don't silently swallow a watcher-thread death-rattle — surface it so the
        // post-loop "Expected 50, Received N" becomes an actionable failure.
        if (/Watcher crashed|panic:|oh no:/.test(line)) {
          throw new Error("child --hot died: " + line);
        }
        continue;
      }

      if (reloadCounter >= targetCount) {
        runner.kill();
        return reloadCounter;
      }

      // Windows: writeHotFileAtomicSync's rm+rename has a brief gap where the
      // entry file doesn't exist. A reload that lands in it prints one of
      // "Module not found" / "ENOENT reading" / "EPERM reading" (delete
      // pending). Skip it; the rename's own watcher event drives the real
      // reload, so re-saving here would only race that. POSIX rename is
      // atomic, so these showing up there would be a real bug.
      if (isWindows && /Module not found|\w+ reading "/.test(line)) continue;

      // If we see the previous error repeated, the pending reload hasn't
      // taken effect yet. Re-save the file and put remaining unprocessed
      // lines back into the buffer so they aren't lost.
      if (line.includes(`error: ${reloadCounter - 1}`)) {
        const remaining = lines.slice(i + 1).join("\n");
        if (remaining) {
          str = `${remaining}\n${str}`;
        }
        onReload(reloadCounter);
        triggered = false; // onReload already called; skip post-loop call
        break;
      }

      expect(line).toContain(`error: ${reloadCounter}`);

      const nextLine = lines[i + 1];
      if (verifyLine) {
        const result = verifyLine(line, nextLine, reloadCounter);
        if (result === "retry") {
          // Partial bundle read (e.g. --hot picked up the outfile before the
          // inline sourcemap trailer was flushed). Re-trigger the write and
          // re-buffer remaining lines, same as the stale-counter branch above.
          const remaining = lines.slice(i + 1).join("\n");
          if (remaining) {
            str = `${remaining}\n${str}`;
          }
          onReload(reloadCounter);
          triggered = false;
          break;
        }
        i++; // Skip the next line (stack trace)
      }

      reloadCounter++;
      triggered = true;

      if (reloadCounter >= targetCount) {
        runner.kill();
        return reloadCounter;
      }
    }

    if (triggered) {
      onReload(reloadCounter);
    }
  }

  return reloadCounter;
}

let hotRunnerRoot: string = "",
  cwd = "";
beforeEach(() => {
  const hotPath = tmpdirSync();
  hotRunnerRoot = join(hotPath, "hot-runner-root.js");
  rmSync(hotPath, { recursive: true, force: true });
  cpSync(import.meta.dir, hotPath, { recursive: true, force: true });
  cwd = hotPath;
});

it("preload not found should exit with code 1 and not time out", async () => {
  const root = hotRunnerRoot;
  const runner = spawn({
    cmd: [bunExe(), "--preload=/dev/foobarbarbar", "--hot", root],
    env: bunEnv,
    stdout: "inherit",
    stderr: "pipe",
    stdin: "ignore",
  });
  await runner.exited;
  expect(runner.signalCode).toBe(null);
  expect(runner.exitCode).toBe(1);
  expect(await new Response(runner.stderr).text()).toContain("preload not found");
});

it(
  "should hot reload when file is overwritten",
  async () => {
    const root = hotRunnerRoot;
    try {
      var runner = spawn({
        cmd: [bunExe(), "--hot", "run", root],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      var reloadCounter = 0;

      async function onReload() {
        writeFileSync(root, readFileSync(root, "utf-8"));
      }

      var str = "";
      for await (const line of runner.stdout) {
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\].*[0-9]\n/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            runner.unref();
            runner.kill();
            break;
          }

          expect(line).toContain(`[#!root] Reloaded: ${reloadCounter}`);
          any = true;
        }

        if (any) await onReload();
      }

      expect(reloadCounter).toBeGreaterThanOrEqual(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

it.each(["hot-file-loader.file", "hot-file-loader.css"])(
  "should hot reload when `%s` is overwritten",
  async (targetFilename: string) => {
    const root = hotRunnerRoot;
    const target = join(cwd, targetFilename);
    try {
      var runner = spawn({
        cmd: [bunExe(), "--hot", "run", root],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      var reloadCounter = 0;

      async function onReload() {
        writeFileSync(target, readFileSync(target, "utf-8"));
      }

      var str = "";
      for await (const line of runner.stdout) {
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\].*[0-9]\n/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            runner.unref();
            runner.kill();
            break;
          }

          expect(line).toContain(`[#!root] Reloaded: ${reloadCounter}`);
          any = true;
        }

        if (any) await onReload();
      }

      expect(reloadCounter).toBeGreaterThanOrEqual(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

it(
  "should recover from errors",
  async () => {
    const root = hotRunnerRoot;
    try {
      var runner = spawn({
        cmd: [bunExe(), "--hot", "run", root],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      let reloadCounter = 0;
      const input = readFileSync(root, "utf-8");
      function onReloadGood() {
        writeFileSync(root, input);
      }

      function onReloadError() {
        writeFileSync(root, "throw new Error('error');\n");
      }

      var queue = [onReloadError, onReloadGood, onReloadError, onReloadGood];
      var errors: string[] = [];
      var onError: (...args: any[]) => void;
      (async () => {
        for await (let line of runner.stderr) {
          var str = new TextDecoder().decode(line);
          errors.push(str);
          // @ts-ignore
          onError && onError(str);
        }
      })();

      var str = "";
      for await (const line of runner.stdout) {
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\].*[0-9]\n/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            runner.unref();
            runner.kill();
            break;
          }

          expect(line).toContain(`[#!root] Reloaded: ${reloadCounter}`);
          any = true;
        }

        if (any) {
          queue.shift()!();
          await new Promise<void>((resolve, reject) => {
            if (errors.length > 0) {
              errors.length = 0;
              resolve();
              return;
            }

            onError = resolve;
          });

          queue.shift()!();
        }
      }

      expect(reloadCounter).toBe(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

it(
  "should not hot reload when a random file is written",
  async () => {
    const root = hotRunnerRoot;
    try {
      var runner = spawn({
        cmd: [bunExe(), "--hot", "run", root],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      // First await the initial run's output — racing this against a fixed
      // sleep meant a slow CI box's >200 ms subprocess startup lost the race
      // and `reloadCounter` stayed 0.
      const reader = runner.stdout.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (!/\[#!root\] Reloaded: 1\n/.test(buf)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("subprocess exited before initial run output");
        buf += dec.decode(value);
      }
      // Now write+unlink an unrelated file and assert it does NOT trigger a
      // second reload. Only the bounded "did anything else arrive?" check is
      // time-based; the condition we care about (initial output) is awaited.
      const code = readFileSync(root, "utf-8");
      writeFileSync(root + ".another.yet.js", code);
      unlinkSync(root + ".another.yet.js");
      buf = "";
      const sawSecond = await Promise.race([
        Bun.sleep(200).then(() => false),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) return false;
            buf += dec.decode(value);
            if (/\[#!root\] Reloaded: 2/.test(buf)) return true;
          }
        })(),
      ]);
      reader.releaseLock();
      runner.kill(0);
      runner.unref();

      expect(sawSecond).toBe(false);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

it(
  "should hot reload when a file is deleted and rewritten",
  async () => {
    try {
      const root = hotRunnerRoot + ".tmp.js";
      copyFileSync(hotRunnerRoot, root);
      var runner = spawn({
        cmd: [bunExe(), "--hot", "run", root],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      var reloadCounter = 0;

      async function onReload() {
        const contents = readFileSync(root, "utf-8");
        rmSync(root);
        writeFileSync(root, contents);
      }

      var str = "";
      for await (const line of runner.stdout) {
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\].*[0-9]\n/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            runner.unref();
            runner.kill();
            break;
          }

          expect(line).toContain(`[#!root] Reloaded: ${reloadCounter}`);
          any = true;
        }

        if (any) await onReload();
      }
      rmSync(root);
      expect(reloadCounter).toBe(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

it(
  "should hot reload when a file is renamed() into place",
  async () => {
    const root = hotRunnerRoot + ".tmp.js";
    copyFileSync(hotRunnerRoot, root);
    try {
      var runner = spawn({
        cmd: [bunExe(), "--hot", "run", root],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      var reloadCounter = 0;

      async function onReload() {
        const contents = readFileSync(root, "utf-8");
        rmSync(root + ".tmpfile", { force: true });
        await 1;
        writeFileSync(root + ".tmpfile", contents);
        await 1;
        rmSync(root);
        await 1;
        renameSync(root + ".tmpfile", root);
        await 1;
      }

      var str = "";
      for await (const line of runner.stdout) {
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\].*[0-9]\n/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            runner.unref();
            runner.kill();
            break;
          }

          expect(line).toContain(`[#!root] Reloaded: ${reloadCounter}`);
          any = true;
        }

        if (any) await onReload();
      }
      rmSync(root);
      expect(reloadCounter).toBe(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

const comment_line = "//" + Buffer.alloc(2000, "B").toString() + "\n";
const comment_spam = Buffer.alloc(comment_line.length * 1000, comment_line).toString();

// writeFileSync of a ~2MB file is non-atomic (truncate + N×write); each write
// emits a watcher event so --hot can re-read mid-write (Linux: EBADF /
// "Unexpected ..." / :1:12 mis-remap; Windows: ReadDirectoryChangesW
// internal-buffer overflow → nbytes==0 → WindowsWatcher.next() ESHUTDOWN →
// watcher thread dies → child exits → reloadCounter<50). Atomic write+rename
// so the watched path only ever flips between complete versions.
function writeHotFileAtomicSync(path: string, content: string) {
  const tmp = path + ".next";
  writeFileSync(tmp, content);
  // rmSync first on Windows so renameSync doesn't EPERM on the existing target.
  // driveErrorReloadCycle skips the transient "Module not found"/ENOENT/EPERM
  // that --hot can print when a reload lands in the gap between rm and rename.
  if (process.platform === "win32") {
    try {
      rmSync(path);
    } catch {}
  }
  renameSync(tmp, path);
}

it(
  "should work with sourcemap generation",
  async () => {
    writeFileSync(
      hotRunnerRoot,
      `// source content
${comment_spam}
throw new Error('0');`,
    );
    await using runner = spawn({
      cmd: [bunExe(), "--smol", "--hot", "run", hotRunnerRoot],
      env: bunEnv,
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const reloadCounter = await driveErrorReloadCycle(runner, {
      targetCount: 50,
      onReload: counter => {
        writeHotFileAtomicSync(
          hotRunnerRoot,
          `// source content
${comment_spam}
${Buffer.alloc(counter * 2, " ").toString()}throw new Error(${counter});`,
        );
      },
      verifyLine: (errorLine, nextLine, counter) => {
        if (!nextLine) throw new Error(errorLine);
        const match = nextLine.match(/\s*at.*?:1003:(\d+)$/);
        if (!match) throw new Error("invalid string: " + nextLine);
        const col = match[1];
        expect(Number(col)).toBe(1 + "throw new ".length + counter * 2);
      },
    });
    await runner.exited;
    expect(reloadCounter).toBe(50);
  },
  timeout,
);

it(
  "should not remap against a stale sourcemap after a partial-file reload",
  async () => {
    // Regression: the watcher can deliver a second reload Task between the
    // moment a module's eval rejects and the moment that rejection is
    // printed. The second reload re-transpiles and overwrites
    // source_mappings[path] in place, so the still-unreported error gets
    // remapped against the wrong map and transpiled coordinates leak
    // through — or, since the new pending promise replaces the old one,
    // the error is dropped entirely.
    //
    // To make the window deterministic the hot file truncates itself to a
    // comment-only stub immediately before throwing, guaranteeing a fresh
    // watcher event lands between reject and report.
    const writeFull = (counter: number) =>
      writeHotFileAtomicSync(
        hotRunnerRoot,
        `// source content
${comment_spam}require("fs").writeFileSync(__filename, "// stub ${counter}\\n");
${Buffer.alloc(counter * 2, " ").toString()}throw new Error('${counter}');`,
      );
    writeFull(0);
    await using runner = spawn({
      cmd: [bunExe(), "--smol", "--hot", "run", hotRunnerRoot],
      env: bunEnv,
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const reloadCounter = await driveErrorReloadCycle(runner, {
      targetCount: 20,
      onReload: writeFull,
      verifyLine: (errorLine, nextLine, counter) => {
        if (!nextLine) throw new Error(errorLine);
        const match = nextLine.match(/\s*at.*?:(\d+):(\d+)\)?$/);
        if (!match) throw new Error("no :line:col in: " + JSON.stringify(nextLine));
        if (match[1] !== "1003") throw new Error("expected :1003: but got: " + JSON.stringify(nextLine));
        expect(Number(match[2])).toBe(1 + "throw new ".length + counter * 2);
      },
    });
    await runner.exited;
    expect(reloadCounter).toBe(20);
  },
  longTimeout,
);

it(
  "should work with sourcemap loading",
  async () => {
    let bundleIn = join(cwd, "bundle_in.ts");
    rmSync(hotRunnerRoot);
    writeFileSync(
      bundleIn,
      `// source content
//
//
throw new Error('0');`,
    );
    await using bundler = spawn({
      cmd: [bunExe(), "build", "--watch", bundleIn, "--target=bun", "--sourcemap=inline", "--outfile", hotRunnerRoot],
      env: bunEnv,
      cwd,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    waitForFileToExist(hotRunnerRoot, 20);
    await using runner = spawn({
      cmd: [bunExe(), "--hot", "run", hotRunnerRoot],
      env: bunEnv,
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    let done = false;
    const reloadCounter = await Promise.race([
      driveErrorReloadCycle(runner, {
        targetCount: 50,
        onReload: counter => {
          writeFileSync(
            bundleIn,
            `// source content
// etc etc
// etc etc
${Buffer.alloc(counter * 2, " ").toString()}throw new Error(${counter});`,
          );
        },
        verifyLine: (_errorLine, nextLine, counter) => {
          if (!nextLine) throw new Error(_errorLine);
          // Partial bundle read: --hot picked up the outfile before --watch finished
          // writing the inline sourcemap trailer. Retry the write.
          if (nextLine.includes("hot-runner-root.js")) return "retry";
          expect(nextLine).toInclude("bundle_in.ts");
          const match = nextLine.match(/\s*at.*?:4:(\d+)$/);
          if (!match) throw new Error("invalid stack trace: " + nextLine);
          const col = match[1];
          expect(Number(col)).toBe(1 + "throw ".length + counter * 2);
        },
      }).finally(() => {
        done = true;
      }),
      bundler.exited.then(code => {
        if (!done) throw new Error(`bundler exited early with code ${code}`);
        return -1; // Ignored — race already resolved
      }),
    ]);
    expect(reloadCounter).toBe(50);
    bundler.kill();
  },
  timeout,
);

const long_comment = Buffer.alloc(400000, "BBBB").toString();

it(
  "should work with sourcemap loading with large files",
  async () => {
    let bundleIn = join(cwd, "bundle_in.ts");
    rmSync(hotRunnerRoot);
    writeFileSync(
      bundleIn,
      `// ${long_comment}
//
console.error("RSS: %s", process.memoryUsage.rss());
throw new Error('0');`,
    );
    await using bundler = spawn({
      cmd: [
        //
        bunExe(),
        "build",
        "--watch",
        bundleIn,
        "--target=bun",
        "--sourcemap=inline",
        "--outfile",
        hotRunnerRoot,
      ],
      env: bunEnv,
      cwd,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    waitForFileToExist(hotRunnerRoot, 20);
    await using runner = spawn({
      cmd: [
        //
        bunExe(),
        "--hot",
        "run",
        hotRunnerRoot,
      ],
      env: bunEnv,
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    let done2 = false;
    const reloadCounter = await Promise.race([
      driveErrorReloadCycle(runner, {
        targetCount: 50,
        onReload: counter => {
          writeHotFileAtomicSync(
            bundleIn,
            `// ${long_comment}
console.error("RSS: %s", process.memoryUsage.rss());
//
${Buffer.alloc(counter * 2, " ").toString()}throw new Error(${counter});`,
          );
        },
        verifyLine: (_errorLine, nextLine, counter) => {
          if (!nextLine) throw new Error(_errorLine);
          // Partial bundle read: --hot picked up the outfile before --watch finished
          // writing the inline sourcemap trailer. Retry the write.
          if (nextLine.includes("hot-runner-root.js")) return "retry";
          expect(nextLine).toInclude("bundle_in.ts");
          const match = nextLine.match(/\s*at.*?:4:(\d+)$/);
          if (!match) throw new Error("invalid stack trace: " + nextLine);
          const col = match[1];
          expect(Number(col)).toBe(1 + "throw ".length + counter * 2);
        },
      }).finally(() => {
        done2 = true;
      }),
      bundler.exited.then(code => {
        if (!done2) throw new Error(`bundler exited early with code ${code}`);
        return -1; // Ignored — race already resolved
      }),
    ]);
    expect(reloadCounter).toBe(50);
    bundler.kill();
    await runner.exited;
    // TODO: bun has a memory leak when --hot is used on very large files
  },
  longTimeout,
);

// Bounds how long a build that never performs the awaited reload keeps a test
// waiting; the reload itself is awaited, never timed.
const reloadDeadline = isDebug ? 20_000 : 5_000;

/**
 * Awaits markers a --hot child writes to stdout, in order: each `next()`
 * searches only past the previous match, so a marker printed before the save
 * that was supposed to produce it does not count. Resolves to the output it
 * skipped over to reach the marker.
 */
function stdoutMarkers(runner: ReturnType<typeof spawn>) {
  const decoder = new TextDecoder();
  let output = "";
  let ended: string | undefined;
  let cursor = 0;
  let wake = () => {};
  (async () => {
    try {
      for await (const chunk of runner.stdout as ReadableStream<Uint8Array>) {
        output += decoder.decode(chunk, { stream: true });
        wake();
      }
      ended = "child closed stdout";
    } catch (error) {
      ended = `reading stdout failed: ${error}`;
    }
    wake();
  })();
  return {
    async next(marker: string) {
      const line = `${marker}\n`;
      let expired = false;
      const { promise: expiry, resolve: expire } = Promise.withResolvers<void>();
      const timer = setTimeout(() => {
        expired = true;
        expire();
      }, reloadDeadline);
      try {
        while (true) {
          const index = output.indexOf(line, cursor);
          if (index !== -1) {
            const skipped = output.slice(cursor, index);
            cursor = index + line.length;
            return skipped;
          }
          if (ended) throw new Error(`${ended} before printing ${JSON.stringify(marker)}; stdout so far:\n${output}`);
          if (expired) throw new Error(`${JSON.stringify(marker)} was never printed; stdout so far:\n${output}`);
          await Promise.race([new Promise<void>(resolve => (wake = resolve)), expiry]);
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// Entry-file contents for the tests below: a generation that prints `marker`
// and finishes, or prints it and then never settles its top-level await.
const finishes = (marker: string) => `console.write(${JSON.stringify(marker + "\n")});\n`;
const hangs = (marker: string) => `${finishes(marker)}await new Promise(() => {});\n`;

function spawnHot(dir: string, ...args: string[]) {
  return spawn({
    cmd: [bunExe(), "--hot", "run", ...args, join(dir, "entry.ts")],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
}

describe.concurrent("a generation whose top-level await has not settled", () => {
  it(
    "is replaced by the next save of the entry",
    async () => {
      using dir = tempDir("hot-tla", { "entry.ts": finishes("[#!tla] 1 ok") });
      await using runner = spawnHot(String(dir));
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] 1 ok");

      writeFileSync(join(String(dir), "entry.ts"), hangs("[#!tla] 2 hung"));
      await markers.next("[#!tla] 2 hung");

      writeFileSync(join(String(dir), "entry.ts"), finishes("[#!tla] 3 ok"));
      await markers.next("[#!tla] 3 ok");
    },
    timeout,
  );

  it(
    "is replaced even when it is the first generation and the await is in an import that keeps the loop busy",
    async () => {
      using dir = tempDir("hot-tla-import", {
        "entry.ts": `import "./dep.ts";\n${finishes("[#!tla] entry ran")}`,
        "dep.ts": `setInterval(() => {}, 1_000_000);\n${hangs("[#!tla] dep hung")}`,
      });
      await using runner = spawnHot(String(dir));
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] dep hung");

      writeFileSync(join(String(dir), "dep.ts"), finishes("[#!tla] dep ok"));
      await markers.next("[#!tla] dep ok");
      await markers.next("[#!tla] entry ran");
    },
    timeout,
  );

  // A save that lands while a generation is still being loaded is applied once
  // that generation has loaded, even though it then hangs. The entry imports
  // dep.ts, whose load the plugin holds open until entry.ts has been saved
  // over; dep.ts then evaluates and hangs. The save goes to entry.ts because it
  // was transpiled, and so watched, before dep.ts started loading; a file the
  // plugin provides is not watched on every platform until its generation is
  // up. Covered twice: for the first generation, while the process is still in
  // its initial load, and for a later one, once it is in its run loop.
  it(
    "still lets a save that landed while it was loading reload it",
    async () => {
      const importsDep = `import "./dep.ts";\n`;
      using dir = tempDir("hot-tla-held", {
        "entry.ts": importsDep,
        "dep.ts": hangs("[#!tla] dep hung"),
        "hold-plugin.ts": `
          import { readFileSync } from "fs";
          import { join } from "path";
          const entry = join(import.meta.dir, "entry.ts");
          Bun.plugin({
            name: "hold",
            setup(build) {
              build.onLoad({ filter: /dep[.]ts$/ }, async ({ path }) => {
                const contents = readFileSync(path, "utf8");
                const entryBefore = readFileSync(entry, "utf8");
                console.write("[#!tla] holding dep\\n");
                while (readFileSync(entry, "utf8") === entryBefore) await Bun.sleep(5);
                // A deferred reload is not observable; give the save's watcher
                // event time to reach the still-loading generation.
                await Bun.sleep(${isDebug ? 1_000 : 300});
                return { contents, loader: "ts" };
              });
            },
          });
        `,
      });
      const entry = join(String(dir), "entry.ts");
      await using runner = spawnHot(String(dir), `--preload=${join(String(dir), "hold-plugin.ts")}`);
      const markers = stdoutMarkers(runner);

      await markers.next("[#!tla] holding dep");
      // Only the run loop emits beforeExit: once it has, the next generation is
      // held while the process is in its run loop, not still in its initial load.
      writeFileSync(
        entry,
        finishes("[#!tla] save 1 applied") + `process.on("beforeExit", () => console.log("[#!tla] idle"));\n`,
      );
      await markers.next("[#!tla] dep hung");
      await markers.next("[#!tla] save 1 applied");
      await markers.next("[#!tla] idle");

      writeFileSync(entry, importsDep);
      await markers.next("[#!tla] holding dep");
      writeFileSync(entry, finishes("[#!tla] save 2 applied"));
      await markers.next("[#!tla] dep hung");
      await markers.next("[#!tla] save 2 applied");
    },
    timeout,
  );
  // A generation that was replaced while parked on its await can still finish
  // later, and what it exports then reaches the generated entry wrapper after
  // the newer generation's did. The newer generation finishes the old one on
  // request, so the order does not depend on timing.
  it.each([
    ["export default", "export default config;"],
    ["a thenable namespace", "export function then(resolve) { resolve({ default: config }); }"],
  ])(
    "is not applied as the server config when it finishes after a newer generation (%s)",
    async (_shape, exportsConfig) => {
      const oldConfigRead = "[#!tla] old config read";
      using dir = tempDir("hot-tla-late", { "entry.ts": finishes("[#!tla] ready") });
      const entry = join(String(dir), "entry.ts");
      const finishOld = join(String(dir), "finish-old");
      await using runner = spawnHot(String(dir));
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] ready");

      writeFileSync(
        entry,
        `
          console.write("[#!tla] old start\\n");
          await new Promise(resolve => (globalThis.finishOld = resolve));
          console.write("[#!tla] old finished\\n");
          setTimeout(() => console.write("[#!tla] old settled\\n"), 0);
          const config = {
            port: 0,
            get fetch() {
              console.write(${JSON.stringify(oldConfigRead + "\n")});
              return () => new Response("old");
            },
          };
          ${exportsConfig}
        `,
      );
      await markers.next("[#!tla] old start");

      writeFileSync(
        entry,
        `
          import { existsSync } from "fs";
          console.write("[#!tla] new start\\n");
          (async () => {
            while (!existsSync(${JSON.stringify(finishOld)})) await Bun.sleep(5);
            globalThis.finishOld();
          })();
          export default { port: 0, fetch: () => new Response("new") };
        `,
      );
      await markers.next("[#!tla] new start");

      writeFileSync(finishOld, "");
      await markers.next("[#!tla] old finished");
      // The wrapper of the old generation runs as soon as its module finishes,
      // so before the timer that prints this marker.
      const afterOldFinished = await markers.next("[#!tla] old settled");
      expect(afterOldFinished).not.toContain(oldConfigRead);
    },
    timeout,
  );

  // A module body can run the event loop itself: Bun.build() waits for an
  // async plugin setup() before it returns. A save that lands meanwhile is
  // applied once the body is done, not under it.
  it.each([
    ["before its first await", ""],
    ["after an await", "await 0;"],
  ])(
    "is not replaced while its body is still running (%s)",
    async (_when, beforeBuild) => {
      using dir = tempDir("hot-tla-body", { "entry.ts": finishes("[#!tla] ready") });
      const entry = join(String(dir), "entry.ts");
      await using runner = spawnHot(String(dir));
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] ready");

      writeFileSync(
        entry,
        `
          import { readFileSync } from "fs";
          ${beforeBuild}
          const source = readFileSync(import.meta.path, "utf8");
          console.write("[#!tla] body running\\n");
          try {
            Bun.build({
              entrypoints: [import.meta.path],
              plugins: [
                {
                  name: "runs-the-event-loop",
                  async setup() {
                    while (readFileSync(import.meta.path, "utf8") === source) await Bun.sleep(5);
                    // A deferred reload is not observable; give the save's
                    // watcher event time to reach the body that is waiting here.
                    await Bun.sleep(${isDebug ? 1_000 : 300});
                    throw new Error("no build wanted");
                  },
                },
              ],
            });
          } catch {}
          console.write("[#!tla] body done\\n");
          await new Promise(() => {});
        `,
      );
      await markers.next("[#!tla] body running");

      writeFileSync(entry, finishes("[#!tla] new start"));
      const whileBodyRan = await markers.next("[#!tla] body done");
      expect(whileBodyRan).not.toContain("[#!tla] new start");
      await markers.next("[#!tla] new start");
    },
    timeout,
  );

  // The fetch of a dynamic import is a load as well. A generation replaced
  // while one is in flight lets that fetch finish into the next generation's
  // module registry, which then runs the source from before the save.
  it(
    "is not replaced while a dynamic import it awaits is still being fetched",
    async () => {
      // Only types, so transpiling dep.ts is slow and the module it becomes is
      // one line. The saves below land while that transpile is in flight; a
      // transpile that is too fast can only let the test pass, never fail it.
      const typeLine = "type T = { a: string; b: [1, 2, 3]; c: Record<string, Array<Map<string, Set<number>>>> };\n";
      const megabytes = isDebug ? 2 : 8;
      const lines = Math.ceil((megabytes * 1024 * 1024) / typeLine.length);
      const types = Buffer.alloc(lines * typeLine.length, typeLine).toString();
      const dep = (v: number) => `export const v = ${v};\n${types}`;
      const importsDep = (generation: number) => `
        const dep = import("./dep.ts");
        console.write("[#!tla] ${generation} importing\\n");
        console.write("[#!tla] ${generation} sees v=" + (await dep).v + "\\n");
      `;
      using dir = tempDir("hot-tla-dynamic-import", {
        "entry.ts": importsDep(1),
        "dep.ts": dep(1),
        // Renamed over dep.ts, so the child never reads a half-written file. Windows does not rename over a file that is open.
        ...(isWindows ? {} : { "staged/dep.ts": dep(2) }),
      });
      const entry = join(String(dir), "entry.ts");
      await using runner = spawnHot(String(dir));
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] 1 sees v=1");

      writeFileSync(entry, importsDep(2));
      await markers.next("[#!tla] 2 importing");

      if (isWindows) writeFileSync(join(String(dir), "dep.ts"), dep(2));
      else renameSync(join(String(dir), "staged", "dep.ts"), join(String(dir), "dep.ts"));
      writeFileSync(entry, importsDep(3));
      await markers.next("[#!tla] 3 sees v=2");
    },
    timeout,
  );

  // The same when a plugin's onLoad is the fetch in flight. The first load
  // takes the version from before the save and finishes first, the way a
  // fetch that started earlier does.
  it(
    "is not replaced while a plugin is still loading a dynamic import it awaits",
    async () => {
      const importsDep = (generation: number) => `
        console.write("[#!tla] ${generation} importing\\n");
        console.write("[#!tla] ${generation} sees v=" + (await import("./dep.ts")).v + "\\n");
      `;
      using dir = tempDir("hot-tla-plugin-import", {
        "entry.ts": finishes("[#!tla] ready"),
        "dep.ts": "",
        "version.txt": "1",
        "slow-plugin.ts": `
          import { readFileSync } from "fs";
          import { join } from "path";
          const entry = join(import.meta.dir, "entry.ts");
          let loads = 0;
          let firstLoadDone = false;
          Bun.plugin({
            name: "slow",
            setup(build) {
              build.onLoad({ filter: /dep[.]ts$/ }, async () => {
                const version = readFileSync(join(import.meta.dir, "version.txt"), "utf8");
                if (++loads === 1) {
                  const entryBefore = readFileSync(entry, "utf8");
                  console.write("[#!tla] holding dep\\n");
                  while (readFileSync(entry, "utf8") === entryBefore) await Bun.sleep(5);
                  // A deferred reload is not observable; give the save's
                  // watcher event time to reach the generation that waits here.
                  await Bun.sleep(${isDebug ? 1_000 : 300});
                  firstLoadDone = true;
                } else {
                  while (!firstLoadDone) await Bun.sleep(5);
                }
                return { contents: "export const v = " + version + ";", loader: "ts" };
              });
            },
          });
        `,
      });
      const entry = join(String(dir), "entry.ts");
      await using runner = spawnHot(String(dir), `--preload=${join(String(dir), "slow-plugin.ts")}`);
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] ready");

      writeFileSync(entry, importsDep(2));
      await markers.next("[#!tla] holding dep");

      writeFileSync(join(String(dir), "version.txt"), "2");
      writeFileSync(entry, importsDep(3));
      await markers.next("[#!tla] 3 sees v=2");
    },
    timeout,
  );

  // A fetch that never settles belongs to the generation that started it. It
  // does not keep a later generation from being replaced.
  it(
    "is replaced although a plugin load from an earlier generation never settled",
    async () => {
      using dir = tempDir("hot-tla-old-fetch", {
        "entry.ts": `
          import("./never.hang").catch(() => {});
          while (!globalThis.loadHeld) await Bun.sleep(1);
          console.write("[#!tla] 1 ok\\n");
        `,
        "never.hang": "",
        "hang-plugin.ts": `
          Bun.plugin({
            name: "hang",
            setup(build) {
              build.onLoad({ filter: /[.]hang$/ }, () => {
                globalThis.loadHeld = true;
                return new Promise(() => {});
              });
            },
          });
        `,
      });
      const entry = join(String(dir), "entry.ts");
      await using runner = spawnHot(String(dir), `--preload=${join(String(dir), "hang-plugin.ts")}`);
      const markers = stdoutMarkers(runner);
      await markers.next("[#!tla] 1 ok");

      writeFileSync(entry, hangs("[#!tla] 2 hung"));
      await markers.next("[#!tla] 2 hung");

      writeFileSync(entry, finishes("[#!tla] 3 ok"));
      await markers.next("[#!tla] 3 ok");
    },
    timeout,
  );
});
