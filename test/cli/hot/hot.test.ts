import { spawn } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, cpSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, isWindows, tempDir, tmpdirSync, waitForFileToExist } from "harness";
import { mkfifo } from "mkfifo";
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
  runner: Bun.Subprocess<"ignore", "ignore", "pipe">,
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

it(
  "should import a module again after a hot reload while its import() was still loading its dependencies",
  async () => {
    using dir = tempDir("hot-reload-import-in-flight", {
      "a.mjs": `import "./dependency.mjs"; export const evaluation = (globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);`,
      "dependency.mjs": `export {};`,
      "entry.mjs": `
        import { readFileSync, writeFileSync } from "node:fs";
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        if (globalThis.runs === 1) {
          Bun.plugin({
            name: "hold the dependency's load open until the reload",
            setup(build) {
              build.onLoad({ filter: /dependency\\.mjs$/ }, () => {
                const loaded = { contents: "export {}", loader: "js" };
                if (globalThis.dependencyMayLoad) return loaded;
                const { promise, resolve } = Promise.withResolvers();
                globalThis.dependencyMayLoad = () => resolve(loaded);
                writeFileSync(import.meta.path, readFileSync(import.meta.path));
                return promise;
              });
            },
          });
          globalThis.inFlight = import("./a.mjs");
        } else {
          globalThis.dependencyMayLoad();
          try {
            console.log("in flight: evaluation", (await globalThis.inFlight).evaluation);
            console.log("next: evaluation", (await import("./a.mjs")).evaluation);
            process.exit(0);
          } catch (error) {
            // --hot would keep the process alive after an uncaught error.
            console.log("rejected:", error);
            process.exit(1);
          }
        }
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("in flight: evaluation 1\nnext: evaluation 2\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

it(
  "should import a module again after a hot reload while its import() was still fetching it",
  async () => {
    using dir = tempDir("hot-reload-import-fetch-in-flight", {
      "a.mjs": `export const evaluation = (globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);`,
      "entry.mjs": `
        import { readFileSync, writeFileSync } from "node:fs";
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        if (globalThis.runs === 1) {
          Bun.plugin({
            name: "hold the module's own load open until the reload",
            setup(build) {
              build.onLoad({ filter: /a\\.mjs$/ }, () => {
                const loaded = { contents: "export const evaluation = (globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);", loader: "js" };
                if (globalThis.moduleMayLoad) return loaded;
                const { promise, resolve } = Promise.withResolvers();
                globalThis.moduleMayLoad = () => resolve(loaded);
                writeFileSync(import.meta.path, readFileSync(import.meta.path));
                return promise;
              });
            },
          });
          globalThis.inFlight = import("./a.mjs");
        } else {
          globalThis.moduleMayLoad();
          try {
            console.log("in flight: evaluation", (await globalThis.inFlight).evaluation);
            console.log("next: evaluation", (await import("./a.mjs")).evaluation);
            process.exit(0);
          } catch (error) {
            // --hot would keep the process alive after an uncaught error.
            console.log("rejected:", error);
            process.exit(1);
          }
        }
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("in flight: evaluation 1\nnext: evaluation 2\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

describe("a load from before a hot reload that ends after it", () => {
  // `fifo`: a named pipe that stands in for the file of the module "held".
  async function run(files: Record<string, string>, env: Record<string, string>, fifo?: string) {
    using dir = tempDir("hot-reload-load-in-flight", files);
    if (fifo) {
      // The resolver skips a named pipe in a directory listing and follows a symlink to one. The watcher does not
      // open what is under node_modules.
      mkfifo(join(String(dir), "node_modules", "pipes", fifo));
      symlinkSync("../pipes/" + fifo, join(String(dir), "node_modules", "held", "index." + fifo.split(".").pop()));
    }
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "entry.mjs"],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // Only that a load rejected is compared, not the text of the error.
    return { stdout: stdout.replace(/rejected: .*/g, "rejected"), exitCode };
  }

  // An onLoad holds a fetch open across the reload, as in the tests above.
  const heldByPlugin = {
    "a.mjs": `export {};`,
    "dependency.mjs": `export {};`,
    "throws.mjs": `export {};`,
    "entry.mjs": `
      import { readFileSync, writeFileSync } from "node:fs";
      const CASE = process.env.CASE;
      const reload = () => writeFileSync(import.meta.path, readFileSync(import.meta.path));
      const outcome = promise => promise.then(m => "evaluation " + m.evaluation, e => "rejected: " + e);
      const counted = "export const evaluation = (globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);";
      globalThis.runs = (globalThis.runs ?? 0) + 1;
      if (globalThis.runs === 1) {
        const calls = { a: 0, dependency: 0 };
        const held = (globalThis.held = []);
        const hold = () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          held.push({ resolve, reject });
          return promise;
        };
        Bun.plugin({
          name: "hold a load open until the reload",
          setup(build) {
            build.onLoad({ filter: /[\\\\/]a\\.mjs$/ }, () => {
              const call = ++calls.a;
              if (CASE.startsWith("own")) {
                // The fetch of a.mjs itself is in flight at the reload.
                if (globalThis.runs > 1) return { contents: counted, loader: "js" };
                if (call === (CASE === "own-twice" ? 2 : 1)) reload();
                return hold();
              }
              // a.mjs is registered at the reload. The fetch of its dependency is in flight.
              if (CASE === "dependency-evaluation-fails" && call === 1)
                return { contents: 'import "./dependency.mjs"; throw new Error("from before the reload");', loader: "js" };
              return { contents: 'import "./dependency.mjs"; ' + counted, loader: "js" };
            });
            build.onLoad({ filter: /[\\\\/]dependency\\.mjs$/ }, () => {
              if (++calls.dependency > 1) return { contents: "export {};", loader: "js" };
              reload();
              return hold();
            });
            build.onLoad({ filter: /[\\\\/]throws\\.mjs$/ }, () => ({ contents: 'throw new Error("another module threw");', loader: "js" }));
          },
        });
        globalThis.inFlight = [import("./a.mjs")];
        if (CASE === "own-twice") globalThis.inFlight.push(import("./a.mjs"));
        for (const promise of globalThis.inFlight) promise.catch(() => {});
      } else {
        const [first, second] = globalThis.held;
        const inFlight = globalThis.inFlight;
        if (CASE === "own-twice") {
          first.resolve({ contents: counted, loader: "js" });
          second.resolve({ contents: counted, loader: "js" });
          const [a, b] = await Promise.all(inFlight);
          console.log("in flight:", a === b ? "one module," : "two modules,", await outcome(inFlight[0]));
        } else {
          // Nothing holds the key in the one case where the fetch fails with the error of another module.
          if (CASE !== "own-fetch-fails-with-the-error-of-another-module") console.log("new:", await outcome(import("./a.mjs")));
          if (CASE === "own-fetch-fails" || CASE === "dependency-fetch-fails") first.reject(new Error("from before the reload"));
          if (CASE === "own-fetch-fails-with-the-error-of-another-module") first.reject(await import("./throws.mjs").catch(e => e));
          if (CASE === "dependency-evaluation-fails") first.resolve({ contents: "export {};", loader: "js" });
          if (CASE === "dependency-link-fails") first.resolve({ contents: 'import { missing } from "./throws.mjs";', loader: "js" });
          console.log("in flight:", await outcome(inFlight[0]));
        }
        console.log("next:", await outcome(import("./a.mjs")));
        process.exit(0);
      }
    `,
  };

  it(
    "two import() of one module share it",
    async () => {
      expect(await run(heldByPlugin, { CASE: "own-twice" })).toEqual({
        stdout: "in flight: one module, evaluation 1\nnext: evaluation 2\n",
        exitCode: 0,
      });
    },
    timeout,
  );

  it.each([
    ["own-fetch-fails", "new: evaluation 1\nin flight: rejected\nnext: evaluation 1\n"],
    ["own-fetch-fails-with-the-error-of-another-module", "in flight: rejected\nnext: evaluation 1\n"],
    ["dependency-fetch-fails", "new: evaluation 1\nin flight: rejected\nnext: evaluation 1\n"],
    ["dependency-link-fails", "new: evaluation 1\nin flight: rejected\nnext: evaluation 1\n"],
    ["dependency-evaluation-fails", "new: evaluation 1\nin flight: rejected\nnext: evaluation 1\n"],
  ])(
    "does not leave its error on the module from after the reload: %s",
    async (CASE, stdout) => {
      expect(await run(heldByPlugin, { CASE })).toEqual({ stdout, exitCode: 0 });
    },
    timeout,
  );

  // No plugin is registered, so the fetch is a transpiler job on the thread pool. The file of the module is a named
  // pipe: the job's read of it ends when the script writes.
  const heldOnThreadPool = {
    "imports-cjs.mjs": `import held from "held/index.cjs"; export const v = held.v, id = held.id;`,
    "imports-mjs.mjs": `export { v, id } from "held/index.mjs";`,
    "node_modules/held/package.json": `{"name":"held"}`,
    "node_modules/pipes/package.json": `{"name":"pipes"}`,
    "entry.mjs": `
      import { readFileSync, writeFileSync, renameSync, promises } from "node:fs";
      const EXT = process.env.EXT, CASE = process.env.CASE;
      const held = import.meta.dir + "/node_modules/held/index." + EXT; // a symlink to the pipe
      const pipe = import.meta.dir + "/node_modules/pipes/held." + EXT;
      const importer = "./imports-" + EXT + ".mjs";
      const text = v => (EXT === "cjs" ? "exports.v = " + v + "; exports.id = " : "export const v = " + v + "; export const id = ") + "(globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);";
      const show = m => "v=" + (m.v ?? m.default?.v) + " id=" + (m.id ?? m.default?.id);
      const outcome = promise => promise.then(show, e => "rejected: " + e);
      globalThis.runs = (globalThis.runs ?? 0) + 1;
      if (globalThis.runs === 1) {
        globalThis.inFlight = import(CASE === "dependency" || CASE === "joined" ? importer : held);
        globalThis.inFlight.catch(() => {});
        // Resolves when the transpiler job has the pipe open: the fetch is in flight.
        globalThis.writeEnd = await promises.open(held, "w");
        if (CASE === "joined") {
          // Joins the fetch that the importer started for its dependency.
          globalThis.joined = import(held);
          globalThis.joined.catch(() => {});
        }
        if (CASE.startsWith("new-first")) {
          // From here on the path is a file with the new text. The job keeps the pipe open.
          writeFileSync(pipe + ".new", text(1));
          renameSync(pipe + ".new", pipe);
        }
        writeFileSync(import.meta.path, readFileSync(import.meta.path)); // reloads
      } else {
        if (CASE.startsWith("new-first")) console.log("new:", await outcome(import(held)));
        // What the fetch from before the reload reads.
        await globalThis.writeEnd.write(
          CASE === "new-first-old-does-not-parse" ? "const = ;"
          : CASE === "new-first-old-throws" ? text(0) + " throw new Error('from before the reload');"
          : text(0));
        await globalThis.writeEnd.close();
        console.log("in flight:", await outcome(globalThis.inFlight));
        if (CASE === "joined") console.log("joined:", await outcome(globalThis.joined));
        // What a fetch from after the reload reads, if one is made.
        if (!CASE.startsWith("new-first")) promises.writeFile(held, text(1)).catch(() => {});
        console.log("next:", await outcome(import(CASE === "dependency" ? importer : held)));
        if (EXT === "cjs") console.log("require:", show(require(held)));
        process.exit(0);
      }
    `,
  };

  describe.each(["mjs", "cjs"])("fetched on the thread pool, .%s", EXT => {
    const required = (line: string) => (EXT === "cjs" ? line : "");
    it.skipIf(isWindows).each([
      ["own", "in flight: v=0 id=1\nnext: v=1 id=2\n" + required("require: v=1 id=2\n")],
      ["dependency", "in flight: v=0 id=1\nnext: v=1 id=2\n" + required("require: v=1 id=2\n")],
      ["joined", "in flight: v=0 id=1\njoined: v=0 id=1\nnext: v=1 id=2\n" + required("require: v=1 id=2\n")],
      // The module from after the reload is loaded first.
      ["new-first", "new: v=1 id=1\nin flight: v=0 id=2\nnext: v=1 id=1\n" + required("require: v=1 id=1\n")],
      [
        "new-first-old-does-not-parse",
        "new: v=1 id=1\nin flight: rejected\nnext: v=1 id=1\n" + required("require: v=1 id=1\n"),
      ],
      [
        "new-first-old-throws",
        "new: v=1 id=1\nin flight: rejected\nnext: v=1 id=1\n" + required("require: v=1 id=1\n"),
      ],
    ])(
      "%s",
      async (CASE, stdout) => {
        expect(await run(heldOnThreadPool, { CASE, EXT }, "held." + EXT)).toEqual({ stdout, exitCode: 0 });
      },
      timeout,
    );
  });
});

it("holds the promise of the entry point itself, which it looks at on every tick", async () => {
  const source = (comment: string) => `
    globalThis.loads = (globalThis.loads ?? 0) + 1;
    const load = globalThis.loads;
    setTimeout(() => {
      Bun.gc(true);
      const { nodes, nodeClassNames, edges } = require("bun:jsc").generateHeapSnapshotForDebugging();
      const className = new Map();
      for (let i = 0; i < nodes.length; i += 7) className.set(nodes[i], nodeClassNames[nodes[i + 2]]);
      let held = 0;
      for (let i = 0; i < edges.length; i += 4)
        if (className.get(edges[i]) === "StrongRootBlock" && className.get(edges[i + 1]) === "Promise") held++;
      console.log("load " + load + ": " + held + " held");
    }, 0);
    // ${comment}
  `;
  using dir = tempDir("hot-entry-promise", { "main.js": source("first") });
  await using runner = spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const reader = runner.stdout.getReader();
  let stdout = "";
  const line = async (prefix: string) => {
    for (;;) {
      const found = stdout
        .split("\n")
        .slice(0, -1)
        .find(line => line.startsWith(prefix));
      if (found) return found;
      const { value, done } = await reader.read();
      if (done) return stdout;
      stdout += Buffer.from(value).toString();
    }
  };
  expect(await line("load 1:")).toBe("load 1: 1 held");
  writeFileSync(join(String(dir), "main.js"), source("second"));
  expect(await line("load 2:")).toBe("load 2: 1 held");
});

// The cell of a collected promise goes to the next promise that is made.
it.each([
  ["pending", `new Promise(() => {})`],
  ["rejected and handled", `Promise.reject(new Error("not the entry point's"))`],
])("does not take a promise of the program's, %s, for that of the entry point", async (_, promise) => {
  using dir = tempDir("hot-entry-promise-reused", { "main.js": `console.log("first load");` });
  await using runner = spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const reader = runner.stdout.getReader();
  let stdout = "";
  const line = async (expected: string) => {
    while (!stdout.split("\n").slice(0, -1).includes(expected)) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += Buffer.from(value).toString();
    }
  };
  await line("first load");
  // What is left on the stack can keep it alive, and differs with where a collection starts from.
  writeFileSync(
    join(String(dir), "main.js"),
    `
      globalThis.kept = [];
      require("fs").readFile(__filename, () => {
        Bun.gc(true);
        setImmediate(() => {
          Bun.gc(true);
          require("crypto").randomBytes(8, () => {
            Bun.gc(true);
            for (let i = 0; i < 20000; i++) {
              const promise = ${promise};
              promise.catch(() => {});
              kept.push(promise);
            }
            console.log("collected");
          });
        });
      });
    `,
  );
  await line("collected");
  writeFileSync(join(String(dir), "main.js"), `console.log("third load"); process.exit(0);`);
  await line("third load");
  const stderr = (await runner.stderr.text()).split("\n").filter(line => line && !line.startsWith("DEBUG: "));
  expect({ stdout: stdout.split("\n"), stderr }).toEqual({
    stdout: ["first load", "collected", "third load", ""],
    stderr: [],
  });
});
