import { spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
import { chmodSync, chownSync, copyFileSync, cpSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir, tmpdirSync, waitForFileToExist } from "harness";
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
console.error("RSS: %s", process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint() : process.memoryUsage.rss());
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
console.error("RSS: %s", process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint() : process.memoryUsage.rss());
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

// The watcher thread walks the cached directory listing of a changed watched
// directory, while FileSystemRouter.reload() and Bun.build() rewrite the same
// listing in place on the JS/bundler threads. Skipped on Windows (the watcher
// does not touch the listing there) and on non-ASAN builds: the reload/build
// mix also drives the resolver-side lookup races that #37274 and #34411 fix,
// which segfault this fixture on weakly ordered release lanes (seen on
// ubuntu 25.04 aarch64). ASAN builds are where the watcher-side
// use-after-free this guards against is detectable.
it.skipIf(isWindows || !isASAN)(
  "directory events race reload() and Bun.build() rewriting the same cached listing",
  async () => {
    const files: Record<string, string> = {
      "main.ts": /* ts */ `
        import "./pages/p1.tsx";
        import "./pages/p2.tsx";
        import path from "path";
        const pagesDir = path.join(import.meta.dir, "pages");
        const entrypoints: string[] = [];
        for (let i = 1; i <= 20; i++) entrypoints.push(path.join(pagesDir, "p" + i + ".tsx"));
        const router = new Bun.FileSystemRouter({
          dir: pagesDir,
          style: "nextjs",
          fileExtensions: [".tsx"],
        });
        // The first build completes with generation 0 and the bundle thread
        // then bumps its generation, so every later build's resolver re-reads
        // the directory listing in place.
        await Bun.build({ entrypoints, target: "bun", throw: false });
        console.log("ready");
        let matches = 0;
        let buildsOk = true;
        for (let round = 0; round < 30; round++) {
          const builds = Array.from({ length: 4 }, () =>
            Bun.build({ entrypoints, target: "bun", throw: false }),
          );
          for (let i = 0; i < 50; i++) {
            router.reload();
            const m = router.match("/p7");
            if (m && m.filePath.endsWith("p7.tsx")) matches++;
          }
          const results = await Promise.all(builds);
          buildsOk &&= results.every(r => r.success);
        }
        console.log("matches", matches, "builds-ok", buildsOk);
        process.exit(0);
      `,
    };
    for (let i = 1; i <= 20; i++) {
      files[`pages/p${i}.tsx`] = `export default ${i};\n`;
    }
    using dir = tempDir("hot-direntry-race", files);

    // --hot watches main.ts, the imported pages, and (through them) pages/
    // itself as a directory. Run in a subprocess so a crash is observable as
    // a signal instead of taking down the test runner.
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    let stdout = "";
    const ready = Promise.withResolvers<void>();
    const stdoutDone = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.includes("ready\n")) ready.resolve();
      }
    })();
    // Drain stderr from the start so a spewing child (crash report, ASAN
    // output) cannot fill the pipe and block instead of exiting.
    const stderrDone = proc.stderr.text();
    // If the fixture dies before printing "ready", unblock the wait so the
    // assertions below report the crash instead of hanging.
    const exited = proc.exited.then(code => {
      ready.resolve();
      return code;
    });
    await ready.promise;

    // Churn pages/ from outside while the fixture's reload()/build() loops
    // rewrite its cached listing: every write lands a directory event on the
    // watcher thread, which then walks that listing. The churned names use a
    // transpilable extension (so the walk visits them) but are never imported
    // and are excluded by fileExtensions, so no reload fires and the
    // fixture's counters stay deterministic.
    let running = true;
    void exited.finally(() => {
      running = false;
    });
    let i = 0;
    while (running) {
      for (let k = 0; k < 4; k++, i++) {
        writeFileSync(join(String(dir), "pages", `churn-${i % 32}.ts`), `export const v = ${i};\n`);
      }
      if (i % 64 === 0) {
        rmSync(join(String(dir), "pages", `churn-${(i + 8) % 32}.ts`), { force: true });
      }
      await Bun.sleep(4);
    }

    const [stderr, exitCode] = await Promise.all([stderrDone, exited]);
    await stdoutDone;
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "ready\nmatches 1500 builds-ok true\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
  isDebug ? 300_000 : 60_000,
);

