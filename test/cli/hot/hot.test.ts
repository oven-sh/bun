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

describe.concurrent("stdin across a reload", () => {
  // Runs `bun --hot entry.ts` with a piped stdin. Every wait is for a line of stdout, never for time.
  function runHot(cwd: string) {
    const entry = join(cwd, "entry.ts");
    const proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      env: bunEnv,
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines: string[] = [];
    let changed = Promise.withResolvers<void>();
    let ended = false;
    let failure: unknown;
    (async () => {
      const decoder = new TextDecoder();
      let rest = "";
      try {
        for await (const chunk of proc.stdout) {
          const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n");
          rest = parts.pop()!;
          for (const part of parts) lines.push(part.replace(/\r$/, ""));
          changed.resolve();
          changed = Promise.withResolvers<void>();
        }
      } catch (e) {
        failure = e;
      } finally {
        ended = true;
        changed.resolve();
      }
    })();
    let stderr = "";
    (async () => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of proc.stderr) stderr += decoder.decode(chunk, { stream: true });
      } catch (e) {
        failure ??= e;
      }
    })();

    async function line(wanted: string | RegExp) {
      for (let next = 0; ; await changed.promise) {
        for (; next < lines.length; next++) {
          const text = lines[next];
          if (typeof wanted === "string" ? text === wanted : wanted.test(text)) return text;
          // No loop in these tests ends or fails, and after one did, the wanted line may never come.
          if (/^generation \d+ (error|done)/.test(text)) throw new Error(`${text}\nstdout:\n${lines.join("\n")}`);
        }
        if (failure) throw failure;
        if (ended) throw new Error(`bun --hot exited before it printed ${wanted}. stdout:\n${lines.join("\n")}`);
      }
    }

    return {
      proc,
      line,
      send(text: string) {
        proc.stdin.write(text);
        proc.stdin.flush();
      },
      // A watcher can drop a save, so save again until the new source has run.
      async save(source: string, started: string) {
        let running = false;
        const seen = line(started).then(() => void (running = true));
        while (!running) {
          writeFileSync(entry, source);
          await Promise.race([seen, Bun.sleep(1_000)]);
        }
      },
      // What the generations printed after their start lines, and the errors of a stream that bun reported itself.
      result: () => ({
        stdout: lines.filter(text => !text.endsWith(" start")),
        stderr: stderr.split("\n").filter(text => text.includes("Invalid state")),
      }),
    };
  }

  // A loop that reports each line it reads, and what no loop of these tests may do: end, or fail.
  const loop = (generation: number, body = "") => `
    (async () => {
      try {
        for await (const line of console) {
          console.log("generation ${generation} got", JSON.stringify(line));
          ${body}
        }
        console.log("generation ${generation} done");
      } catch (e) {
        console.log("generation ${generation} error", e.message);
      }
    })();
  `;
  const start = (generation: number) => `console.log("generation ${generation} start");`;
  // The process emits "beforeExit" when the reader of stdin does not keep the event loop alive.
  const reportBeforeExit = `globalThis.reportsBeforeExit ??= process.on("beforeExit", () => console.log("beforeExit"));`;
  const consoleLoop = (generation: number, body = "") => start(generation) + reportBeforeExit + loop(generation, body);
  // A save can reload twice. This makes the loop of one generation start once.
  const once = (generation: number, code: string) =>
    `if (!globalThis.loop${generation}) { globalThis.loop${generation} = true; ${code} }`;

  it("the next generation reads the next line of `for await (const line of console)`", async () => {
    using dir = tempDir("hot-stdin-console", { "entry.ts": consoleLoop(1) });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send("line-a\n");
    await hot.line('generation 1 got "line-a"');

    await hot.save(consoleLoop(2), "generation 2 start");
    hot.send("line-b\n");
    await hot.line(/ got "line-b"$/);

    expect(hot.result()).toEqual({
      stdout: ['generation 1 got "line-a"', 'generation 2 got "line-b"'],
      stderr: [],
    });
  });

  it("the next generation gets the rest of a line that the replaced one read in part", async () => {
    using dir = tempDir("hot-stdin-partial", { "entry.ts": consoleLoop(1) });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send("line-a\npar");
    await hot.line('generation 1 got "line-a"');

    await hot.save(consoleLoop(2), "generation 2 start");
    hot.send("tial\nline-c\n");
    await hot.line(/ got "line-c"$/);

    expect(hot.result()).toEqual({
      stdout: ['generation 1 got "line-a"', 'generation 2 got "partial"', 'generation 2 got "line-c"'],
      stderr: [],
    });
  });

  it("replaced generations that were in their loop body read nothing more", async () => {
    // One chunk holds four lines and the start of a fifth. Generation 1 stops in its loop body after "l1",
    // generation 2 after "l2". On Windows the lines end in "\r\n", which every yield of the iterator strips there.
    const blocked = (generation: number) =>
      start(generation) +
      reportBeforeExit +
      once(
        generation,
        loop(
          generation,
          `await new Promise(resolve => (globalThis.resumeGeneration${generation} = resolve));
           console.log("generation ${generation} resumed");`,
        ),
      );
    // Generation 3 lets both continue while "l4" is still unread, then waits one turn of the event loop.
    const third = consoleLoop(
      3,
      `if (line.startsWith("l3")) {
         globalThis.resumeGeneration1();
         globalThis.resumeGeneration2();
         await new Promise(resolve => setImmediate(resolve));
       }`,
    );
    const newline = isWindows ? "\r\n" : "\n";
    using dir = tempDir("hot-stdin-body", { "entry.ts": blocked(1) });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send(["l1", "l2", "l3", "l4", "par"].join(newline));
    await hot.line('generation 1 got "l1"');

    await hot.save(blocked(2), "generation 2 start");
    await hot.line(/^generation 2 got /);

    await hot.save(third, "generation 3 start");
    await hot.line(/ got "l4/);
    hot.send("tial" + newline);
    await hot.line(/ got "(par)?tial/);

    expect(hot.result()).toEqual({
      stdout: [
        'generation 1 got "l1"',
        'generation 2 got "l2"',
        'generation 3 got "l3"',
        "generation 1 resumed",
        "generation 2 resumed",
        'generation 3 got "l4"',
        'generation 3 got "partial"',
      ],
      stderr: [],
    });
  });

  it("a generation that starts its loop late does not keep stdin from the newest one", async () => {
    // Generation 2 starts its loop only when generation 3 asks, so both loops start after the last reload.
    const second = start(2) + `globalThis.startLoop2 = () => { ${loop(2)} };`;
    const third = start(3) + `globalThis.startLoop2();` + loop(3);
    using dir = tempDir("hot-stdin-late", { "entry.ts": consoleLoop(1) });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send("line-a\n");
    await hot.line('generation 1 got "line-a"');

    await hot.save(second, "generation 2 start");
    await hot.save(third, "generation 3 start");
    hot.send("line-b\n");
    await hot.line(/ got "line-b"$/);

    expect(hot.result()).toEqual({
      stdout: ['generation 1 got "line-a"', 'generation 3 got "line-b"'],
      stderr: [],
    });
  });

  it("the next generation reads stdin after the replaced one paused process.stdin", async () => {
    // pause() stops the source that the console iterator shares with process.stdin.
    const first =
      start(1) +
      loop(
        1,
        `process.stdin.pause();
         await new Promise(resolve => setImmediate(resolve));
         console.log("generation 1 paused stdin");`,
      );
    using dir = tempDir("hot-stdin-paused", { "entry.ts": first });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send("line-a\n");
    await hot.line("generation 1 paused stdin");

    await hot.save(start(2) + loop(2), "generation 2 start");
    hot.send("line-b\n");
    await hot.line(/ got "line-b"$/);

    expect(hot.result()).toEqual({
      stdout: ['generation 1 got "line-a"', "generation 1 paused stdin", 'generation 2 got "line-b"'],
      stderr: [],
    });
  });

  it("a replaced generation that got the last line of stdin does not end its loop", async () => {
    // stdin ends on a line with no newline. Generation 1 is in its loop body with that line when the save lands.
    const first =
      start(1) +
      loop(
        1,
        `await new Promise(resolve => (globalThis.resumeGeneration1 = resolve));
         console.log("generation 1 resumed");`,
      );
    // Generation 2 reads the end of stdin, lets generation 1 continue, and waits one turn of the event loop.
    const second =
      start(2) +
      once(
        2,
        `(async () => {
           try {
             for await (const line of console) console.log("generation 2 got", JSON.stringify(line));
             console.log("generation 2 saw the end of stdin");
             globalThis.resumeGeneration1();
             await new Promise(resolve => setImmediate(resolve));
             console.log("generation 2 checked");
           } catch (e) {
             console.log("generation 2 error", e.message);
           }
         })();`,
      );
    using dir = tempDir("hot-stdin-end", { "entry.ts": first });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send("tail");
    hot.proc.stdin.end();
    await hot.line('generation 1 got "tail"');

    await hot.save(second, "generation 2 start");
    await hot.line("generation 2 checked");

    expect(hot.result()).toEqual({
      stdout: [
        'generation 1 got "tail"',
        "generation 2 saw the end of stdin",
        "generation 1 resumed",
        "generation 2 checked",
      ],
      stderr: [],
    });
  });

  it("a loop that the script keeps on globalThis stays the reader", async () => {
    const kept = (generation: number) => `
      console.log("generation ${generation} start");
      globalThis.handle = line => console.log("generation ${generation} got", JSON.stringify(line));
      globalThis.loop ??= (async () => {
        for await (const line of console) globalThis.handle(line);
      })();
    `;
    using dir = tempDir("hot-stdin-kept", { "entry.ts": kept(1) });
    const hot = runHot(String(dir));
    await using _ = hot.proc;

    await hot.line("generation 1 start");
    hot.send("line-a\n");
    await hot.line('generation 1 got "line-a"');

    await hot.save(kept(2), "generation 2 start");
    hot.send("line-b\n");
    await hot.line(/ got "line-b"$/);

    expect(hot.result()).toEqual({
      stdout: ['generation 1 got "line-a"', 'generation 2 got "line-b"'],
      stderr: [],
    });
  });
});
