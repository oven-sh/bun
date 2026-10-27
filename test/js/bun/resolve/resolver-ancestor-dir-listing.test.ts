import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join, sep } from "path";

// The resolver caches a listing of every directory it visits. An ancestor of
// the cwd (or of the entry point) is only visited to find package.json,
// tsconfig.json, jsconfig.json and node_modules, so it gets a probe-only
// listing instead of a full readdir. The full listing is read the first time
// something resolves a file in that directory.

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("resolver ancestor directory listing", () => {
  // Each listing the resolver reads is logged under the `Fs` debug scope,
  // which is compiled out of release builds: `readdir(fd, dir) = n` for a
  // full listing and `probe(fd, dir) = n` for a probe-only one.
  function listings(stdout: string, kind: "readdir" | "probe", dir: string) {
    return stdout.split("\n").filter(line => line.includes(`${kind}(`) && line.includes(`, ${dir}${sep}) =`));
  }

  test.skipIf(!isDebug).each([
    ["a file", (cwd: string) => [bunExe(), "index.js"]],
    ["-e", (cwd: string) => [bunExe(), "-e", "console.log('ran')"]],
  ])("startup does not list the parent of the cwd (%s)", async (_, cmd) => {
    using dir = tempDir("ancestor-listing", {
      "parent/child/index.js": `console.log("ran");`,
    });
    const parent = join(String(dir), "parent");
    for (let i = 0; i < 200; i++) {
      writeFileSync(join(parent, `noise-${i}.txt`), "");
    }
    const cwd = join(parent, "child");

    const { stdout, stderr, exitCode } = await run(cmd(cwd), cwd, { BUN_DEBUG_Fs: "1" });
    expect(listings(stdout, "readdir", parent)).toEqual([]);
    expect(listings(stdout, "probe", parent)).toHaveLength(1);
    expect(listings(stdout, "readdir", cwd)).toHaveLength(1);
    expect(stdout).toContain("ran");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // A directory at or below the cwd is read in full once, never probed
  // first: the bundler resolves files in every one of them.
  test.skipIf(!isDebug)("a directory below the cwd is read in full exactly once", async () => {
    using dir = tempDir("below-cwd-listing", {
      "package.json": JSON.stringify({ name: "proj" }),
      "src/pages/utils.ts": `export const u = 1;`,
      "src/pages/a/index.ts": `import { u } from "../utils"; export const a = u;`,
      "src/pages/b/index.ts": `import { u } from "../utils"; export const b = u;`,
      "src/index.ts": `export * from "./pages/a"; export * from "./pages/b";`,
    });
    const pages = join(String(dir), "src", "pages");

    const { stdout, stderr, exitCode } = await run([bunExe(), "build", "src/index.ts"], String(dir), {
      BUN_DEBUG_Fs: "1",
    });
    expect(stderr).toBe("");
    expect(listings(stdout, "probe", pages)).toEqual([]);
    expect(listings(stdout, "readdir", pages)).toHaveLength(1);
    expect(exitCode).toBe(0);
  });

  test("node_modules, package.json and tsconfig.json in ancestors are found", async () => {
    using dir = tempDir("ancestor-discovery", {
      "proj/package.json": JSON.stringify({ name: "proj", type: "module" }),
      "proj/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "proj/node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "index.js" }),
      "proj/node_modules/pkg/index.js": `module.exports = "from pkg";`,
      "proj/src/util.js": `export const util = "from util";`,
      "proj/src/deep/sub/index.ts": `
        import pkg from "pkg";
        import { util } from "@/util";
        console.log(pkg, util);
      `,
    });
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(String(dir), "proj", `noise-${i}.txt`), "");
    }

    const { stdout, stderr, exitCode } = await run([bunExe(), "index.ts"], join(String(dir), "proj/src/deep/sub"));
    expect(stderr).toBe("");
    expect(stdout).toBe("from pkg from util\n");
    expect(exitCode).toBe(0);
  });

  test("a file in an ancestor directory resolves after the ancestor was probed", async () => {
    using dir = tempDir("ancestor-upgrade", {
      "proj/package.json": JSON.stringify({ name: "proj" }),
      "proj/helper.js": `module.exports = "from helper";`,
      "proj/Other.js": `module.exports = "from Other";`,
      "proj/src/index.js": `
        console.log(require("../helper"), require("../Other.js"));
      `,
    });
    const proj = join(String(dir), "proj");

    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], join(proj, "src"), {
      BUN_DEBUG_Fs: "1",
    });
    expect(stderr).toBe("");
    expect(stdout).toEndWith("from helper from Other\n");
    if (isDebug) {
      // Probed once as an ancestor, then read in full once for `../helper`.
      expect(listings(stdout, "probe", proj)).toHaveLength(1);
      expect(listings(stdout, "readdir", proj)).toHaveLength(1);
    }
    expect(exitCode).toBe(0);
  });

  test("jsconfig.json in an ancestor is found", async () => {
    using dir = tempDir("ancestor-jsconfig", {
      "proj/package.json": JSON.stringify({ name: "proj" }),
      "proj/jsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "proj/src/util.js": `export const util = "from util";`,
      "proj/src/deep/sub/index.js": `
        import { util } from "@/util";
        console.log(util);
      `,
    });

    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], join(String(dir), "proj/src/deep/sub"));
    expect(stderr).toBe("");
    expect(stdout).toBe("from util\n");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a symlinked package in an ancestor node_modules resolves to its real path", async () => {
    using dir = tempDir("ancestor-symlink", {
      "proj/package.json": JSON.stringify({ name: "proj" }),
      "proj/.store/pkg/package.json": JSON.stringify({ name: "pkg", main: "index.js" }),
      "proj/.store/pkg/index.js": `module.exports = __dirname;`,
      "proj/.store/other/package.json": JSON.stringify({ name: "other", main: "index.js" }),
      "proj/.store/other/index.js": `module.exports = "from other";`,
      "proj/.store/pkg/node_modules/.keep": "",
      "proj/src/index.js": `console.log(require("pkg"), require("pkg/node_modules/other"));`,
    });
    const root = realpathSync(String(dir));
    mkdirSync(join(root, "proj/node_modules"));
    symlinkSync(join(root, "proj/.store/pkg"), join(root, "proj/node_modules/pkg"));
    symlinkSync(join(root, "proj/.store/other"), join(root, "proj/.store/pkg/node_modules/other"));

    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], join(root, "proj/src"));
    expect(stderr).toBe("");
    expect(stdout).toBe(`${join(root, "proj/.store/pkg")} from other\n`);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a symlinked ancestor of the cwd resolves to its real path", async () => {
    using dir = tempDir("ancestor-symlink-cwd", {
      "real/proj/package.json": JSON.stringify({ name: "proj" }),
      "real/proj/src/index.js": `console.log(__dirname);`,
    });
    const root = realpathSync(String(dir));
    symlinkSync(join(root, "real/proj"), join(root, "link"));

    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], join(root, "link/src"));
    expect(stderr).toBe("");
    expect(stdout).toBe(`${join(root, "real/proj/src")}\n`);
    expect(exitCode).toBe(0);
  });

  test("bun run finds scripts and bins through ancestors", async () => {
    using dir = tempDir("ancestor-bun-run", {
      "proj/package.json": JSON.stringify({ name: "proj", scripts: { hello: "echo hello-from-script" } }),
      "proj/node_modules/.bin/mybin": `#!/usr/bin/env bun\nconsole.log("hello-from-bin");`,
      "proj/node_modules/.bin/mybin.cmd": `@echo hello-from-bin`,
      "proj/src/sub/.keep": "",
    });
    const cwd = join(String(dir), "proj/src/sub");

    const script = await run([bunExe(), "run", "hello"], cwd);
    expect(script.stdout).toContain("hello-from-script");
    expect(script.exitCode).toBe(0);

    if (!isWindows) {
      chmodSync(join(String(dir), "proj/node_modules/.bin/mybin"), 0o755);
    }
    const bin = await run([bunExe(), "run", "mybin"], cwd);
    expect(bin.stdout).toContain("hello-from-bin");
    expect(bin.exitCode).toBe(0);
  });
});
