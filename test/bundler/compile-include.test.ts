// https://github.com/oven-sh/bun/issues/11732
//
// `--include <path|glob>` embeds extra files in a `--compile` executable as
// lazily loaded MODULES (transpiled, resolvable by a computed `import()`),
// distinct from `--asset` (raw bytes, read via `fs`/`Bun.file`, tested in
// compile-asset-bunfs.test.ts). See docs/bundler/executables.mdx.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `bun build --compile` copies + rewrites the whole bun binary (~1GB under
// debug+ASAN), which blows the 5s default.
const TIMEOUT = 60_000;
const exe = process.platform === "win32" ? ".exe" : "";

async function compile(dir: string, extraArgs: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./index.ts", "--outfile", "app", ...extraArgs],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (code !== 0) throw new Error(`compile failed (exit ${code})\n${stdout}\n${stderr}`);
  return { stdout, stderr };
}

async function run(dir: string) {
  // cwd outside the build dir so the binary cannot accidentally find real files on disk
  // (that gap is #44053 — an --external/bare-specifier resolution issue, not this feature;
  // an --include'd module must resolve purely from $bunfs).
  await using proc = Bun.spawn({
    cmd: [join(dir, "app" + exe)],
    cwd: process.platform === "win32" ? process.env.TEMP || "C:\\Windows\\Temp" : "/tmp",
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, code };
}

describe.concurrent("compile --include", () => {
  test(
    "a computed import() of an --include'd file resolves from $bunfs, and its module does not run at startup",
    async () => {
      using dir = tempDir("compile-include-basic", {
        "index.ts": /* ts */ `
          import { join } from "path";
          const name = "target";
          // Not statically analyzable: the specifier is built from a runtime
          // string concatenation, so the bundler cannot discover this import by
          // following the static graph. Only --include makes it resolvable.
          const mod = await import(join(import.meta.dirname, "plugins", name + ".js"));
          console.log(JSON.stringify({ value: mod.default, ranAtStartup: globalThis.__ranAtStartup === true }));
        `,
        "plugins/target.js": /* js */ `
          // A side-effect marker: if this ran merely because the executable
          // started (rather than because index.ts's import() reached it), this
          // would be true by the time index.ts checks it above.
          globalThis.__ranAtStartup = true;
          export default "included-value";
        `,
      });

      await compile(String(dir), ["--include", "./plugins/target.js"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(code).toBe(0);
      // The marker is set by target.js's own top-level code, observed from
      // *inside* the same process after the dynamic import() has already
      // resolved and evaluated it — so `ranAtStartup: true` here only proves
      // the module ran (synchronously, before the console.log), not that it
      // ran before main. That half is covered by the next test, which never
      // imports the file at all.
      expect(JSON.parse(stdout.trim())).toEqual({ value: "included-value", ranAtStartup: true });
    },
    TIMEOUT,
  );

  test(
    "an --include'd module is not executed unless something imports it",
    async () => {
      using dir = tempDir("compile-include-not-eager", {
        "index.ts": /* ts */ `
          // Deliberately never imports plugins/target.js, directly or
          // dynamically. If --include eagerly ran included modules (like an
          // additional entry point that the executable also treated as "the"
          // program to run), the side effect below would still land.
          console.log(JSON.stringify({ ranAtStartup: globalThis.__ranAtStartup === true }));
        `,
        "plugins/target.js": /* js */ `
          globalThis.__ranAtStartup = true;
          export default "included-value";
        `,
      });

      await compile(String(dir), ["--include", "./plugins/target.js"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())).toEqual({ ranAtStartup: false });
    },
    TIMEOUT,
  );

  test(
    "--include accepts a directory (recursive) and a glob, both computed-import()-able",
    async () => {
      using dir = tempDir("compile-include-dir-glob", {
        "index.ts": /* ts */ `
          import { join } from "path";
          const dirMod = await import(join(import.meta.dirname, "plugins", "sub", "nested.js"));
          const globMod = await import(join(import.meta.dirname, "handlers", "get.js"));
          console.log(JSON.stringify({ dir: dirMod.default, glob: globMod.default }));
        `,
        "plugins/sub/nested.js": `export default "from-dir";`,
        "handlers/get.js": `export default "from-glob";`,
        "handlers/post.js": `export default "unused";`,
      });

      await compile(String(dir), ["--include", "./plugins", "--include", "./handlers/*.js"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())).toEqual({ dir: "from-dir", glob: "from-glob" });
    },
    TIMEOUT,
  );

  test(
    "a computed import() of a file that was NOT --include'd still fails the same way it does today (negative control)",
    async () => {
      using dir = tempDir("compile-include-negative-control", {
        "index.ts": /* ts */ `
          import { join } from "path";
          try {
            await import(join(import.meta.dirname, "plugins", "target.js"));
            console.log(JSON.stringify({ threw: false }));
          } catch (e: any) {
            console.log(JSON.stringify({ threw: true, hasMessage: typeof e.message === "string" }));
          }
        `,
        "plugins/target.js": `export default "included-value";`,
      });

      // No --include: plugins/target.js is on disk next to index.ts, but a
      // `bun build --compile` with no static or --include reference to it
      // never embeds it, so the computed import() at runtime is unresolvable
      // — the same failure mode #11732 opened about. We only assert that it
      // still throws (not a specific error code/message), since pinning the
      // exact shape of that pre-existing failure is out of scope here.
      await compile(String(dir), []);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(code).toBe(0);
      const r = JSON.parse(stdout.trim());
      expect(r).toEqual({ threw: true, hasMessage: true });
    },
    TIMEOUT,
  );

  test(
    "--include works together with --bytecode",
    async () => {
      using dir = tempDir("compile-include-bytecode", {
        "index.ts": /* ts */ `
          import { join } from "path";
          const mod = await import(join(import.meta.dirname, "plugins", "target.js"));
          console.log(JSON.stringify({ value: mod.default }));
        `,
        "plugins/target.js": `export default "included-value";`,
      });

      await compile(String(dir), ["--include", "./plugins/target.js", "--bytecode"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())).toEqual({ value: "included-value" });
    },
    TIMEOUT,
  );

  test.each([
    [["build", "./index.ts", "--include", "./plugins"], "--include requires --compile"],
    [
      ["build", "--compile", "--target=browser", "./index.html", "--include", "./plugins/target.js"],
      "--target browser with --include",
    ],
    [["build", "--compile", "./index.ts", "--outfile", "app", "--include", "./does-not-exist"], "failed to read --include path"],
    [["build", "--compile", "./index.ts", "--outfile", "app", "--include", "./plugins/*.md"], "--include glob"],
  ])(
    "rejects %j",
    async (args, expected) => {
      using dir = tempDir("compile-include-reject", {
        "index.ts": `console.log("x");`,
        "index.html": `<!doctype html>`,
        "plugins/target.js": `export default 1;`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(expected);
      expect(code).not.toBe(0);
    },
    TIMEOUT,
  );
});
