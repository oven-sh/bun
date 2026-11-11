// https://github.com/oven-sh/bun/issues/44695
import { describe, expect, test } from "bun:test";
import { copyFileSync, rmSync } from "node:fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const exe = process.platform === "win32" ? ".exe" : "";

async function compile(dir: string, entries: string[], extraArgs: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", ...entries, "--outfile", "app", ...extraArgs],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (code !== 0) throw new Error(`compile failed (exit ${code})\n${stdout}\n${stderr}`);
  return stderr;
}

async function run(binary: string) {
  // cwd outside the build dir so the binary cannot accidentally find real files on disk.
  await using proc = Bun.spawn({
    cmd: [binary],
    cwd: process.platform === "win32" ? process.env.TEMP || "C:\\Windows\\Temp" : "/tmp",
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, code };
}

describe.concurrent("compile: new URL(relative, import.meta.url)", () => {
  test.each([
    ["default", []],
    ["--bytecode", ["--bytecode"]],
  ])(
    "embeds the referenced file so the executable works after it is moved (%s)",
    async (_name, extraArgs) => {
      using build = tempDir("new-url-asset-build", {
        "index.ts": /* ts */ `
          import { readFileSync, existsSync } from "node:fs";
          import { fileURLToPath } from "node:url";

          // --bytecode emits CommonJS, which has no top-level await.
          async function main() {
            const viaUrl = readFileSync(new URL("./data.txt", import.meta.url), "utf8");
            const viaPath = readFileSync(fileURLToPath(new URL("./sub/nested.txt", import.meta.url)), "utf8");
            const viaBunFile = await Bun.file(new URL("./data.txt", import.meta.url)).text();
            const exists = existsSync(new URL("./data.txt", import.meta.url));
            console.log(JSON.stringify({ viaUrl, viaPath, viaBunFile, exists }));
          }
          main();
        `,
        "data.txt": "hello from data",
        "sub/nested.txt": "hello from nested",
      });
      await compile(String(build), ["./index.ts"], extraArgs);

      // Move the executable alone: the build directory (and the assets in it) is deleted afterwards.
      using moved = tempDir("new-url-asset-moved", {});
      const target = join(String(moved), "app" + exe);
      copyFileSync(join(String(build), "app" + exe), target);
      rmSync(String(build), { recursive: true, force: true });

      const { stdout, stderr, code } = await run(target);
      expect(stderr).not.toContain("ENOENT");
      expect(JSON.parse(stdout)).toEqual({
        viaUrl: "hello from data",
        viaPath: "hello from nested",
        viaBunFile: "hello from data",
        exists: true,
      });
      expect(code).toBe(0);
    },
  );

  test(
    "new Worker(new URL(...)) keeps its own handling and is not embedded as an asset",
    async () => {
      using build = tempDir("new-url-asset-worker", {
        "index.ts": /* ts */ `
          const worker = new Worker(new URL("./worker.ts", import.meta.url));
          const message = await new Promise(resolve => {
            worker.onmessage = event => resolve(event.data);
          });
          worker.terminate();
          console.log(JSON.stringify({ message, embedded: Bun.embeddedFiles.length }));
        `,
        "worker.ts": /* ts */ `postMessage("from worker");`,
      });
      await compile(String(build), ["./index.ts", "./worker.ts"]);

      const { stdout, stderr, code } = await run(join(String(build), "app" + exe));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ message: "from worker", embedded: 0 });
      expect(code).toBe(0);
    },
  );

  test("a plugin's virtual module keeps its URL as written, never embedding from a guessed directory", async () => {
    // The virtual module's path is relative, so it has no directory on disk to resolve "./x.txt"
    // against. A real lib/x.txt exists in the build directory, so probing a guessed directory would
    // find it; the URL must be left as written instead, like any target missing at build time.
    using build = tempDir("new-url-asset-virtual", {
      "build.ts": /* ts */ `
        const result = await Bun.build({
          entrypoints: ["./index.ts"],
          compile: { outfile: "app" },
          plugins: [{
            name: "virtual",
            setup(b) {
              b.onResolve({ filter: /^virtual:mod$/ }, () => ({ path: "lib/mod.js", namespace: "virtual" }));
              b.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
                contents: 'export const href = new URL("./x.txt", import.meta.url).href;',
                loader: "js",
              }));
            },
          }],
        });
        if (!result.success) {
          console.error(result.logs.join("\\n"));
          process.exit(1);
        }
      `,
      "index.ts": /* ts */ `
        import { href } from "virtual:mod";
        console.log(JSON.stringify({ relative: href.endsWith("/x.txt"), embedded: Bun.embeddedFiles.length }));
      `,
      "lib/x.txt": "must not be embedded",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      cwd: String(build),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildErr, buildCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(buildErr).toBe("");
    expect(buildCode).toBe(0);

    const { stdout, stderr, code } = await run(join(String(build), "app" + exe));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ relative: true, embedded: 0 });
    expect(code).toBe(0);
  });

  test("a nested new URL inside a Worker's URL argument is not embedded either", async () => {
    using build = tempDir("new-url-asset-worker-nested", {
      "index.ts": /* ts */ `
        const worker = new Worker(new URL("./worker.ts", new URL("./existing-asset.txt", import.meta.url)));
        const message = await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
        });
        worker.terminate();
        console.log(JSON.stringify({ message, embedded: Bun.embeddedFiles.length }));
      `,
      "worker.ts": /* ts */ `postMessage("from worker");`,
      "existing-asset.txt": "asset",
    });
    await compile(String(build), ["./index.ts", "./worker.ts"]);

    const { stdout, stderr, code } = await run(join(String(build), "app" + exe));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ message: "from worker", embedded: 0 });
    expect(code).toBe(0);
  });

  test(
    "a file that does not exist at build time is left as written",
    async () => {
      using build = tempDir("new-url-asset-missing", {
        "index.ts": /* ts */ `
          import { existsSync } from "node:fs";
          const url = new URL("./missing.txt", import.meta.url);
          console.log(JSON.stringify({
            sibling: url.href === new URL("missing.txt", import.meta.url).href,
            exists: existsSync(url),
            embedded: Bun.embeddedFiles.length,
          }));
        `,
      });
      await compile(String(build), ["./index.ts"]);

      const { stdout, stderr, code } = await run(join(String(build), "app" + exe));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ sibling: true, exists: false, embedded: 0 });
      expect(code).toBe(0);
    },
  );
});
