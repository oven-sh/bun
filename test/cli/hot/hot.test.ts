import { spawn, spawnSync } from "bun";
import { beforeEach, expect, it } from "bun:test";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
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

// Reads the standard output of a watched program.
function stdoutOf(proc: { stdout: ReadableStream<Uint8Array> }) {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  return {
    async until(needle: string) {
      while (!output.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the program exited, output so far: ${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
    },
    async toEnd() {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return output;
        output += decoder.decode(value, { stream: true });
      }
    },
  };
}

// Returns once the watcher thread has handled every event made before the call. The watcher logs
// a batch of events, handles it, then reads the next batch. So once it logs a batch that was made
// after another one, it has handled the other one. `fence` is a watched folder.
async function watcherHandled(trace: string, fence: string) {
  for (let i = 0; i < 2; i++) {
    const from = statSync(trace).size;
    const name = crypto.randomUUID();
    mkdirSync(join(fence, name));
    // kqueue does not log the changed name, only the watched path.
    const logged = isLinux ? name : '/fence/"';
    while (!readFileSync(trace, "latin1").slice(from).includes(logged)) await Bun.sleep(1);
  }
}

// One save can reload the program more than once.
const withoutRepeats = (output: string) => output.split("\n").filter((line, i, lines) => line !== lines[i - 1]);

// The resolver caches a failed read of a directory (any errno but ENOENT) in
// the place of its listing. The reloader used to read that cache for each
// directory event, and aborted on the failed read:
// "EntriesOption::entries on non-Entries variant".
//
// The fixture makes the read fail with no permission and no descriptor limit.
// It moves `lib` away and puts a plain file at its path, so a listing of `lib`
// is ENOTDIR. The watch stays on the folder that moved, so a change in it is a
// directory event for `lib`.
const readErrorFixture = {
  "trace.log": "",
  "src/lib/a.ts": `export const v = 1;`,
  "src/fence/f.ts": `export {};`,
  "src/main.ts": `import { v } from "./lib/a.ts";
import "./fence/f.ts";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
console.log("RUN", v);
if (v !== 1) process.exit(0);
const trace = process.env.BUN_WATCHER_TRACE;
// The same wait as watcherHandled() in the test file.
const handled = async () => {
  for (let i = 0; i < 2; i++) {
    const from = statSync(trace).size;
    const name = crypto.randomUUID();
    mkdirSync("fence/" + name);
    const logged = process.platform === "linux" ? name : '/fence/"';
    while (!readFileSync(trace, "latin1").slice(from).includes(logged)) await Bun.sleep(1);
  }
};
renameSync("lib", "lib.away");
writeFileSync("lib", "");
await handled();
// The lookup fails, so the resolver lists lib again and caches ENOTDIR.
await import("./lib/b.ts").then(
  () => console.log("IMPORT ok"),
  () => console.log("IMPORT failed"),
);
if (process.env.THEN === "remove") {
  rmSync("lib.away", { recursive: true });
  await handled();
  console.log("REMOVED");
} else {
  writeFileSync("lib.away/" + process.env.THEN, "");
  await handled();
  rmSync("lib");
  renameSync("lib.away", "lib");
  await handled();
  console.log("HEALED");
}
setInterval(() => {}, 1e6);
`,
};
for (const [flag, what, then] of [
  ["--hot", "a new file in the folder", "c.ts"],
  ["--watch", "a new file in the folder", "c.ts"],
  // The reloader did not look up a dot name, but it kept the cache entry for the next event.
  ["--hot", "a dot file in the folder", ".env"],
  ["--watch", "a dot file in the folder", ".env"],
  // kqueue names no entry. It takes the watched files that are gone when the folder is deleted.
  ["--hot", "the removal of the folder", "remove"],
]) {
  // The Windows watcher reports each changed file itself. Its directory events only drop the cache.
  it.skipIf(isWindows)(
    `${flag} survives ${what} whose cached listing is a read error`,
    async () => {
      using dir = tempDir("hot-dir-read-error", readErrorFixture);
      const cwd = join(String(dir), "src");
      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "main.ts"],
        cwd,
        // The trace file is outside the watched directories so that writes to it cause no events.
        env: { ...bunEnv, BUN_WATCHER_TRACE: join(String(dir), "trace.log"), THEN: then },
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });
      const stdout = stdoutOf(proc);

      if (then === "remove") {
        await stdout.until("REMOVED\n");
        writeFileSync(join(cwd, "main.ts"), `console.log("RUN", 2);\nprocess.exit(0);\n`);
      } else {
        await stdout.until("HEALED\n");
        // A save that replaces the inode: the directory event is the only signal for it on Linux.
        writeFileSync(join(cwd, "lib", "a.ts.tmp"), `export const v = 2;`);
        renameSync(join(cwd, "lib", "a.ts.tmp"), join(cwd, "lib", "a.ts"));
      }
      expect(await stdout.toEnd()).toBe(`RUN 1\nIMPORT failed\n${then === "remove" ? "REMOVED" : "HEALED"}\nRUN 2\n`);
      expect(await proc.exited).toBe(0);
    },
    timeout,
  );
}

