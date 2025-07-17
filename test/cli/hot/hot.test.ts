import { spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
import { copyFileSync, cpSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, tmpdirSync, waitForFileToExist } from "harness";
import { join } from "path";

const timeout = isDebug ? Infinity : 10_000;
const longTimeout = isDebug ? Infinity : 30_000;

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
    let reloadCounter = 0;
    function onReload() {
      writeFileSync(
        hotRunnerRoot,
        `// source content
${comment_spam}
${" ".repeat(reloadCounter * 2)}throw new Error(${reloadCounter});`,
      );
    }
    let str = "";
    outer: for await (const chunk of runner.stderr) {
      str += new TextDecoder().decode(chunk);
      var any = false;
      if (!/error: .*[0-9]\n.*?\n/g.test(str)) continue;

      let it = str.split("\n");
      let line;
      while ((line = it.shift())) {
        if (!line.includes("error:")) continue;
        str = "";

        if (reloadCounter === 50) {
          runner.kill();
          break;
        }

        if (line.includes(`error: ${reloadCounter - 1}`)) {
          onReload(); // re-save file to prevent deadlock
          continue outer;
        }
        expect(line).toContain(`error: ${reloadCounter}`);
        reloadCounter++;

        let next = it.shift()!;
        if (!next) throw new Error(line);
        const match = next.match(/\s*at.*?:1003:(\d+)$/);
        if (!match) throw new Error("invalid string: " + next);
        const col = match[1];
        expect(Number(col)).toBe(1 + "throw ".length + (reloadCounter - 1) * 2);
        any = true;
      }

      if (any) await onReload();
    }
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
      stdout: "inherit",
      stderr: "inherit",
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
    let reloadCounter = 0;
    function onReload() {
      writeFileSync(
        bundleIn,
        `// source content
// etc etc
// etc etc
${" ".repeat(reloadCounter * 2)}throw new Error(${reloadCounter});`,
      );
    }
    let str = "";
    outer: for await (const chunk of runner.stderr) {
      const s = new TextDecoder().decode(chunk);
      str += s;
      var any = false;
      if (!/error: .*[0-9]\n.*?\n/g.test(str)) continue;

      let it = str.split("\n");
      let line;
      while ((line = it.shift())) {
        if (!line.includes("error:")) continue;
        str = "";

        if (reloadCounter === 50) {
          runner.kill();
          break;
        }

        if (line.includes(`error: ${reloadCounter - 1}`)) {
          onReload(); // re-save file to prevent deadlock
          continue outer;
        }
        expect(line).toContain(`error: ${reloadCounter}`);
        reloadCounter++;

        let next = it.shift()!;
        expect(next).toInclude("bundle_in.ts");
        const col = next.match(/\s*at.*?:4:(\d+)$/)![1];
        expect(Number(col)).toBe(1 + "throw ".length + (reloadCounter - 1) * 2);
        any = true;
      }

      if (any) await onReload();
    }
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
      stdout: "inherit",
      stderr: "pipe",
      stdin: "ignore",
    });
    let reloadCounter = 0;
    function onReload() {
      writeFileSync(
        bundleIn,
        `// ${long_comment}
console.error("RSS: %s", process.memoryUsage().rss);
//
${" ".repeat(reloadCounter * 2)}throw new Error(${reloadCounter});`,
      );
    }
    let str = "";
    let sampleMemory10: number | undefined;
    let sampleMemory100: number | undefined;
    outer: for await (const chunk of runner.stderr) {
      str += new TextDecoder().decode(chunk);
      var any = false;
      if (!/error: .*[0-9]\n.*?\n/g.test(str)) continue;

      let it = str.split("\n");
      let line;
      while ((line = it.shift())) {
        if (!line.includes("error:")) continue;
        let rssMatch = str.match(/RSS: (\d+(\.\d+)?)\n/);
        let rss;
        if (rssMatch) rss = Number(rssMatch[1]);
        str = "";

        if (reloadCounter == 10) {
          sampleMemory10 = rss;
        }

        if (reloadCounter >= 50) {
          sampleMemory100 = rss;
          runner.kill();
          break;
        }

        if (line.includes(`error: ${reloadCounter - 1}`)) {
          onReload(); // re-save file to prevent deadlock
          continue outer;
        }
        expect(line).toContain(`error: ${reloadCounter}`);

        reloadCounter++;
        let next = it.shift()!;
        expect(next).toInclude("bundle_in.ts");
        const col = next.match(/\s*at.*?:4:(\d+)$/)![1];
        expect(Number(col)).toBe(1 + "throw ".length + (reloadCounter - 1) * 2);
        any = true;
      }

      if (any) await onReload();
    }
    expect(reloadCounter).toBe(50);
    bundler.kill();
    await runner.exited;
    // TODO: bun has a memory leak when --hot is used on very large files
    // console.log({ sampleMemory10, sampleMemory100 });
  },
  longTimeout,
);
