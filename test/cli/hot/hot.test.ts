import { spawn } from "bun";
import { beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles, bunRun, bunRunAsScript } from "harness";
import { cpSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let hotRunnerRoot: string = "",
  cwd = "";
beforeEach(() => {
  const hotPath = join(tmpdir(), "bun-hot-test-" + (Date.now() | 0) + "_" + Math.random().toString(36).slice(2));
  hotRunnerRoot = join(hotPath, "hot-runner-root.js");
  rmSync(hotPath, { recursive: true, force: true });
  cpSync(import.meta.dir, hotPath, { recursive: true, force: true });
  cwd = hotPath;
});

it("should hot reload when file is overwritten", async () => {
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

    expect(reloadCounter).toBe(3);
  } finally {
    // @ts-ignore
    runner?.unref?.();
    // @ts-ignore
    runner?.kill?.(9);
  }
});

it("should recover from errors", async () => {
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
});

it("should not hot reload when a random file is written", async () => {
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
});

it("should hot reload when a file is deleted and rewritten", async () => {
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
});

it("should hot reload when a file is renamed() into place", async () => {
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
});
