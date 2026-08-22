import { spawn } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, cpSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, isWindows, tmpdirSync, waitForFileToExist } from "harness";
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

describe("import.meta.hot", () => {
  interface GenerationOptions {
    /** Contents of `entry` for generations 1, 2, ...; by default `files[entry]` is saved again each time. */
    sources?: string[];
    /** Arguments placed before the entry point, e.g. `--preload`. */
    args?: string[];
    /** Runs after a generation printed its line and before the save that starts the next one. */
    afterGeneration?: (line: Record<string, unknown>) => Promise<void>;
  }

  /**
   * Writes `files` into the test cwd, runs `bun --hot` on `entry`, and after
   * every JSON line the fixture prints to stdout saves `entry` to trigger the
   * next reload, until `generations` lines have been collected.
   */
  async function collectGenerations(
    entry: string,
    files: Record<string, string>,
    generations: number,
    { sources, args = [], afterGeneration }: GenerationOptions = {},
  ) {
    const root = join(cwd, entry);
    const sourceFor = (generation: number) =>
      sources ? sources[generation - 1] : `${files[entry]}\n// generation ${generation}\n`;
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(cwd, name), contents);
    writeFileSync(root, sourceFor(1));

    await using runner = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", ...args, root],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    let stderr = "";
    const stderrDone = (async () => {
      for await (const chunk of runner.stderr) stderr += new TextDecoder().decode(chunk);
    })().catch(() => {});

    const lines: Record<string, unknown>[] = [];
    let buf = "";
    outer: for await (const chunk of runner.stdout) {
      buf += new TextDecoder().decode(chunk);
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        const parsed = JSON.parse(line);
        lines.push(parsed);
        await afterGeneration?.(parsed);
        if (lines.length >= generations) break outer;
        writeFileSync(root, sourceFor(lines.length + 1));
      }
    }

    runner.kill();
    await runner.exited;
    await stderrDone;
    return { lines, stderr };
  }

  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it("is undefined and unguarded calls are no-ops without --hot", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          if (import.meta.hot !== undefined) throw new Error("expected undefined, got " + typeof import.meta.hot);
          if (typeof import.meta.hot?.dispose !== "undefined") throw new Error("optional chain");
          // Unguarded calls to the HMR API must not throw at runtime; outside
          // --hot the transpiler folds these away.
          import.meta.hot.dispose(() => { throw new Error("should not run"); });
          import.meta.hot.accept();
          import.meta.hot.on("bun:beforeUpdate", () => {});
          const state = (import.meta.hot.data.state ??= { reloads: 0 });
          console.log(JSON.stringify({ ok: true, reloads: state.reloads }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: '{"ok":true,"reloads":0}\n', stderr: "", exitCode: 0 });
  });

  it(
    "runs dispose callbacks and persists data across reloads",
    async () => {
      const source = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        const listener = () => {};
        process.on("beforeExit", listener);
        const iv = setInterval(() => {}, 1_000_000);

        const hot = import.meta.hot;
        if (typeof hot !== "object" || hot === null) {
          console.log(JSON.stringify({ gen, error: "hot is " + typeof hot }));
          process.exit(1);
        }
        const prevGen = hot.data.prevGen;
        hot.data.prevGen = gen;
        const intervals = globalThis.__intervals ??= new Set();
        intervals.add(iv);
        hot.dispose((data) => {
          clearInterval(iv);
          intervals.delete(iv);
          process.off("beforeExit", listener);
          globalThis.__disposed = { gen, data: { ...data } };
        });

        const noopNames = ["accept", "decline", "on", "off", "prune", "invalidate", "send"];
        console.log(JSON.stringify({
          gen,
          tag: Object.prototype.toString.call(hot),
          sameObject: hot === import.meta.hot,
          keys: Object.keys(hot),
          protoKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(hot)).sort(),
          prevGen: prevGen ?? null,
          listenerCount: process.listenerCount("beforeExit"),
          liveIntervals: intervals.size,
          disposed: globalThis.__disposed ?? null,
          noops: noopNames.filter(n => typeof hot[n] === "function" && hot[n]() === undefined),
        }));
      `;
      const { lines } = await collectGenerations("import-meta-hot-app.ts", { "import-meta-hot-app.ts": source }, 3);

      const shape = {
        tag: "[object ImportMetaHot]",
        sameObject: true,
        keys: [],
        protoKeys: ["accept", "data", "decline", "dispose", "invalidate", "off", "on", "prune", "send"],
        listenerCount: 1,
        liveIntervals: 1,
        noops: ["accept", "decline", "on", "off", "prune", "invalidate", "send"],
      };
      expect(lines).toEqual([
        { ...shape, gen: 1, prevGen: null, disposed: null },
        { ...shape, gen: 2, prevGen: 1, disposed: { gen: 1, data: { prevGen: 1 } } },
        { ...shape, gen: 3, prevGen: 2, disposed: { gen: 2, data: { prevGen: 2 } } },
      ]);
    },
    timeout,
  );

  it(
    "data can be reassigned and dispose receives the module's current data",
    async () => {
      const source = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        const hot = import.meta.hot;
        const before = { ...hot.data };
        // Registered before the reassignment below: dispose must still be
        // handed whatever data is current when the reload happens.
        hot.dispose((data) => {
          globalThis.__disposeGot = { ...data };
        });
        if (gen === 1) {
          hot.data = { created: 1 };
        } else {
          hot.data.mutatedBy = gen;
        }
        console.log(JSON.stringify({
          gen,
          before,
          after: { ...hot.data },
          disposeGot: globalThis.__disposeGot ?? null,
        }));
      `;
      const { lines } = await collectGenerations("import-meta-hot-data.ts", { "import-meta-hot-data.ts": source }, 3);
      expect(lines).toEqual([
        { gen: 1, before: {}, after: { created: 1 }, disposeGot: null },
        { gen: 2, before: { created: 1 }, after: { created: 1, mutatedBy: 2 }, disposeGot: { created: 1 } },
        {
          gen: 3,
          before: { created: 1, mutatedBy: 2 },
          after: { created: 1, mutatedBy: 3 },
          disposeGot: { created: 1, mutatedBy: 2 },
        },
      ]);
    },
    timeout,
  );

  it(
    "keeps data and dispose per module and runs dispose in registration order",
    async () => {
      // Each module stamps its own data and records which data its dispose
      // callback was handed. The dependency is never edited; it is
      // re-evaluated because the entry changed (via the async transpiler path).
      const entry = `
        import { depData, depSeen } from "./import-meta-hot-dep.ts";
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        const data = import.meta.hot.data;
        const entrySeen = { who: data.who ?? null, gen: data.gen ?? null };
        data.who = "entry";
        data.gen = gen;
        import.meta.hot.dispose(handed => globalThis.__disposed.push(["entry", handed.who, handed === data]));
        console.log(JSON.stringify({
          gen,
          entrySeen,
          depSeen,
          separateData: depData !== data,
          disposedSinceLastGeneration: globalThis.__disposed ?? [],
        }));
        globalThis.__disposed = [];
      `;
      const dep = `
        export const depData = import.meta.hot.data;
        export const depSeen = { who: depData.who ?? null, gen: depData.gen ?? null };
        depData.who = "dep";
        depData.gen = (depData.gen ?? 0) + 1;
        import.meta.hot.dispose(handed => globalThis.__disposed.push(["dep", handed.who, handed === depData]));
      `;
      const { lines } = await collectGenerations(
        "import-meta-hot-entry.ts",
        { "import-meta-hot-entry.ts": entry, "import-meta-hot-dep.ts": dep },
        3,
      );
      const nothing = { who: null, gen: null };
      // The dependency evaluates (and so registers) before the entry does.
      const bothDisposed = [
        ["dep", "dep", true],
        ["entry", "entry", true],
      ];
      expect(lines).toEqual([
        { gen: 1, entrySeen: nothing, depSeen: nothing, separateData: true, disposedSinceLastGeneration: [] },
        {
          gen: 2,
          entrySeen: { who: "entry", gen: 1 },
          depSeen: { who: "dep", gen: 1 },
          separateData: true,
          disposedSinceLastGeneration: bothDisposed,
        },
        {
          gen: 3,
          entrySeen: { who: "entry", gen: 2 },
          depSeen: { who: "dep", gen: 2 },
          separateData: true,
          disposedSinceLastGeneration: bothDisposed,
        },
      ]);
    },
    timeout,
  );

  it(
    "runs the dispose callbacks of a module the next generation no longer loads",
    async () => {
      const entry = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        if (gen === 1) await import("./import-meta-hot-dropped.ts");
        console.log(JSON.stringify({ gen, droppedDisposeRuns: globalThis.__droppedDisposeRuns ?? 0 }));
      `;
      const dropped = `
        import.meta.hot.dispose(() => {
          globalThis.__droppedDisposeRuns = (globalThis.__droppedDisposeRuns ?? 0) + 1;
        });
      `;
      const { lines } = await collectGenerations(
        "import-meta-hot-dropping-entry.ts",
        { "import-meta-hot-dropping-entry.ts": entry, "import-meta-hot-dropped.ts": dropped },
        3,
      );
      expect(lines).toEqual([
        { gen: 1, droppedDisposeRuns: 0 },
        { gen: 2, droppedDisposeRuns: 1 },
        { gen: 3, droppedDisposeRuns: 1 },
      ]);
    },
    timeout,
  );

  it(
    "waits for every promise returned from dispose, including ones that reject, before re-evaluating",
    async () => {
      const source = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        const order = (globalThis.__order ??= []);
        order.push("evaluate " + gen);
        const macrotask = () => new Promise(resolve => setImmediate(resolve));
        // A is registered first but settles last, by rejecting; B resolves
        // first. The reload must wait for both.
        import.meta.hot.dispose(async () => {
          order.push("dispose A " + gen);
          await macrotask();
          await macrotask();
          order.push("reject A " + gen);
          throw new Error("dispose-a-rejected-" + gen);
        });
        import.meta.hot.dispose(async data => {
          order.push("dispose B " + gen);
          await macrotask();
          order.push("resolve B " + gen);
          data.lastDisposed = gen;
        });
        console.log(JSON.stringify({ gen, order: order.splice(0), lastDisposed: import.meta.hot.data.lastDisposed ?? null }));
      `;
      const { lines, stderr } = await collectGenerations(
        "import-meta-hot-async.ts",
        { "import-meta-hot-async.ts": source },
        3,
      );
      expect(lines).toEqual([
        { gen: 1, order: ["evaluate 1"], lastDisposed: null },
        { gen: 2, order: ["dispose A 1", "dispose B 1", "resolve B 1", "reject A 1", "evaluate 2"], lastDisposed: 1 },
        { gen: 3, order: ["dispose A 2", "dispose B 2", "resolve B 2", "reject A 2", "evaluate 3"], lastDisposed: 2 },
      ]);
      expect([count(stderr, "dispose-a-rejected-1"), count(stderr, "dispose-a-rejected-2")]).toEqual([1, 1]);
    },
    timeout,
  );

  it(
    "resumes a reload parked on dispose after a generation that failed to evaluate",
    async () => {
      const print = (gen: number) => `
        console.log(JSON.stringify({
          gen: ${gen},
          x: import.meta.hot.data.x ?? null,
          disposedGenerations: globalThis.__disposedGenerations ?? [],
        }));
      `;
      const sources = [
        `
          import.meta.hot.data.x = "set by generation 1";
          import.meta.hot.dispose(() => { (globalThis.__disposedGenerations ??= []).push(1); });
          ${print(1)}
        `,
        // Prints, registers an async dispose, then fails to evaluate: the
        // reload that follows has to get past the reported rejection of this
        // generation's entry promise both before and after parking on dispose.
        `
          import.meta.hot.dispose(async () => {
            await new Promise(resolve => setImmediate(resolve));
            (globalThis.__disposedGenerations ??= []).push(2);
          });
          ${print(2)}
          const failing = 2;
          throw new Error("generation-" + failing + "-failed");
        `,
        print(3),
      ];
      const { lines, stderr } = await collectGenerations("import-meta-hot-broken.ts", {}, 3, { sources });
      expect(lines).toEqual([
        { gen: 1, x: "set by generation 1", disposedGenerations: [] },
        { gen: 2, x: "set by generation 1", disposedGenerations: [1] },
        { gen: 3, x: "set by generation 1", disposedGenerations: [1, 2] },
      ]);
      expect(count(stderr, "generation-2-failed")).toBe(1);
    },
    timeout,
  );

  it(
    "a server stopped from dispose is replaced by the next generation's Bun.serve on the same port",
    async () => {
      // The recipe from docs/runtime/watch-mode.mdx: without the dispose
      // callback the reload hands the new fetch handler to the existing server.
      const source = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        const server = Bun.serve({
          port: import.meta.hot.data.port ?? 0,
          fetch: () => new Response("generation " + gen),
        });
        import.meta.hot.data.port = server.port;
        import.meta.hot.dispose(() => {
          server.stop();
        });
        console.log(JSON.stringify({ gen, port: server.port, newServer: server !== globalThis.__server }));
        globalThis.__server = server;
      `;
      const responses: string[] = [];
      const { lines } = await collectGenerations(
        "import-meta-hot-serve.ts",
        { "import-meta-hot-serve.ts": source },
        3,
        {
          async afterGeneration(line) {
            const response = await fetch(`http://localhost:${line.port}/`, { headers: { connection: "close" } });
            responses.push(await response.text());
          },
        },
      );
      const port = lines[0].port as number;
      expect(port).toBeGreaterThan(0);
      expect({ lines, responses }).toEqual({
        lines: [
          { gen: 1, port, newServer: true },
          { gen: 2, port, newServer: true },
          { gen: 3, port, newServer: true },
        ],
        responses: ["generation 1", "generation 2", "generation 3"],
      });
    },
    timeout,
  );

  const preload = `
    globalThis.__preloadEvaluations = (globalThis.__preloadEvaluations ?? 0) + 1;
    import.meta.hot.dispose(() => {
      globalThis.__preloadDisposeRuns = (globalThis.__preloadDisposeRuns ?? 0) + 1;
    });
  `;
  const reportPreload = `
    const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
    console.log(JSON.stringify({
      gen,
      preloadEvaluations: globalThis.__preloadEvaluations,
      preloadDisposeRuns: globalThis.__preloadDisposeRuns ?? 0,
    }));
  `;

  it(
    "a --preload script is evaluated once, so a dispose registered there runs once",
    async () => {
      const { lines } = await collectGenerations(
        "import-meta-hot-preload-entry.ts",
        { "import-meta-hot-preload-entry.ts": reportPreload, "import-meta-hot-preload.ts": preload },
        3,
        { args: ["--preload", "./import-meta-hot-preload.ts"] },
      );
      expect(lines).toEqual([
        { gen: 1, preloadEvaluations: 1, preloadDisposeRuns: 0 },
        { gen: 2, preloadEvaluations: 1, preloadDisposeRuns: 1 },
        { gen: 3, preloadEvaluations: 1, preloadDisposeRuns: 1 },
      ]);
    },
    timeout,
  );

  it(
    "a --preload script the entry point imports is reloaded like any other module",
    async () => {
      const { lines } = await collectGenerations(
        "import-meta-hot-preload-importing-entry.ts",
        {
          "import-meta-hot-preload-importing-entry.ts": `import "./import-meta-hot-preload.ts";\n${reportPreload}`,
          "import-meta-hot-preload.ts": preload,
        },
        3,
        { args: ["--preload", "./import-meta-hot-preload.ts"] },
      );
      expect(lines).toEqual([
        { gen: 1, preloadEvaluations: 1, preloadDisposeRuns: 0 },
        { gen: 2, preloadEvaluations: 2, preloadDisposeRuns: 1 },
        { gen: 3, preloadEvaluations: 3, preloadDisposeRuns: 2 },
      ]);
    },
    timeout,
  );

  it(
    "reports throwing and rejecting dispose callbacks and still reloads",
    async () => {
      const source = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        // Touching \`process\` and then going idle is what makes a later
        // uncaught exception fatal; dispose errors must not take that path.
        process.on("exit", () => {});
        import.meta.hot.dispose(() => { throw new Error("sync-throw-" + gen); });
        // Already rejected by the time it is returned; a rejection that
        // happens later is covered by the ordering test above.
        import.meta.hot.dispose(async () => { throw new Error("async-reject-" + gen); });
        import.meta.hot.dispose(() => { globalThis.__last = gen; });
        console.log(JSON.stringify({ gen, lastRan: globalThis.__last ?? null }));
      `;
      const { lines, stderr } = await collectGenerations(
        "import-meta-hot-throws.ts",
        { "import-meta-hot-throws.ts": source },
        3,
      );
      expect(lines).toEqual([
        { gen: 1, lastRan: null },
        { gen: 2, lastRan: 1 },
        { gen: 3, lastRan: 2 },
      ]);
      expect(
        ["sync-throw-1", "async-reject-1", "sync-throw-2", "async-reject-2"].map(message => count(stderr, message)),
      ).toEqual([1, 1, 1, 1]);
    },
    timeout,
  );

  it("dispose() validates its argument", async () => {
    const root = join(cwd, "import-meta-hot-invalid.ts");
    writeFileSync(
      root,
      `
        const results = [];
        try {
          import.meta.hot.dispose(123);
          results.push("no-throw");
        } catch (e) {
          results.push(e?.code ?? e?.name);
        }
        // The methods read the module they belong to from \`this\`.
        try {
          import.meta.hot.dispose.call({}, () => {});
          results.push("no-throw");
        } catch (e) {
          results.push(e?.code ?? e?.name);
        }
        console.log(JSON.stringify(results));
        process.exit(0);
      `,
    );
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", root],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["ERR_INVALID_ARG_TYPE", "ERR_INVALID_THIS"]),
      stderr: "",
      exitCode: 0,
    });
  });

  it("is undefined inside workers even under --hot", async () => {
    const workerPath = join(cwd, "import-meta-hot-worker.ts");
    const mainPath = join(cwd, "import-meta-hot-worker-main.ts");
    writeFileSync(
      workerPath,
      `
        // Workers are not reloaded under --hot, so import.meta.hot is undefined
        // and unguarded calls fold away at transpile time.
        import.meta.hot.dispose(() => { throw new Error("should not run"); });
        self.postMessage({ hot: typeof import.meta.hot });
      `,
    );
    writeFileSync(
      mainPath,
      `
        const w = new Worker(${JSON.stringify(workerPath)});
        w.onmessage = (e) => {
          console.log(JSON.stringify({ main: typeof import.meta.hot, worker: e.data.hot }));
          w.terminate();
          process.exit(0);
        };
        w.onerror = (e) => {
          console.error(String(e?.message ?? e));
          process.exit(1);
        };
      `,
    );
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", mainPath],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ main: "object", worker: "undefined" }),
      stderr: "",
      exitCode: 0,
    });
  });
});