// Both come from the length of a path in a PATH_MAX buffer of the watcher thread. Only inotify
// names the changed entry, and PATH_MAX is 1024 on macOS.
for (const [what, name] of [
  // A directory event joined the folder and the name with no bound:
  // "range end index 4097 out of range for slice of length 4096".
  ["a new file whose path is longer than PATH_MAX", Buffer.alloc(247, "n") + ".ts"],
  // The watch of an imported file wrote a NUL behind its path:
  // "index out of bounds: the len is 4096 but the index is 4096".
  ["an import whose path is PATH_MAX long", Buffer.alloc(245, "n") + ".png"],
]) {
  it.skipIf(!isLinux)(
    `--hot survives ${what}`,
    async () => {
      using dir = tempDir("hot-long-path", {});
      // A folder of 3846 bytes is under PATH_MAX, so bun runs in it. Folder + separator + name is
      // 4097 bytes with the name of 250 bytes and 4096 bytes with the name of 249 bytes.
      const folderLength = 3846;
      let cwd = realpathSync(String(dir));
      while (folderLength - cwd.length > 256) cwd = join(cwd, Buffer.alloc(200, "d").toString());
      cwd = join(cwd, Buffer.alloc(folderLength - cwd.length - 1, "e").toString());
      mkdirSync(cwd, { recursive: true });
      // The absolute path does not fit in PATH_MAX, so only a relative name reaches the file.
      const create = `require("node:fs").writeFileSync("${name}", "");`;
      if (name.endsWith(".png")) {
        expect(spawnSync({ cmd: [bunExe(), "-e", create], cwd, env: bunEnv }).exitCode).toBe(0);
      }
      writeFileSync(
        join(cwd, "main.ts"),
        name.endsWith(".png")
          ? `import asset from "./${name}";
console.log("RUN", asset.length === 4096 ? 1 : asset);
console.log("READY");
setInterval(() => {}, 1e6);
`
          : `console.log("RUN", 1);
${create}
console.log("READY");
setInterval(() => {}, 1e6);
`,
      );
      await using proc = spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "main.ts"],
        cwd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });
      const stdout = stdoutOf(proc);

      await stdout.until("READY\n");
      writeFileSync(join(cwd, "main.ts"), `console.log("RUN", 2);\nprocess.exit(0);\n`);
      expect(await stdout.toEnd()).toBe("RUN 1\nREADY\nRUN 2\n");
      expect(await proc.exited).toBe(0);
    },
    timeout,
  );
}

