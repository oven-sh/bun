import { spawn } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, cpSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, tmpdirSync, waitForFileToExist } from "harness";
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
  // rmSync first on Windows so renameSync doesn't EPERM on the existing target
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
console.error("RSS: %s", process.memoryUsage().rss);
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
console.error("RSS: %s", process.memoryUsage().rss);
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
          console.log("ok");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });

  it(
    "runs dispose callbacks and persists data across reloads",
    async () => {
      const root = join(cwd, "import-meta-hot-app.ts");
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
        const intervalsAtStart = globalThis.__intervals ??= new Set();
        intervalsAtStart.add(iv);
        hot.dispose((data) => {
          clearInterval(iv);
          intervalsAtStart.delete(iv);
          process.off("beforeExit", listener);
          globalThis.__disposed = { gen, data: { ...data } };
        });

        const noopNames = ["accept", "decline", "on", "off", "prune", "invalidate", "send"];
        console.log(JSON.stringify({
          gen,
          hasHot: true,
          keys: Object.keys(hot).sort(),
          prevGen: prevGen ?? null,
          listenerCount: process.listenerCount("beforeExit"),
          liveIntervals: intervalsAtStart.size,
          disposed: globalThis.__disposed ?? null,
          noops: noopNames.filter(n => typeof hot[n] === "function" && hot[n]() === undefined),
        }));
      `;
      writeFileSync(root, source);

      await using runner = spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", root],
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
      for await (const chunk of runner.stdout) {
        buf += new TextDecoder().decode(chunk);
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.startsWith("{")) continue;
          const obj = JSON.parse(line);
          lines.push(obj);
          if (lines.length < 3) {
            // Trigger the next reload by rewriting the file.
            writeFileSync(root, source + `\n// reload ${lines.length}\n`);
          } else {
            runner.kill();
            break;
          }
        }
        if (lines.length >= 3) break;
      }

      runner.kill();
      await runner.exited;
      await stderrDone;

      const keys = ["accept", "data", "decline", "dispose", "invalidate", "off", "on", "prune", "send"];
      const noops = ["accept", "decline", "on", "off", "prune", "invalidate", "send"];
      try {
        expect(lines).toEqual([
          {
            gen: 1,
            hasHot: true,
            keys,
            prevGen: null,
            listenerCount: 1,
            liveIntervals: 1,
            disposed: null,
            noops,
          },
          {
            gen: 2,
            hasHot: true,
            keys,
            prevGen: 1,
            listenerCount: 1,
            liveIntervals: 1,
            disposed: { gen: 1, data: { prevGen: 1 } },
            noops,
          },
          {
            gen: 3,
            hasHot: true,
            keys,
            prevGen: 2,
            listenerCount: 1,
            liveIntervals: 1,
            disposed: { gen: 2, data: { prevGen: 2 } },
            noops,
          },
        ]);
      } catch (e) {
        console.error("stderr:", stderr);
        throw e;
      }
    },
    timeout,
  );

  it(
    "reloads even if a dispose callback throws",
    async () => {
      const root = join(cwd, "import-meta-hot-throws.ts");
      const source = `
        const gen = (globalThis.__gen = (globalThis.__gen ?? 0) + 1);
        import.meta.hot.dispose(() => { throw new Error("dispose-error-from-gen-" + gen); });
        import.meta.hot.dispose(() => { globalThis.__second = gen; });
        console.log(JSON.stringify({ gen, secondRan: globalThis.__second ?? null }));
      `;
      writeFileSync(root, source);

      await using runner = spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", root],
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
      for await (const chunk of runner.stdout) {
        buf += new TextDecoder().decode(chunk);
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.startsWith("{")) continue;
          lines.push(JSON.parse(line));
          if (lines.length < 2) {
            writeFileSync(root, source + `\n// reload ${lines.length}\n`);
          } else {
            runner.kill();
            break;
          }
        }
        if (lines.length >= 2) break;
      }

      runner.kill();
      await runner.exited;
      await stderrDone;

      expect(lines).toEqual([
        { gen: 1, secondRan: null },
        { gen: 2, secondRan: 1 },
      ]);
      expect(stderr).toContain("dispose-error-from-gen-1");
    },
    timeout,
  );

  it("dispose() validates its argument", async () => {
    const root = join(cwd, "import-meta-hot-invalid.ts");
    writeFileSync(
      root,
      `
        try {
          import.meta.hot.dispose(123);
          console.log("no-throw");
        } catch (e) {
          console.log(e?.code ?? e?.name, String(e?.message ?? e));
        }
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
      stdout: "ERR_INVALID_ARG_TYPE import.meta.hot.dispose() expects a function",
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
