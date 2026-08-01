import { spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
import {
  copyFileSync,
  cpSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, tempDir, tmpdirSync, waitForFileToExist } from "harness";
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
  },
  longTimeout,
);

// /proc/<pid>/fd is Linux-only.
it.skipIf(!isLinux)(
  "does not leak file descriptors on each reload",
  async () => {
    using dir = tempDir("hot-fd-leak", {
      "entry.ts": 'import { value } from "./sub/dep.ts";\nconsole.log("RELOAD", value, process.pid);\n',
      "sub/dep.ts": "export const value = 0;\n",
    });
    const dirReal = realpathSync(String(dir));
    const depPath = join(String(dir), "sub", "dep.ts");

    await using runner = spawn({
      cmd: [bunExe(), "--hot", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const stderrDrain = runner.stderr.text();

    // Resolve once stdout prints `RELOAD <n>`; the module logs that line on
    // every re-evaluation.
    const seen = new Set<number>();
    let pending: { n: number; resolve: () => void } | null = null;
    let childPid = 0;
    const pump = (async () => {
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of runner.stdout) {
        buffered += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf("\n")) !== -1) {
          const line = buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
          const match = /^RELOAD (\d+) (\d+)$/.exec(line);
          if (!match) continue;
          const n = Number(match[1]);
          childPid ||= Number(match[2]);
          seen.add(n);
          if (pending?.n === n) {
            pending.resolve();
            pending = null;
          }
        }
      }
    })();
    const waitForReload = (n: number) =>
      new Promise<void>((resolve, reject) => {
        if (seen.has(n)) return resolve();
        pending = { n, resolve };
        runner.exited.then(code => reject(new Error(`--hot exited early with code ${code}`)));
      });

    const countProjectFds = () => {
      const counts: Record<string, number> = {};
      for (const fd of readdirSync(`/proc/${childPid}/fd`)) {
        let target: string;
        try {
          target = readlinkSync(`/proc/${childPid}/fd/${fd}`);
        } catch {
          continue;
        }
        if (target === dirReal || target.startsWith(dirReal + "/")) {
          counts[target] = (counts[target] ?? 0) + 1;
        }
      }
      return counts;
    };

    await waitForReload(0);
    // Warm up: the resolver's `store_fd` flag is set after VM init, so the
    // first reload is what caches a directory handle. A second warmup covers
    // `dep.ts` reaching steady state in the watchlist (its fd is stored via
    // `add_file` on the first edited-dep reload; seen empty in `before` on a
    // fast aarch64/musl lane otherwise).
    for (let i = 1; i <= 2; i++) {
      const reloaded = waitForReload(i);
      writeFileSync(depPath, `export const value = ${i};\n`);
      await reloaded;
    }
    const before = countProjectFds();
    // Guard against a vacuous pass (empty `before` would trivially equal `after`).
    expect(before[join(dirReal, "sub")]).toBeGreaterThan(0);
    expect(before[join(dirReal, "entry.ts")]).toBeGreaterThan(0);

    const reloads = 20;
    for (let i = 3; i <= reloads + 2; i++) {
      const reloaded = waitForReload(i);
      writeFileSync(depPath, `export const value = ${i};\n`);
      await reloaded;
    }
    const after = countProjectFds();

    runner.kill();
    await Promise.allSettled([pump, stderrDrain, runner.exited]);

    // Previously: every reload orphaned one open descriptor on the entrypoint
    // and two O_DIRECTORY handles on the edited module's directory; long
    // sessions eventually hit EMFILE. One handle's transient presence between
    // samples is not a leak, so each target may differ by at most 1.
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const delta = Object.fromEntries(keys.map(k => [k, (after[k] ?? 0) - (before[k] ?? 0)]));
    expect({ reloads, before, after, delta }).toEqual({
      reloads,
      before,
      after,
      delta: Object.fromEntries(keys.map(k => [k, Math.max(-1, Math.min(1, delta[k]))])),
    });
  },
  timeout,
);