// The entry point has a watch of its own, which a delete takes away. The reloader then takes a
// directory event that names the entry as its reload. It compared the folder of the event with
// the folder of the entry by the hash of one spelling. Only inotify names the entry: kqueue does
// not reload an entry point that is deleted and then created again.
for (const [spelling, lookup] of [
  ["without a trailing separator", "../app/missing.js"],
  ["through a symlink", "../applink/missing.js"],
]) {
  it.skipIf(!isLinux)(
    `--hot reloads a recreated entry point whose folder was first watched ${spelling}`,
    async () => {
      using dir = tempDir("hot-entry-folder-spelling", {
        "trace.log": "",
        // A lookup that fails watches the folder under the spelling of the lookup.
        "src/pre/setup.js": `try { require("${lookup}"); } catch {}\n`,
        "src/fence/f.js": `export {};`,
        "src/app/entry.js": `import "../fence/f.js";\nconsole.log("EVAL", 1);\nsetInterval(() => {}, 1e6);\n`,
      });
      const cwd = join(String(dir), "src");
      symlinkSync("app", join(cwd, "applink"), "dir");
      const trace = join(String(dir), "trace.log");
      await using proc = spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "--preload", "./pre/setup.js", "app/entry.js"],
        cwd,
        env: { ...bunEnv, BUN_WATCHER_TRACE: trace },
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });
      const stdout = stdoutOf(proc);

      await stdout.until("EVAL 1\n");
      rmSync(join(cwd, "app", "entry.js"));
      // The delete is handled in a batch of its own: the entry is off the watchlist.
      await watcherHandled(trace, join(cwd, "fence"));
      writeFileSync(join(cwd, "app", "entry.js"), `console.log("EVAL", 2);\nprocess.exit(0);\n`);
      expect(await stdout.toEnd()).toBe("EVAL 1\nEVAL 2\n");
      expect(await proc.exited).toBe(0);
    },
    // A reload that does not come is a hang, so the limit is finite on a debug build too.
    30_000,
  );
}

// The reloader took only a name that has a loader and no leading dot from a directory event,
// whatever the watchlist held.
it.skipIf(isWindows)(
  "--hot reloads a dot-named module and a text import that are saved by rename",
  async () => {
    using dir = tempDir("hot-dir-event-any-name", {
      "lib/.config.ts": `export const v = 1;`,
      "lib/notes.md": `one`,
      "main.ts": `import { v } from "./lib/.config.ts";
import notes from "./lib/notes.md" with { type: "text" };
console.log("RUN", v, notes);
if (v === 2 && notes === "two") process.exit(0);
setInterval(() => {}, 1e6);
`,
    });
    const cwd = String(dir);
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "main.ts"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    const stdout = stdoutOf(proc);
    const renameOver = (name: string, contents: string) => {
      writeFileSync(join(cwd, "lib", name + ".tmp"), contents);
      renameSync(join(cwd, "lib", name + ".tmp"), join(cwd, "lib", name));
    };

    await stdout.until("RUN 1 one\n");
    renameOver(".config.ts", `export const v = 2;`);
    await stdout.until("RUN 2 one\n");
    renameOver("notes.md", `two`);
    expect(withoutRepeats(await stdout.toEnd())).toEqual(["RUN 1 one", "RUN 2 one", "RUN 2 two", ""]);
    expect(await proc.exited).toBe(0);
  },
  30_000,
);

// https://github.com/oven-sh/bun/issues/30436, for an import: a Bun.build() in the entry lists
// the folder again, and the new listing does not know which of its files are loaded.
it.skipIf(isWindows)(
  "--hot reloads an import that is saved by rename after a Bun.build() in the entry",
  async () => {
    using dir = tempDir("hot-dir-event-after-build", {
      "a.ts": `export const v = 1;`,
      "app.ts": `import { v } from "./a.ts";
console.log("RUN", v);
if (v === 3) process.exit(0);
if (!globalThis.built) {
  globalThis.built = true;
  try {
    await Bun.build({ entrypoints: ["nonexistent.ts"] });
  } catch {}
  console.log("BUILT");
}
setInterval(() => {}, 1e6);
`,
    });
    const cwd = String(dir);
    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "app.ts"],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    const stdout = stdoutOf(proc);
    const renameOver = (contents: string) => {
      writeFileSync(join(cwd, "a.ts.tmp"), contents);
      renameSync(join(cwd, "a.ts.tmp"), join(cwd, "a.ts"));
    };

    await stdout.until("BUILT\n");
    renameOver(`export const v = 2;`);
    await stdout.until("RUN 2\n");
    renameOver(`export const v = 3;`);
    expect(withoutRepeats(await stdout.toEnd())).toEqual(["RUN 1", "BUILT", "RUN 2", "RUN 3", ""]);
    expect(await proc.exited).toBe(0);
  },
  30_000,
);
