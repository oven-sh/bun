import { spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
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
 * This avoids the previous pattern where duplicate error handling could
 * write identical file content (causing the watcher to not fire) or
 * discard buffered lines via `continue outer`.
 */
async function driveErrorReloadCycle(
  runner: ReturnType<typeof spawn>,
  opts: {
    targetCount: number;
    onReload: (counter: number, nonce: number) => void;
    verifyLine?: (errorLine: string, nextLine: string | undefined, counter: number) => void;
  },
): Promise<number> {
  const { targetCount, onReload, verifyLine } = opts;
  let reloadCounter = 0;
  let str = "";
  // Nonce ensures file content always changes, even when re-saving on duplicate errors.
  // Without this, writing the same content may not trigger the file watcher.
  let nonce = 0;

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
      if (!line.includes("error:")) continue;

      if (reloadCounter >= targetCount) {
        runner.kill();
        return reloadCounter;
      }

      // If we see the previous error repeated, the pending reload hasn't
      // taken effect yet. Re-save with a new nonce to force a watcher event,
      // then skip to reading the next chunk.
      if (line.includes(`error: ${reloadCounter - 1}`)) {
        // Put remaining unprocessed lines back into str so they aren't lost
        const remaining = lines.slice(i + 1).join("\n");
        str = remaining ? (str ? `${remaining}\n${str}` : remaining) : str;
        nonce++;
        onReload(reloadCounter, nonce);
        break;
      }

      expect(line).toContain(`error: ${reloadCounter}`);

      const nextLine = lines[i + 1];
      if (verifyLine) {
        verifyLine(line, nextLine, reloadCounter);
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
      nonce++;
      onReload(reloadCounter, nonce);
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

      let reloadCounter = 0;
      const code = readFileSync(root, "utf-8");
      async function onReload() {
        writeFileSync(root + ".another.yet.js", code);
        unlinkSync(root + ".another.yet.js");
      }
      var finished = false;
      await Promise.race([
        Bun.sleep(200),
        (async () => {
          if (finished) {
            return;
          }
          var str = "";
          for await (const line of runner.stdout) {
            if (finished) {
              return;
            }

            str += new TextDecoder().decode(line);
            if (!/\[#!root\].*[0-9]\n/g.test(str)) continue;

            for (let line of str.split("\n")) {
              if (!line.includes("[#!root]")) continue;
              if (finished) {
                return;
              }
              await onReload();

              reloadCounter++;
              str = "";
              expect(line).toContain(`[#!root] Reloaded: ${reloadCounter}`);
            }
          }
        })(),
      ]);
      finished = true;
      runner.kill(0);
      runner.unref();

      expect(reloadCounter).toBe(1);
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

const comment_spam = ("//" + "B".repeat(2000) + "\n").repeat(1000);
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
      onReload: (counter, nonce) => {
        writeFileSync(
          hotRunnerRoot,
          `// source content /*nonce:${nonce}*/
${comment_spam}
${" ".repeat(counter * 2)}throw new Error(${counter});`,
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
    const reloadCounter = await Promise.race([
      driveErrorReloadCycle(runner, {
        targetCount: 50,
        onReload: (counter, nonce) => {
          writeFileSync(
            bundleIn,
            `// source content /*nonce:${nonce}*/
// etc etc
// etc etc
${" ".repeat(counter * 2)}throw new Error(${counter});`,
          );
        },
        verifyLine: (_errorLine, nextLine, counter) => {
          expect(nextLine).toInclude("bundle_in.ts");
          const match = nextLine!.match(/\s*at.*?:4:(\d+)$/);
          if (!match) throw new Error("invalid stack trace: " + nextLine);
          const col = match[1];
          expect(Number(col)).toBe(1 + "throw ".length + counter * 2);
        },
      }),
      bundler.exited.then(code => {
        throw new Error(`bundler exited early with code ${code}`);
      }),
    ]);
    expect(reloadCounter).toBe(50);
    bundler.kill();
  },
  timeout,
);

const long_comment = "BBBB".repeat(100000);

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
    const reloadCounter = await Promise.race([
      driveErrorReloadCycle(runner, {
        targetCount: 50,
        onReload: (counter, nonce) => {
          writeFileSync(
            bundleIn,
            `// ${long_comment} /*nonce:${nonce}*/
console.error("RSS: %s", process.memoryUsage().rss);
//
${" ".repeat(counter * 2)}throw new Error(${counter});`,
          );
        },
        verifyLine: (_errorLine, nextLine, counter) => {
          expect(nextLine).toInclude("bundle_in.ts");
          const match = nextLine!.match(/\s*at.*?:4:(\d+)$/);
          if (!match) throw new Error("invalid stack trace: " + nextLine);
          const col = match[1];
          expect(Number(col)).toBe(1 + "throw ".length + counter * 2);
        },
      }),
      bundler.exited.then(code => {
        throw new Error(`bundler exited early with code ${code}`);
      }),
    ]);
    expect(reloadCounter).toBe(50);
    bundler.kill();
    await runner.exited;
    // TODO: bun has a memory leak when --hot is used on very large files
  },
  longTimeout,
);