// A directory event for a directory whose entries cache holds a readdir error
// (EntriesOption::Err, cached by any non-ENOENT failure such as EACCES) used
// to feed the error slot to EntriesOption::entries(), which panics and aborts
// the whole --hot process. Skipped on Windows (the watcher does not touch the
// listing there).
{
  // Root bypasses DAC, so chmod 0 won't yield EACCES. When running as root on
  // Linux we drop to `nobody` via runuser (and chown the temp dir so the
  // fixture can chmod it back). Otherwise we run the fixture directly.
  const isRoot = !isWindows && process.getuid?.() === 0;
  const nobody = (() => {
    try {
      // /etc/passwd format: name:x:uid:gid:gecos:home:shell
      const line = readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .find(l => l.startsWith("nobody:"));
      if (!line) return null;
      const [, , uid, gid] = line.split(":");
      if (!Number.isInteger(+uid) || !Number.isInteger(+gid)) return null;
      return { uid: +uid, gid: +gid };
    } catch {
      return null;
    }
  })();
  const canUseRunuser = isLinux && isRoot && !!Bun.which("runuser") && nobody !== null;
  const canTriggerEACCES = !isWindows && (!isRoot || canUseRunuser);

  it.skipIf(!canTriggerEACCES)(
    "a directory event for a dir whose cached listing is a read error does not kill the process",
    async () => {
      using dir = tempDir("hot-direntry-err", {
        "main.ts": /* ts */ `
          import "./pages/p1.tsx";
          import { chmodSync } from "fs";
          const g = globalThis as any;
          // --hot re-runs this module on reload; keep the first run's stdin hook.
          if (!g.__hooked) {
            g.__hooked = true;
            let buf = "";
            process.stdin.on("data", d => {
              buf += d;
              let i;
              while ((i = buf.indexOf("\\n")) !== -1) {
                const line = buf.slice(0, i);
                buf = buf.slice(i + 1);
                if (line === "err") {
                  // Make pages/ unreadable and fail a resolve through it:
                  // readDirectory(pages) hits EACCES, which caches the error
                  // under the watched directory's cache key. Then restore.
                  chmodSync(import.meta.dir + "/pages", 0o000);
                  let threw = false;
                  try {
                    Bun.resolveSync("./pages/nope.js", import.meta.dir);
                  } catch {
                    threw = true;
                  }
                  chmodSync(import.meta.dir + "/pages", 0o755);
                  console.log("err-cached:" + threw);
                } else if (line === "exit") {
                  process.exit(0);
                }
              }
            });
          }
          console.log("ready");
        `,
        "pages/p1.tsx": "export default 1;\n",
      });
      const root = String(dir);

      let cmd = [bunExe(), "--hot", "main.ts"];
      if (canUseRunuser) {
        // Give `nobody` ownership so the fixture's chmodSync calls succeed, and
        // open up perms so `nobody` can traverse/read everything it needs.
        for (const p of [root, join(root, "main.ts"), join(root, "pages"), join(root, "pages", "p1.tsx")]) {
          chmodSync(p, 0o777);
          chownSync(p, nobody!.uid, nobody!.gid);
        }
        cmd = ["runuser", "-u", "nobody", "--", bunExe(), "--hot", "main.ts"];
      }

      try {
        await using proc = spawn({
          cmd,
          env: bunEnv,
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        });

        let stdout = "";
        const waiters: Array<{ test: (s: string) => boolean; resolve: () => void }> = [];
        const poke = () => {
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].test(stdout)) {
              waiters[i].resolve();
              waiters.splice(i, 1);
            }
          }
        };
        const stdoutDone = (async () => {
          const decoder = new TextDecoder();
          for await (const chunk of proc.stdout) {
            stdout += decoder.decode(chunk, { stream: true });
            poke();
          }
        })();
        const stderrDone = proc.stderr.text();
        // A crash resolves every pending wait so the assertions below report
        // the death instead of hanging.
        const exited = proc.exited.then(code => {
          for (const w of waiters.splice(0)) w.resolve();
          return code;
        });
        const waitFor = (test: (s: string) => boolean) =>
          new Promise<void>(resolve => {
            if (test(stdout)) return resolve();
            waiters.push({ test, resolve });
          });
        const countReady = (s: string) => s.split("ready\n").length - 1;

        await waitFor(s => s.includes("ready\n"));
        proc.stdin.write("err\n");
        await proc.stdin.flush();
        await waitFor(s => s.includes("err-cached:true\n"));

        // The only directory event of the whole test: touching the watched
        // page makes the watcher probe the error slot (directory event) and
        // reload the fixture (file event). The second "ready" proves the
        // watcher thread survived the probe.
        writeFileSync(join(root, "pages", "p1.tsx"), "export default 1;\n");
        await waitFor(s => countReady(s) >= 2);

        proc.stdin.write("exit\n");
        await proc.stdin.flush();
        const [stderr, exitCode] = await Promise.all([stderrDone, exited]);
        await stdoutDone;
        expect({
          stdout,
          // Debug builds print a reload notice; release builds print nothing.
          stderr: stderr.replaceAll("DEBUG: Reloading...\n", ""),
          exitCode,
          signalCode: proc.signalCode,
        }).toEqual({
          stdout: "ready\nerr-cached:true\nready\n",
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
      } finally {
        // Ensure tempDir cleanup can remove the directory even if the fixture
        // crashed between the two chmod calls.
        try {
          chmodSync(join(root, "pages"), 0o755);
        } catch {}
      }
    },
    isDebug ? 120_000 : 30_000,
  );
}
