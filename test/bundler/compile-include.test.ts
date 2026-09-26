// https://github.com/oven-sh/bun/issues/11732
//
// `--include <path|glob>` / `Bun.build({ compile: { include } })` embed extra files in a
// `--compile` executable as lazily loaded MODULES (transpiled, resolvable by a computed
// `import()`), distinct from `--asset` (raw bytes, read via `fs`/`Bun.file`, tested in
// compile-asset-bunfs.test.ts). See docs/bundler/executables.mdx.
import { describe, expect, test } from "bun:test";
import { readdirSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `bun build --compile` copies + rewrites the whole bun binary (~1GB under
// debug+ASAN), which blows the 5s default.
const TIMEOUT = 60_000;
const exe = process.platform === "win32" ? ".exe" : "";

type Via = "cli" | "api";
const vias: Via[] = ["cli", "api"];

async function spawnCapture(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Builds ./index.ts into ./app through the CLI flag or through Bun.build. Returns the
// failure text (empty on success) so rejection tests and success tests share one path.
async function build(dir: string, via: Via, include: string[], opts: { bytecode?: boolean } = {}) {
  if (via === "cli") {
    const args = include.map(p => `--include=${p}`);
    if (opts.bytecode) args.push("--bytecode");
    const { stderr, exitCode } = await spawnCapture(
      [bunExe(), "build", "--compile", "./index.ts", "--outfile", "app", ...args],
      dir,
    );
    return { failed: exitCode !== 0, message: stderr };
  }
  const script = /* js */ `
    try {
      const r = await Bun.build({
        entrypoints: ["./index.ts"],
        bytecode: ${!!opts.bytecode},
        compile: { outfile: "app", include: ${JSON.stringify(include)} },
      });
      console.log(JSON.stringify({ failed: !r.success, message: r.logs.map(String).join("\\n") }));
    } catch (e) {
      console.log(JSON.stringify({ failed: true, message: String(e?.message ?? e) + (e?.errors ?? []).map(String).join("\\n") }));
    }
  `;
  const { stdout } = await spawnCapture([bunExe(), "-e", script], dir);
  return JSON.parse(stdout.trim());
}

async function run(dir: string) {
  // Delete every source file: an included module must resolve from the executable,
  // never from the build directory (bytecode builds record it as import.meta.dirname).
  for (const name of readdirSync(dir)) {
    if (name !== "app" + exe) rmSync(join(dir, name), { recursive: true, force: true });
  }
  // cwd outside the build dir so the binary cannot accidentally find real files on disk
  // (that gap is #44053 — an --external/bare-specifier resolution issue, not this feature;
  // an --include'd module must resolve purely from $bunfs).
  return spawnCapture(
    [join(dir, "app" + exe)],
    process.platform === "win32" ? process.env.TEMP || "C:\\Windows\\Temp" : "/tmp",
  );
}

describe.concurrent("compile include", () => {
  describe.each(vias)("via %s", via => {
    test(
      "a computed import() of an included directory resolves from $bunfs, and its module does not run at startup",
      async () => {
        using dir = tempDir(`compile-include-basic-${via}`, {
          "index.ts": /* ts */ `
            import { join } from "path";
            const name = "target";
            // Built from a runtime string, so the bundler cannot follow it statically.
            const mod = await import(join(import.meta.dirname, "plugins", name + ".js"));
            console.log(JSON.stringify({ value: mod.default, sawMarker: globalThis.__marker === true }));
          `,
          "plugins/target.js": /* js */ `
            globalThis.__marker = true;
            export default "included-value";
          `,
        });

        const built = await build(String(dir), via, ["./plugins"]);
        expect(built).toEqual({ failed: false, message: expect.any(String) });
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr.trim()).toBe("");
        // The marker is observed after import() evaluated the module, so it only proves
        // the module ran; "not at startup" is the next test.
        expect(JSON.parse(stdout.trim())).toEqual({ value: "included-value", sawMarker: true });
        expect(exitCode).toBe(0);
      },
      TIMEOUT,
    );

    test(
      "an included module is not executed unless something imports it",
      async () => {
        using dir = tempDir(`compile-include-not-eager-${via}`, {
          "index.ts": /* ts */ `
            import { join } from "path";
            // Nothing above this line imports plugins/*.
            const before = globalThis.__marker === true;
            await import(join(import.meta.dirname, "plugins", "target.js"));
            console.log(JSON.stringify({ before, after: globalThis.__marker === true }));
          `,
          "plugins/target.js": `globalThis.__marker = true; export default 1;`,
          "plugins/other.js": `throw new Error("other.js must not run");`,
        });

        expect((await build(String(dir), via, ["./plugins/*.js"])).failed).toBe(false);
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr.trim()).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({ before: false, after: true });
        expect(exitCode).toBe(0);
      },
      TIMEOUT,
    );

    test(
      "directories include recursively and a glob matches only its own files",
      async () => {
        using dir = tempDir(`compile-include-dir-glob-${via}`, {
          "index.ts": /* ts */ `
            import { join } from "path";
            const results: Record<string, string> = {};
            for (const rel of ["plugins/sub/nested.js", "handlers/get.js", "handlers/post.md.js", "handlers/deep/x.js"]) {
              try {
                results[rel] = (await import(join(import.meta.dirname, rel))).default;
              } catch {
                results[rel] = "missing";
              }
            }
            console.log(JSON.stringify(results));
          `,
          "plugins/sub/nested.js": `export default "from-dir";`,
          "handlers/get.js": `export default "from-glob";`,
          "handlers/post.md.js": `export default "from-glob-too";`,
          "handlers/deep/x.js": `export default "not-matched";`,
        });

        expect((await build(String(dir), via, ["./plugins", "./handlers/*.js"])).failed).toBe(false);
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr.trim()).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          "plugins/sub/nested.js": "from-dir",
          "handlers/get.js": "from-glob",
          "handlers/post.md.js": "from-glob-too",
          "handlers/deep/x.js": "missing",
        });
        expect(exitCode).toBe(0);
      },
      TIMEOUT,
    );

    test(
      "a glob walks from its literal directory prefix and needs no leading ./",
      async () => {
        using dir = tempDir(`compile-include-glob-prefix-${via}`, {
          "index.ts": /* ts */ `
            import { join } from "path";
            const results: Record<string, string> = {};
            for (const rel of ["a/b/x.js", "a/b/c/y.js", "a/z.js", "other/w.js"]) {
              try {
                results[rel] = (await import(join(import.meta.dirname, rel))).default;
              } catch {
                results[rel] = "missing";
              }
            }
            console.log(JSON.stringify(results));
          `,
          "a/b/x.js": `export default "x";`,
          "a/b/c/y.js": `export default "y";`,
          "a/z.js": `export default "z";`,
          "other/w.js": `export default "w";`,
        });

        expect((await build(String(dir), via, ["a/b/*.js"])).failed).toBe(false);
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr.trim()).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          "a/b/x.js": "x",
          "a/b/c/y.js": "missing",
          "a/z.js": "missing",
          "other/w.js": "missing",
        });
        expect(exitCode).toBe(0);
      },
      TIMEOUT,
    );

    test(
      "a computed import() of a file outside the include set still fails (negative control)",
      async () => {
        using dir = tempDir(`compile-include-negative-${via}`, {
          "index.ts": /* ts */ `
            import { join } from "path";
            try {
              await import(join(import.meta.dirname, "plugins", "target.js"));
              console.log(JSON.stringify({ threw: false }));
            } catch (e: any) {
              const kept = (await import(join(import.meta.dirname, "other", "keep.js"))).default;
              console.log(JSON.stringify({ threw: true, hasMessage: typeof e.message === "string", kept }));
            }
          `,
          "plugins/target.js": `export default "not-included";`,
          "other/keep.js": `export default "included";`,
        });

        expect((await build(String(dir), via, ["./other"])).failed).toBe(false);
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr.trim()).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({ threw: true, hasMessage: true, kept: "included" });
        expect(exitCode).toBe(0);
      },
      TIMEOUT,
    );

    test(
      "include works together with bytecode",
      async () => {
        using dir = tempDir(`compile-include-bytecode-${via}`, {
          "index.ts": /* ts */ `
            // bytecode emits CJS: no top-level await, and import.meta.dirname is the
            // build directory, so resolve relative to the module instead.
            async function main() {
              const name = "target";
              const mod = await import("./plugins/" + name + ".js");
              console.log(JSON.stringify({ value: mod.default }));
            }
            main();
          `,
          "plugins/target.js": `export default "included-value";`,
        });

        expect((await build(String(dir), via, ["./plugins"], { bytecode: true })).failed).toBe(false);
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stderr.trim()).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({ value: "included-value" });
        expect(exitCode).toBe(0);
      },
      TIMEOUT,
    );

    test.each([
      ["./does-not-exist", "failed to read --include path"],
      ["./plugins/*.md", "matched no files"],
    ])(
      "rejects %s",
      async (pattern, expected) => {
        using dir = tempDir(`compile-include-reject-${via}`, {
          "index.ts": `console.log("x");`,
          "plugins/target.js": `export default 1;`,
        });
        const built = await build(String(dir), via, [pattern]);
        expect(built.message).toContain(expected);
        expect(built.failed).toBe(true);
      },
      TIMEOUT,
    );
  });

  test(
    "the CLI rejects --include without --compile",
    async () => {
      using dir = tempDir("compile-include-no-compile", {
        "index.ts": `console.log("x");`,
        "plugins/target.js": `export default 1;`,
      });
      const { stderr, exitCode } = await spawnCapture(
        [bunExe(), "build", "./index.ts", "--include", "./plugins"],
        String(dir),
      );
      expect(stderr).toContain("--include requires --compile");
      expect(exitCode).not.toBe(0);
    },
    TIMEOUT,
  );

  test(
    "the CLI rejects --include with --compile --target=browser",
    async () => {
      using dir = tempDir("compile-include-browser-cli", {
        "index.html": `<!doctype html>`,
        "plugins/target.js": `export default 1;`,
      });
      const { stderr, exitCode } = await spawnCapture(
        [bunExe(), "build", "--compile", "--target=browser", "./index.html", "--include", "./plugins/target.js"],
        String(dir),
      );
      expect(stderr).toContain("cannot use --compile --target browser with --include");
      expect(exitCode).not.toBe(0);
    },
    TIMEOUT,
  );

  test(
    "Bun.build rejects compile.include with target 'browser' for standalone HTML",
    async () => {
      using dir = tempDir("compile-include-browser-api", {
        "index.html": `<!doctype html>`,
        "plugins/target.js": `export default 1;`,
      });
      const script = /* js */ `
        try {
          await Bun.build({ entrypoints: ["./index.html"], target: "browser", compile: { include: ["./plugins"] } });
          console.log("no error");
        } catch (e) { console.log(String(e.message)); }
      `;
      const { stdout } = await spawnCapture([bunExe(), "-e", script], String(dir));
      expect(stdout.trim()).toContain("Cannot use compile.include with target 'browser'");
    },
    TIMEOUT,
  );
});