// https://github.com/oven-sh/bun/issues/11083
it(
  "does not leak native memory on each reload",
  async () => {
    // Pad the project directory so the orphaned `DirEntry.data` hashbrown
    // table (previously leaked once per reload via `bust_entries_cache`) is
    // non-trivial; without reuse each reload re-appends every name into the
    // append-only EntryStore slab.
    const pad: Record<string, string> = {};
    for (let i = 0; i < 40; i++) pad[`pad${i}.txt`] = "";
    using dir = tempDir("hot-mem-leak", {
      "entry.ts": "throw new Error('replaced before first run')",
      ...pad,
    });
    const entry = join(String(dir), "entry.ts");

    const reloads = isDebug ? 60 : 200;
    const samples: { i: number; rss: number; refStrings: number; codeBlocks: number }[] = [];

    // Heavy probes (heapStats, the internal diagnostic) run only at the
    // sample points; in between, the module body is the minimal
    // `Bun.gc(true)` + a single print, so RSS measures the reload path
    // itself rather than per-reload probe churn (which under ASAN quarantine
    // otherwise swamps the signal).
    const sampleAt = new Set([1, Math.floor(reloads / 2), reloads]);
    const writeEntry = (i: number) => {
      const probe = sampleAt.has(i)
        ? [
            "const { heapStats } = require('bun:jsc');",
            "const s = heapStats();",
            "let refStrings = -1;",
            "try { refStrings = require('bun:internal-for-testing').hotReloadDiagnostics().refStrings; } catch {}",
            "console.log(JSON.stringify({",
            `  i: ${i},`,
            "  rss: process.memoryUsage().rss,",
            "  refStrings,",
            "  codeBlocks: s.objectTypeCounts.UnlinkedModuleProgramCodeBlock || 0,",
            "}));",
          ]
        : [`console.log(JSON.stringify({i: ${i}}));`];
      writeFileSync(entry, [`var x${i} = ${i};`, "Bun.gc(true);", ...probe].join("\n"));
    };
    writeEntry(0);

    await using runner = spawn({
      cmd: [bunExe(), "--expose-internals", "--hot", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const stderrDrain = runner.stderr.text();

    let i = 0;
    let done = false;
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of runner.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        const snap = JSON.parse(line);
        if (snap.i !== i) continue;
        if (sampleAt.has(i)) samples.push(snap);
        if (i >= reloads) {
          done = true;
          break;
        }
        i++;
        writeEntry(i);
      }
      if (done) break;
    }
    runner.kill();
    const stderr = await Promise.allSettled([stderrDrain, runner.exited]).then(([e]) =>
      e.status === "fulfilled" ? e.value : "",
    );
    if (!done) {
      throw new Error(`--hot loop ended early at i=${i} (exit ${runner.exitCode}); stderr:\n${stderr.slice(-2000)}`);
    }

    expect(samples.length).toBe(sampleAt.size);
    const first = samples[0];
    const last = samples[samples.length - 1];
    expect(last.i).toBe(reloads);

    const maxRefStrings = Math.max(...samples.map(s => s.refStrings));
    const maxCodeBlocks = Math.max(...samples.map(s => s.codeBlocks));
    const bytesPerReload = ((last.rss - first.rss) / (last.i - first.i)) | 0;

    // Without clearing the JSC CodeCache, UnlinkedModuleProgramCodeBlock
    // climbs one per reload (here: to `reloads`). With it cleared, only the
    // just-loaded module's block is live after GC.
    // Without the ref-count balance, `ref_strings` adds one entry per unique
    // transpiled output and never drains. `--expose-internals` + bunEnv's
    // BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING make the hook available; a -1
    // sample means the probe silently failed and is itself a failure.
    // (The third leak, the resolver's per-reload `DirEntry` / `EntryStore`
    // orphaning, is covered by the fd-count test above: fixing it is what
    // makes the directory handle reusable. RSS itself is too noisy across
    // CI lanes (allocator quarantine, aarch64 page sizes) to bound tightly;
    // `bytesPerReload` is reported below as context only.)
    expect({
      maxCodeBlocksUnder10: maxCodeBlocks < 10,
      maxRefStringsUnder10: maxRefStrings >= 0 && maxRefStrings < 10,
      // Carried for context on failure:
      maxCodeBlocks,
      maxRefStrings,
      bytesPerReload,
    }).toMatchObject({
      maxCodeBlocksUnder10: true,
      maxRefStringsUnder10: true,
    });
  },
  longTimeout,
);
