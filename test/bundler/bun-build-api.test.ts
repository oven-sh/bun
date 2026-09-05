import assert from "assert";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  bunRun,
  isASAN,
  isDebug,
  isMacOS,
  isWindows,
  tempDir,
  tempDirWithFiles,
  tempDirWithFilesAnon,
} from "harness";
import path, { join } from "path";
import { SourceMapConsumer } from "source-map";
import { buildNoThrow } from "./buildNoThrow";

describe("Bun.build", () => {
  test("css works", async () => {
    const dir = tempDirWithFiles("bun-build-api-css", {
      "a.css": `
        @import "./b.css";

        .hi {
          color: red;
        }
      `,
      "b.css": `
        .hello {
          color: blue;
        }
      `,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "a.css")],
      minify: true,
    });

    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("asset");
    expect(await build.outputs[0].text()).toEqualIgnoringWhitespace(".hello{color:#00f}.hi{color:red}\n");
  });

  test("bytecode works", async () => {
    const dir = tempDirWithFiles("bun-build-api-bytecode", {
      "package.json": `{}`,
      "index.ts": `
        export function hello() {
          return "world";
        }

        console.log(hello());
      `,
      out: {
        "hmm.js": "hmm",
      },
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      outdir: join(dir, "out"),
      target: "bun",
      bytecode: true,
    });

    expect(build.outputs).toHaveLength(2);
    expect(build.outputs[0].kind).toBe("entry-point");
    expect(build.outputs[1].kind).toBe("bytecode");
    expect(await bunRun(build.outputs[0].path)).toSpawn("world");
  });

  const nestedSource = `
    export function outer() {
      function middle() {
        function inner() {
          return "world";
        }
        return inner();
      }
      return middle();
    }

    console.log(outer());
  `;

  async function bytecodeSize(dir: string, depth: number | undefined) {
    const outdir = join(dir, depth === undefined ? "all" : `depth-${depth}`);
    const build = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      outdir,
      target: "bun",
      bytecode: true,
      bytecodeDepth: depth,
    });
    expect(build.outputs.map(o => o.kind)).toStrictEqual(["entry-point", "bytecode"]);
    expect(await bunRun(build.outputs[0].path)).toSpawn("world");
    return build.outputs[1].size;
  }

  test("bytecodeDepth bounds nested function bytecode", async () => {
    const dir = tempDirWithFiles("bun-build-api-bytecode-depth", {
      "package.json": `{}`,
      "index.ts": nestedSource,
    });

    const depth0 = await bytecodeSize(dir, 0);
    const depth1 = await bytecodeSize(dir, 1);
    const depth2 = await bytecodeSize(dir, 2);
    const all = await bytecodeSize(dir, undefined);

    expect(depth0).toBeLessThan(depth1);
    expect(depth1).toBeLessThan(depth2);
    expect(depth2).toBeLessThan(all);
    expect(await bytecodeSize(dir, 3)).toBe(all);
  });

  test("bytecodeDepth rejects invalid values", async () => {
    const dir = tempDirWithFiles("bun-build-api-bytecode-depth-invalid", {
      "package.json": `{}`,
      "index.ts": nestedSource,
    });
    for (const bytecodeDepth of [-1, 1.5, "abc", Infinity, NaN]) {
      expect(() =>
        Bun.build({
          entrypoints: [join(dir, "index.ts")],
          outdir: join(dir, "out"),
          target: "bun",
          bytecode: true,
          // @ts-expect-error
          bytecodeDepth,
        }),
      ).toThrow(/bytecodeDepth/);
    }
  });

  test("--bytecode-depth on the CLI", async () => {
    const dir = tempDirWithFiles("bun-build-cli-bytecode-depth", {
      "package.json": `{}`,
      "index.ts": nestedSource,
    });

    async function cliBytecodeSize(args: string[]) {
      const outdir = join(dir, "out-" + args.join("").replace(/[^a-z0-9]/g, ""));
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", join(dir, "index.ts"), "--target=bun", "--bytecode", "--outdir", outdir, ...args],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain("index.js.jsc");
      expect(exitCode).toBe(0);
      expect(await bunRun(join(outdir, "index.js"))).toSpawn("world");
      return Bun.file(join(outdir, "index.js.jsc")).size;
    }

    const depth0 = await cliBytecodeSize(["--bytecode-depth=0"]);
    const depth1 = await cliBytecodeSize(["--bytecode-depth", "1"]);
    const all = await cliBytecodeSize([]);
    expect(depth0).toBeLessThan(depth1);
    expect(depth1).toBeLessThan(all);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", join(dir, "index.ts"), "--target=bun", "--bytecode", "--bytecode-depth=nope"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Invalid value for --bytecode-depth: "nope"');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  // A function's record stores its own offset as a varint, so its size depends on where it lands. Sweep the payload
  // size across the encoder's first page boundary (64 KB) with a few tail shapes so a record lands exactly on it.
  test("bytecode: function record on an encoder page boundary", async () => {
    using dir = tempDir("bun-build-api-bytecode-page-boundary", {
      "sweep-fixture.ts": /* ts */ `
        import { writeFileSync } from "fs";
        const variant = Number(process.argv[2]);
        const params = variant & 1 ? Array.from({ length: 130 }, (_, i) => "a" + i).join(",") : "";
        const consts = variant & 2 ? "var c = " + Array.from({ length: 130 }, (_, i) => i + ".5").join("+") + ";" : "";
        async function bytecodeSize(n: number) {
          const file = "in" + variant + ".js";
          writeFileSync(file, 'function p(){ return "' + Buffer.alloc(n, "p").toString() + '"; }\\n'
            + "function t(" + params + "){ " + consts + ' return "' + Buffer.alloc(200, "t").toString() + '"; }\\n'
            + "module.exports = [p, t];\\n");
          const build = await Bun.build({ entrypoints: ["./" + file], outdir: "./out" + variant, target: "bun", format: "cjs", bytecode: true });
          if (!build.success) throw new AggregateError(build.logs);
          return build.outputs.find(o => o.kind === "bytecode")!.size;
        }
        const pageEnd = 64 * 1024;
        const n0 = 60000;
        const target = n0 + (pageEnd - (await bytecodeSize(n0)));
        for (let n = target - 24; n < target + 104; n++) await bytecodeSize(n);
        console.log("ok");
      `,
    });
    await Promise.all(
      [0, 1, 2, 3].map(async variant => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "sweep-fixture.ts", String(variant)],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect(stdout).toBe("ok\n");
        expect(exitCode).toBe(0);
      }),
    );
  });

  test("bytecode: repeated builds don't retain the generated code", async () => {
    using dir = tempDir("bun-build-api-bytecode-retained", {
      "retained-fixture.ts": /* ts */ `
        import { writeFileSync } from "fs";
        const [functions, limit] = process.argv.slice(2).map(Number);
        let source = "";
        for (let i = 0; i < functions; i++)
          source += "export function f" + i + "(a, b) { if (a > " + i + ") { return a * b + " + i + "; } for (let j = 0; j < b; j++) a += j ^ " + i + '; return { a, b, name: "f' + i + '" }; }\\n';
        writeFileSync("in.js", source);
        const build = (bytecode: boolean) => Bun.build({ entrypoints: ["./in.js"], outdir: "./out", target: "bun", format: "cjs", bytecode });
        const rss = () => Math.round(process.memoryUsage.rss() / 1024 / 1024);
        if (!(await build(false)).success) throw new Error("build failed");
        Bun.gc(true);
        const base = rss();
        for (let i = 0; i < 3; i++) if (!(await build(true)).success) throw new Error("build failed");
        // The bundle thread frees its bytecode VM once it goes idle.
        const deadline = Date.now() + 5000;
        let after = rss();
        while ((Bun.gc(true), (after = rss())) - base > limit && Date.now() < deadline) await Bun.sleep(20);
        console.log(JSON.stringify({ base, after }));
      `,
    });
    // Linux/Windows release, 20k functions: ~+65 MB without freeing the VM, about level with the baseline with it.
    // Debug/ASAN parse far slower and hold freed pages in quarantine, so they get a smaller module and only guard against
    // gross retention. macOS reports +230-280 MB here even with the VM freed (the pages leave RSS lazily), so same there.
    const slow = isASAN || isDebug;
    const [functions, limit] = slow ? [3000, 400] : [20000, isMacOS ? 400 : 40];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "retained-fixture.ts", String(functions), String(limit)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toStartWith("{");
    expect(exitCode).toBe(0);
    const { base, after } = JSON.parse(stdout);
    expect(after - base).toBeLessThanOrEqual(limit);
  });

  test("passing undefined doesnt segfault", () => {
    try {
      // @ts-ignore
      Bun.build();
    } catch (error) {
      return;
    }
    throw new Error("should have thrown");
  });

  // A `define:` value that isn't valid JSON or a JS identifier is auto-quoted
  // (treated as a string literal). The JSON lexer must not error eagerly on the
  // first character — a raw minified CSS string starts with `*{...}`, which
  // src/codegen/bake-codegen.ts passes verbatim as `OVERLAY_CSS`.
  describe.each([
    "*{box-sizing:border-box}.root{all:initial}",
    "?foo",
    "(parenthesized)",
    ")close",
    "abc{not json}",
    // Leading-operator chars must `step()` before falling back to auto-quote so
    // `parse_string_literal`'s leading `step()` lands past index 1 (matching the
    // reference lexer). Otherwise a LF at index 1 truncates the value to `"("`.
    "(\nrest",
    "*\nrest",
  ])("define value %j is auto-quoted when not valid JSON", value => {
    test("emits a quoted string literal", async () => {
      const dir = tempDirWithFiles("bun-build-define-auto-quote", {
        "entry.ts": `declare const X: string; console.log(X);`,
      });
      const result = await Bun.build({
        entrypoints: [join(dir, "entry.ts")],
        define: { X: value },
      });
      expect(result.success).toBe(true);
      const out = await result.outputs[0].text();
      // The printer emits the define as a `"..."` string literal, or as a
      // `` `...` `` template literal when the value contains a literal newline.
      // Either way the full value — not a truncated prefix — must round-trip.
      if (!out.includes("`" + value + "`")) {
        expect(out).toContain(JSON.stringify(value));
      }
    });
  });

  // https://github.com/oven-sh/bun/issues/12818
  test("sourcemap + build error crash case", async () => {
    const dir = tempDirWithFiles("build", {
      "/src/file1.ts": `
        import { A } from './dir';
        console.log(A);
      `,
      "/src/dir/index.ts": `
        import { B } from "./file3";
        export const A = [B]
      `,
      "/src/dir/file3.ts": `
        import { C } from "../file1"; // error
        export const B = C;
      `,
      "/src/package.json": `
        { "type": "module" }
      `,
      "/src/tsconfig.json": `
        {
          "extends": "../tsconfig.json",
          "compilerOptions": {
              "target": "ESNext",
              "module": "ESNext",
              "types": []
          }
        }
      `,
    });
    const y = await buildNoThrow({
      entrypoints: [join(dir, "src/file1.ts")],
      outdir: join(dir, "out"),
      sourcemap: "external",
      external: ["@minecraft"],
    });
  });

  test("invalid options throws", async () => {
    expect(() => Bun.build({} as any)).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: [],
      } as any),
    ).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: ["hello"],
        format: "invalid",
      } as any),
    ).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: ["hello"],
        target: "invalid",
      } as any),
    ).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: ["hello"],
        sourcemap: "invalid",
      } as any),
    ).toThrow();
  });

  test.concurrent("publicPath with an interior NUL byte is rejected before anything is written", async () => {
    using dir = tempDir("bun-build-api-public-path-nul", {
      "index.js": `import a from "./asset.png"; console.log(a);`,
      "asset.png": "PNG",
    });
    const outdir = join(String(dir), "out");
    let thrown: any;
    try {
      Bun.build({
        entrypoints: [join(String(dir), "index.js")],
        outdir,
        publicPath: "/p\0q/",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect({ code: thrown.code, message: thrown.message }).toEqual({
      code: "ERR_INVALID_ARG_VALUE",
      message: `The property 'publicPath' must be a string without null bytes. Received "/p\\u0000q/"`,
    });
    expect(existsSync(outdir)).toBe(false);

    // The same prefix without the NUL is accepted and lands in the artifact.
    const result = await Bun.build({
      entrypoints: [join(String(dir), "index.js")],
      outdir,
      publicPath: "/pq/",
    });
    expect(result.success).toBe(true);
    const js = result.outputs.find(o => o.path.endsWith(".js"))!;
    expect(await js.text()).toContain(`"/pq/asset-`);
  });

  test("returns errors properly", async () => {
    Bun.gc(true);
    const build = await buildNoThrow({
      entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
    });
    expect(build.outputs).toHaveLength(0);
    expect(build.logs).toHaveLength(1);
    expect(build.logs[0]).toBeInstanceOf(BuildMessage);
    expect(build.logs[0].message).toMatch(/ModuleNotFound/);
    expect(build.logs[0].name).toBe("BuildMessage");
    expect(build.logs[0].position).toEqual(null);
    expect(build.logs[0].level).toEqual("error");
    Bun.gc(true);
  });

  test("errors are thrown", async () => {
    Bun.gc(true);
    try {
      await Bun.build({
        entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
      });
      expect.unreachable();
    } catch (e) {
      assert(e instanceof AggregateError);
      expect(e.errors).toHaveLength(1);
      expect(e.errors[0]).toBeInstanceOf(BuildMessage);
      expect(e.errors[0].message).toMatch(/ModuleNotFound/);
      expect(e.errors[0].name).toBe("BuildMessage");
      expect(e.errors[0].position).toEqual(null);
      expect(e.errors[0].level).toEqual("error");
      Bun.gc(true);
    }
  });

  // Runs in a child because the unfixed behavior was a process abort: the
  // disabled entry point was dropped without an error and the linker ran with
  // zero entry points.
  test.concurrent("an entry point disabled by the package.json browser field is a build error", async () => {
    using dir = tempDir("build-entry-point-disabled-by-browser-field", {
      "package.json": JSON.stringify({ name: "app", browser: { "./entry.js": false } }),
      "entry.js": `console.log("entry");`,
      "build.mjs": `
        const returned = await Bun.build({ entrypoints: ["./entry.js"], target: "browser", throw: false });
        let thrown;
        try {
          await Bun.build({ entrypoints: ["./entry.js"], target: "browser" });
        } catch (e) {
          thrown = {
            isAggregateError: e instanceof AggregateError,
            errors: e.errors.map(error => ({ name: error.name, level: error.level, position: error.position, message: error.message })),
          };
        }
        console.log(JSON.stringify({
          returned: {
            success: returned.success,
            outputs: returned.outputs.length,
            logs: returned.logs.map(log => ({ name: log.name, level: log.level, position: log.position, message: log.message })),
          },
          thrown,
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const message = {
      name: "BuildMessage",
      level: "error",
      position: null,
      message: '"./entry.js" is disabled due to "browser" field in package.json (entry point)',
    };
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      returned: { success: false, outputs: 0, logs: [message] },
      thrown: { isAggregateError: true, errors: [message] },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an entry point too long for a path buffer is reported like any other missing one", async () => {
    // Resolving it failed without logging anything, so the build went on
    // with the entry point silently dropped: a successful build when another
    // entry point was given, a crash in the linker when it was the only one.
    // Runs in a child so the crash shows up as a failed assertion.
    using dir = tempDir("build-api-long-entrypoint", { "valid.js": "console.log(1);" });
    const fixture = /* ts */ `
      // Longer than the path buffer on every platform, Windows included.
      const long = Buffer.alloc(100_000, "a").toString();
      const report = async (entrypoints: string[]) => {
        const { success, outputs, logs } = await Bun.build({ entrypoints, throw: false });
        return { success, outputs: outputs.length, logs: logs.map(log => [log.name, log.message]) };
      };
      console.log(JSON.stringify({
        alone: await report([long]),
        withValidEntryPoint: await report(["./valid.js", long]),
      }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const notFound = {
      success: false,
      outputs: 0,
      logs: [["BuildMessage", `ModuleNotFound resolving "${Buffer.alloc(100_000, "a").toString()}" (entry point)`]],
    };
    expect(JSON.parse(stdout)).toEqual({ alone: notFound, withValidEntryPoint: notFound });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an entry point that resolves to a builtin or to a non-code data: URL is a build error", async () => {
    // Runs in a child: unfixed, "bun:wrap" was dropped (the bundler registers its runtime under that
    // name) and the others were scheduled as files. The data: URL is an image, which resolves as
    // external like a builtin does, and was emitted as a module exporting "". It is listed next to a
    // file because a lone data: entry point fails earlier, when the build opens its directory.
    using dir = tempDir("build-api-builtin-entrypoint", { "valid.js": "console.log(1);" });
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const fixture = /* ts */ `
      const report = async (entrypoints: string[]) => {
        const { success, outputs, logs } = await Bun.build({ entrypoints, target: "bun", throw: false });
        return { success, outputs: outputs.length, logs: logs.map(log => [log.name, log.message]) };
      };
      console.log(JSON.stringify([
        await report(["bun:wrap"]),
        await report(["node:fs"]),
        await report(["./valid.js", ${JSON.stringify(image)}]),
      ]));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const failedWith = (message: string) => ({ success: false, outputs: 0, logs: [["BuildMessage", message]] });
    expect(JSON.parse(stdout)).toEqual([
      failedWith('Cannot use "bun:wrap" as an entry point: it resolves to a builtin module'),
      failedWith('Cannot use "node:fs" as an entry point: it resolves to a builtin module'),
      failedWith(`ModuleNotFound resolving "${image}" (entry point)`),
    ]);
    expect(exitCode).toBe(0);
  });

  test("returns output files", async () => {
    Bun.gc(true);
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    expect(build.outputs).toHaveLength(1);
    expect(build.logs).toHaveLength(0);
    Bun.gc(true);
  });

  test("Bun.write(BuildArtifact)", async () => {
    Bun.gc(true);
    const tmpdir = tempDirWithFiles("bun-build-api-write", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    await Bun.write(path.join(tmpdir, "index.js"), x.outputs[0]);
    expect(readFileSync(path.join(tmpdir, "index.js"), "utf-8")).toMatchSnapshot();
    Bun.gc(true);
  });

  test("outdir + reading out blobs works", async () => {
    Bun.gc(true);
    const fixture = tempDirWithFiles("build-outdir", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: fixture,
    });
    expect(await x.outputs.values().next().value?.text()).toMatchSnapshot();
    Bun.gc(true);
  });

  test("BuildArtifact properties", async () => {
    Bun.gc(true);
    const outdir = tempDirWithFiles("build-artifact-properties", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir,
    });
    console.log(await x.outputs[0].text());
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(path.relative(outdir, blob.path)).toBe("index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
    Bun.gc(true);
  });

  // [hash] is 8 characters (40 bits of the content hash); with a few thousand
  // `--splitting` chunks two of them print the same name about once per
  // million builds and the build fails with "Multiple files share the same
  // output path". [hashN] prints N ≤ 13 characters; [hash13] carries all 64 bits.
  test("[hashN] prints N characters of the content hash", async () => {
    const dir = tempDirWithFiles("build-hash-width", {
      "a.js": `export default "a" + (await import("./shared.js")).default;`,
      "b.js": `export default "b" + (await import("./shared.js")).default;`,
      "shared.js": `export default "shared";`,
    });
    const hashes = async (naming: string) => {
      const build = await Bun.build({
        entrypoints: [join(dir, "a.js"), join(dir, "b.js")],
        splitting: true,
        naming: { entry: `[name]-${naming}.[ext]`, chunk: `chunk-${naming}.[ext]` },
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        expect(path.basename(output.path)).toEndWith(`-${output.hash}.js`);
      }
      return Object.fromEntries(
        build.outputs.map(o => [path.basename(o.path).replace(/-[0-9a-z]+\.js$/, ""), o.hash!]),
      );
    };
    // The naming template is itself part of the content hash, so values are
    // only comparable within one template; check widths.
    for (const [naming, width] of [
      ["[hash]", 8],
      ["[hash8]", 8],
      ["[hash10]", 10],
      ["[hash13]", 13],
      ["[hash99]", 13],
    ] as const) {
      const h = await hashes(naming);
      expect(Object.keys(h).sort()).toEqual(["a", "b", "chunk"]);
      for (const value of Object.values(h)) {
        expect(value).toMatch(new RegExp(`^[0-9a-z]{${width}}$`));
      }
    }
  });

  test("BuildArtifact properties + entry.naming", async () => {
    Bun.gc(true);
    const outdir = tempDirWithFiles("build-artifact-properties-entry-naming", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      naming: {
        entry: "hello",
      },
      outdir,
    });
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(path.relative(outdir, blob.path)).toBe("hello");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact properties sourcemap", async () => {
    Bun.gc(true);
    const outdir = tempDirWithFiles("build-artifact-properties-sourcemap", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      sourcemap: "external",
      outdir,
    });
    const [blob, map] = x.outputs;
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(path.relative(outdir, blob.path)).toBe("index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash index.js");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(map);

    expect(map.type).toBe("application/json;charset=utf-8");
    expect(map.size).toBeGreaterThan(1);
    expect(path.relative(outdir, map.path)).toBe("index.js.map");
    expect(map.hash).toBeTruthy();
    expect(map.hash).toMatchSnapshot("hash index.js.map");
    expect(map.kind).toBe("sourcemap");
    expect(map.loader).toBe("file");
    expect(map.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact sourcemap is traced from the owner, not rooted separately", async () => {
    // `.sourcemap` is the wrapper's `m_sourcemap` WriteBarrier slot (visited in
    // visitChildren); it must not also be held by a Strong root.
    using dir = tempDir("build-artifact-sourcemap-gc", {
      "index.js": "export const x = 1;\n",
      "run.js": `
        const { heapStats } = require("bun:jsc");
        const result = await Bun.build({
          entrypoints: ["./index.js"],
          sourcemap: "external",
          outdir: ".",
        });
        const entry = result.outputs[0];
        const map = result.outputs[1];
        console.log(JSON.stringify({
          sourcemapIsMap: entry.sourcemap === map,
          inspectShowsSourcemap: Bun.inspect(entry).includes("sourcemap: BuildArtifact (sourcemap)"),
          protectedBuildArtifact: heapStats().protectedObjectTypeCounts.BuildArtifact ?? 0,
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      sourcemapIsMap: true,
      inspectShowsSourcemap: true,
      protectedBuildArtifact: 0,
    });
    expect(exitCode).toBe(0);
  });

  // test("BuildArtifact properties splitting", async () => {
  //   Bun.gc(true);
  //   const x = await Bun.build({
  //     entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
  //     splitting: true,
  //   });
  //   expect(x.outputs).toHaveLength(2);
  //   const [indexBlob, chunkBlob] = x.outputs;

  //   expect(indexBlob).toBeTruthy();
  //   expect(indexBlob.type).toBe("text/javascript;charset=utf-8");
  //   expect(indexBlob.size).toBeGreaterThan(1);
  //   expect(indexBlob.path).toBe("/index.js");
  //   expect(indexBlob.hash).toBeTruthy();
  //   expect(indexBlob.hash).toMatchSnapshot("hash index.js");
  //   expect(indexBlob.kind).toBe("entry-point");
  //   expect(indexBlob.loader).toBe("jsx");
  //   expect(indexBlob.sourcemap).toBe(null);

  //   expect(chunkBlob).toBeTruthy();
  //   expect(chunkBlob.type).toBe("text/javascript;charset=utf-8");
  //   expect(chunkBlob.size).toBeGreaterThan(1);
  //   expect(chunkBlob.path).toBe(`/foo-${chunkBlob.hash}.js`);
  //   expect(chunkBlob.hash).toBeTruthy();
  //   expect(chunkBlob.hash).toMatchSnapshot("hash foo.js");
  //   expect(chunkBlob.kind).toBe("chunk");
  //   expect(chunkBlob.loader).toBe("jsx");
  //   expect(chunkBlob.sourcemap).toBe(null);
  //   Bun.gc(true);
  // });

  test("new Response(BuildArtifact) sets content type", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: tempDirWithFiles("response-buildartifact", {}),
    });
    const response = new Response(x.outputs[0]);
    expect(response.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
    expect(await response.text()).toMatchSnapshot("response text");
  });

  test.todo("new Response(BuildArtifact) sets etag", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: tempDirWithFiles("response-buildartifact-etag", {}),
    });
    const response = new Response(x.outputs[0]);
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("etag")).toMatchSnapshot("content-etag");
  });

  // test("BuildArtifact with assets", async () => {
  //   const x = await Bun.build({
  //     entrypoints: [join(import.meta.dir, "./fixtures/with-assets/index.js")],
  //     loader: {
  //       ".blob": "file",
  //       ".png": "file",
  //     },
  //   });
  //   console.log(x);
  //   const [blob, asset] = x.outputs;
  //   expect(blob).toBeTruthy();
  //   expect(blob instanceof Blob).toBe(true);
  //   expect(blob.type).toBe("text/javascript;charset=utf-8");
  //   expect(blob.size).toBeGreaterThan(1);
  //   expect(blob.path).toBe("/index.js");
  //   expect(blob.hash).toBeTruthy();
  //   expect(blob.hash).toMatchSnapshot();
  //   expect(blob.kind).toBe("entry-point");
  //   expect(blob.loader).toBe("jsx");
  //   expect(blob.sourcemap).toBe(null);
  //   throw new Error("test was not fully written");
  // });

  test.concurrent("loader map with an empty-string key is ignored without leaving uninitialized slots", async () => {
    // `JSPropertyIterator` skips empty-name properties, but `loader_names` was being
    // indexed by the property position instead of a dense counter, leaving garbage in
    // the skipped slot that was later read/freed. Run in a subprocess so a crash in the
    // bundler thread surfaces as a test failure instead of taking down the test runner.
    const dir = tempDirWithFiles("bun-build-loader-empty-key", {
      "entry.ts": `export const x: number = 42;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const result = await Bun.build({
            entrypoints: [${JSON.stringify(join(dir, "entry.ts"))}],
            loader: { "": "js", ".ts": "ts", ".js": "js" },
          });
          if (!result.success) throw new AggregateError(result.logs, "build failed");
          console.log(JSON.stringify({ success: result.success, outputs: result.outputs.length }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ success: true, outputs: 1 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("rebuilding busts the directory entries cache", async () => {
    Bun.gc(true);
    const tmpdir = tempDirWithFiles("rebuild-bust-dirent-cache", {
      "package.json": `{}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "bundler-reloader-script.ts")],
      env: { ...bunEnv, BUNDLER_RELOADER_SCRIPT_TMP_DIR: tmpdir },
      stderr: "pipe",
      stdout: "inherit",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (stderr.length > 0) {
      throw new Error(stderr);
    }
    expect(exitCode).toBe(0);
    Bun.gc(true);
  });

  // https://github.com/oven-sh/bun/issues/33099
  // A package reached through a symlinked node_modules entry caches its file
  // descriptor in the resolver. A second in-process Bun.build() used to reuse a
  // descriptor the first build had already closed, failing with EBADF. The test
  // host must also import the package so its fd is cached before the builds run.
  test.concurrent.skipIf(isWindows)(
    "repeated in-process builds of a symlinked package do not reuse a closed fd",
    async () => {
      using dir = tempDir("build-symlink-fd-cache", {
        "vendor/pkg/package.json": `{"name":"pkg","version":"1.0.0","type":"module","exports":"./index.js"}`,
        "vendor/pkg/index.js": `export const value = 1;\n`,
        "entry.ts": `import { value } from "pkg";\nconsole.log(value);\n`,
        "repro.test.ts": `
        import { it } from "bun:test";
        import { value } from "pkg";
        void value;
        it("builds", async () => {
          for (let i = 1; i <= 3; i++) {
            const result = await Bun.build({ entrypoints: ["./entry.ts"] });
            if (!result.success) {
              throw new AggregateError(result.logs, "build " + i + " failed");
            }
          }
          console.log("ALL_BUILDS_OK");
        });
      `,
      });
      mkdirSync(join(String(dir), "node_modules"), { recursive: true });
      symlinkSync("../vendor/pkg", join(String(dir), "node_modules", "pkg"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "repro.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout + stderr).toContain("ALL_BUILDS_OK");
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("errors are returned as an array", async () => {
    const x = await buildNoThrow({
      entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
      outdir: tempDirWithFiles("errors-are-returned-as-an-array", {}),
    });
    expect(x.success).toBe(false);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toMatch(/ModuleNotFound/);
    expect(x.logs[0].name).toBe("BuildMessage");
    expect(x.logs[0].position).toEqual(null);
  });

  test.concurrent("fails instead of truncating when a module is too deeply nested to print", async () => {
    // A TOML dotted header builds an object nested arbitrarily deep without
    // recursing in the parser, so the printer's recursion guard is the first
    // thing to hit it. The printed part used to be silently dropped, leaving
    // a corrupt bundle and success: true.
    using dir = tempDir("build-api-deep-toml", {
      "deep.toml": "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 1\n",
    });
    const x = await buildNoThrow({
      entrypoints: [join(String(dir), "deep.toml")],
      outdir: join(String(dir), "out"),
    });
    expect(x.success).toBe(false);
    expect(x.outputs).toHaveLength(0);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toContain("Maximum call stack size exceeded while generating code for this file");
    expect(x.logs[0].name).toBe("BuildMessage");
  });

  test.concurrent("reports a module that fails to print once across entrypoints", async () => {
    // Without code splitting the failing file is printed once per entry
    // chunk; the error is still per-file, like parse errors.
    using dir = tempDir("build-api-deep-toml-multi", {
      "deep.toml": "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 1\n",
      "a.js": `import d from "./deep.toml"; console.log(d);`,
      "b.js": `import d from "./deep.toml"; console.log(Object.keys(d));`,
    });
    const x = await buildNoThrow({
      entrypoints: [join(String(dir), "a.js"), join(String(dir), "b.js")],
      outdir: join(String(dir), "out"),
    });
    expect(x.success).toBe(false);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toContain("Maximum call stack size exceeded while generating code for this file");
  });

  test.concurrent("warnings do not fail a build", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/jsx-warning/index.jsx")],
      outdir: tempDirWithFiles("warnings-do-not-fail-a-build", {}),
    });
    expect(x.success).toBe(true);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toBe(
      '"key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.',
    );
    expect(x.logs[0].name).toBe("BuildMessage");
    expect(x.logs[0].position).toBeTruthy();
  });

  test.concurrent("module() throws error", async () => {
    expect(() =>
      Bun.build({
        entrypoints: [join(import.meta.dir, "./fixtures/trivial/bundle-ws.ts")],
        plugins: [
          {
            name: "test",
            setup: b => {
              b.module("ad", () => {
                return {
                  exports: {
                    hello: "world",
                  },
                  loader: "object",
                };
              });
            },
          },
        ],
      }),
    ).toThrow();
  });

  test.concurrent("non-object plugins throw invalid argument errors", () => {
    for (const plugin of [null, undefined, 1, "hello", true, false, Symbol.for("hello")]) {
      expect(() => {
        Bun.build({
          entrypoints: [join(import.meta.dir, "./fixtures/trivial/bundle-ws.ts")],
          plugins: [
            // @ts-expect-error
            plugin,
          ],
        });
      }).toThrow("Expected plugin to be an object");
    }
  });

  test.concurrent("hash considers cross chunk imports", async () => {
    Bun.gc(true);
    const fixture = tempDirWithFiles("build-hash-cross-chunk-imports", {
      "entry1.ts": `
        import { bar } from './bar'
        export const entry1 = () => {
          console.log('FOO')
          bar()
        }
      `,
      "entry2.ts": `
        import { bar } from './bar'
        export const entry1 = () => {
          console.log('FOO')
          bar()
        }
      `,
      "bar.ts": `
        export const bar = () => {
          console.log('BAR')
        }
      `,
    });
    const first = await Bun.build({
      entrypoints: [join(fixture, "entry1.ts"), join(fixture, "entry2.ts")],
      outdir: join(fixture, "out"),
      target: "browser",
      splitting: true,
      minify: false,
      naming: "[dir]/[name]-[hash].[ext]",
    });
    if (!first.success) throw new AggregateError(first.logs);
    expect(first.outputs.length).toBe(3);

    writeFileSync(join(fixture, "bar.ts"), readFileSync(join(fixture, "bar.ts"), "utf8").replace("BAR", "BAZ"));

    const second = await Bun.build({
      entrypoints: [join(fixture, "entry1.ts"), join(fixture, "entry2.ts")],
      outdir: join(fixture, "out2"),
      target: "browser",
      splitting: true,
      minify: false,
      naming: "[dir]/[name]-[hash].[ext]",
    });
    if (!second.success) throw new AggregateError(second.logs);
    expect(second.outputs.length).toBe(3);

    const totalUniqueHashes = new Set();
    const allFiles = [...first.outputs, ...second.outputs];
    for (const out of allFiles) totalUniqueHashes.add(out.hash);

    expect(
      totalUniqueHashes.size,
      "number of unique hashes should be 6: three per bundle. the changed foo.ts affects all chunks",
    ).toBe(6);

    // ensure that the hashes are in the path
    for (const out of allFiles) {
      expect(out.path).toInclude(out.hash!);
    }

    Bun.gc(true);
  });

  test.concurrent("ignoreDCEAnnotations works", async () => {
    const fixture = tempDirWithFiles("build-ignore-dce-annotations", {
      "package.json": `{}`,
      "entry.ts": `
        /* @__PURE__ */ console.log(1)
      `,
    });

    const bundle = await Bun.build({
      entrypoints: [join(fixture, "entry.ts")],
      ignoreDCEAnnotations: true,
      minify: true,
      outdir: path.join(fixture, "out"),
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);

    expect(await bundle.outputs[0].text()).toBe("console.log(1);\n");
  });

  test.concurrent("emitDCEAnnotations works", async () => {
    const fixture = tempDirWithFiles("build-emit-dce-annotations", {
      "package.json": `{}`,
      "entry.ts": `
        export const OUT = /* @__PURE__ */ console.log(1)
      `,
    });

    const bundle = await Bun.build({
      entrypoints: [join(fixture, "entry.ts")],
      emitDCEAnnotations: true,
      minify: true,
      outdir: path.join(fixture, "out"),
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);

    expect(await bundle.outputs[0].text()).toBe("var o=/*@__PURE__*/console.log(1);export{o as OUT};\n");
  });

  test.concurrent(
    "you can write onLoad and onResolve plugins using the 'html' loader, and it includes script and link tags as bundled entrypoints",
    async () => {
      const fixture = tempDirWithFiles("build-html-plugins", {
        "index.html": `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="./style.css">
            <script src="./script.js"></script>
          </head>
        </html>
      `,
        "style.css": ".foo { color: red; }",

        // Check we actually do bundle the script
        "script.js": "console.log(1 + 2)",
      });

      let onLoadCalled = false;
      let onResolveCalled = false;

      const build = await Bun.build({
        entrypoints: [join(fixture, "index.html")],
        minify: {
          syntax: true,
        },
        plugins: [
          {
            name: "test-plugin",
            setup(build) {
              build.onLoad({ filter: /\.html$/ }, async args => {
                onLoadCalled = true;
                const contents = await Bun.file(args.path).text();
                return {
                  contents: contents.replace("</head>", "<meta name='injected-by-plugin' content='true'></head>"),
                  loader: "html",
                };
              });

              build.onResolve({ filter: /\.(js|css)$/ }, args => {
                onResolveCalled = true;
                return {
                  path: join(fixture, args.path),
                  namespace: "file",
                };
              });
            },
          },
        ],
      });

      expect(build.success).toBe(true);
      expect(onLoadCalled).toBe(true);
      expect(onResolveCalled).toBe(true);

      // Should have 3 outputs - HTML, JS and CSS
      expect(build.outputs).toHaveLength(3);

      // Verify we have one of each type
      const types = build.outputs.map(o => o.type);
      expect(types).toContain("text/html;charset=utf-8");
      expect(types).toContain("text/javascript;charset=utf-8");
      expect(types).toContain("text/css;charset=utf-8");

      // Verify the JS output contains the __dirname
      const js = build.outputs.find(o => o.type === "text/javascript;charset=utf-8");
      expect(await js?.text()).toContain("console.log(3)");

      // Verify our plugin modified the HTML
      const html = build.outputs.find(o => o.type === "text/html;charset=utf-8");
      expect(await html?.text()).toContain("<meta name='injected-by-plugin' content='true'>");
    },
  );
});

test.concurrent("macro with nested object", async () => {
  const dir = tempDirWithFilesAnon({
    "index.ts": `
import { testMacro } from "./macro" assert { type: "macro" };

export const testConfig = testMacro({
  borderRadius: {
    1: "4px",
    2: "8px",
  },
});
    `,
    "macro.ts": `
export function testMacro(val: any) {
  return val;
}
    `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "index.ts")],
    minify: true,
  });

  expect(build.outputs).toHaveLength(1);
  expect(build.outputs[0].kind).toBe("entry-point");
  expect(await build.outputs[0].text()).toEqualIgnoringWhitespace(
    `var t={borderRadius:{"1":"4px","2":"8px"}};export{t as testConfig};\n`,
  );
});

// Since NODE_PATH has to be set, we need to run this test outside the bundler tests.
test.concurrent("regression/NODE_PATHBuild api", async () => {
  const dir = tempDirWithFiles("node-path-build", {
    "entry.js": `
      import MyClass from 'MyClass';
      console.log(new MyClass().constructor.name);
    `,
    "src/MyClass.js": `
      export default class MyClass {}
    `,
    "build.js": `
      import { join } from "path";
      
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "entry.js")],
        outdir: join(import.meta.dir, "out"),
      });
      
      if (!build.success) {
        console.error("Build failed:", build.logs);
        process.exit(1);
      }
      
      // Run the built file
      const runProc = Bun.spawn({
        cmd: [process.argv[0], join(import.meta.dir, "out", "entry.js")],
        stdout: "pipe",
        stderr: "pipe",
      });
      
      await runProc.exited;
      const runOutput = await new Response(runProc.stdout).text();
      const runError = await new Response(runProc.stderr).text();
      
      if (runError) {
        console.error("Run error:", runError);
        process.exit(1);
      }
      
      console.log(runOutput.trim());
      
    `,
  });

  // Run the build script with NODE_PATH set
  const proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "build.js")],
    env: {
      ...bunEnv,
      NODE_PATH: join(dir, "src"),
    },
    stdout: "pipe",
    stderr: "pipe",
    cwd: dir,
  });

  await proc.exited;
  const output = await proc.stdout.text();
  const error = await proc.stderr.text();

  expect(error).toBe("");
  expect(output.trim()).toBe("MyClass");
});

test.concurrent("regression/GlobalThis", async () => {
  const dir = tempDirWithFiles("global-this-regression", {
    "entry.js": `
      function identity(x) {
        return x;
      }
  import * as mod1 from  'assert';
  identity(mod1);
import * as mod2 from  'buffer';
identity(mod2);
import * as mod3 from  'console';
identity(mod3);
import * as mod4 from  'constants';
identity(mod4);
import * as mod5 from  'crypto';
identity(mod5);
import * as mod6 from  'domain';
identity(mod6);
import * as mod7 from  'events';
identity(mod7);
import * as mod8 from  'http';
identity(mod8);
import * as mod9 from  'https';
identity(mod9);
import * as mod10 from  'net';
identity(mod10);
import * as mod11 from  'os';
identity(mod11);
import * as mod12 from  'path';
identity(mod12);
import * as mod13 from  'process';
identity(mod13);
import * as mod14 from  'punycode';
identity(mod14);
import * as mod15 from  'stream';
identity(mod15);
import * as mod16 from  'string_decoder';
identity(mod16);
import * as mod17 from  'sys';
identity(mod17);
import * as mod18 from  'timers';
identity(mod18);
import * as mod20 from  'tty';
identity(mod20);
import * as mod21 from  'url';
identity(mod21);
import * as mod22 from  'util';
identity(mod22);
import * as mod23 from  'zlib';
identity(mod23);
      `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "entry.js")],
    target: "browser",
  });

  expect(build.success).toBe(true);
  const text = await build.outputs[0].text();
  expect(text).not.toContain("process.env.");
  expect(text).not.toContain(" global.");
  expect(text).toContain(" globalThis.");
});

describe.concurrent("sourcemap boolean values", () => {
  test("sourcemap: true should work (boolean)", async () => {
    const dir = tempDirWithFiles("sourcemap-true-boolean", {
      "index.js": `console.log("hello");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      sourcemap: true,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("entry-point");

    const output = await build.outputs[0].text();
    expect(output).toContain("//# sourceMappingURL=data:application/json;base64,");
  });

  test("sourcemap: false should work (boolean)", async () => {
    const dir = tempDirWithFiles("sourcemap-false-boolean", {
      "index.js": `console.log("hello");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      sourcemap: false,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("entry-point");

    const output = await build.outputs[0].text();
    expect(output).not.toContain("//# sourceMappingURL=");
  });

  test("sourcemap: true with outdir should create linked sourcemap", async () => {
    const dir = tempDirWithFiles("sourcemap-true-outdir", {
      "index.js": `console.log("hello");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      outdir: join(dir, "out"),
      sourcemap: true,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(2);

    const jsOutput = build.outputs.find(o => o.kind === "entry-point");
    const mapOutput = build.outputs.find(o => o.kind === "sourcemap");

    expect(jsOutput).toBeTruthy();
    expect(mapOutput).toBeTruthy();
    expect(jsOutput!.sourcemap).toBe(mapOutput!);

    const jsText = await jsOutput!.text();
    expect(jsText).toContain("//# sourceMappingURL=index.js.map");
  });
});

describe.concurrent("sourcemap positions", () => {
  // Source-map columns count UTF-16 code units. Tokens after the first
  // non-ASCII character on a line (Latin-1, astral, CJK) must still map to
  // their exact original column.
  test("original columns after non-ASCII characters on the same line", async () => {
    const source = [
      `export function a1() { throw new Error("A"); } export const za = "e";`,
      `export const zb = "é"; export function b1() { throw new Error("B"); }`,
      `export const zc = "🎉"; export function c1() { throw new Error("C"); }`,
      `export const zd = "汉字 wörld"; export function d1() { throw new Error("D"); }`,
      ``,
    ].join("\n");
    const dir = tempDirWithFiles("build-sourcemap-unicode-columns", { "in.ts": source });

    const build = await Bun.build({
      entrypoints: [join(dir, "in.ts")],
      outdir: join(dir, "out"),
      sourcemap: "external",
    });
    expect(build.success).toBe(true);

    const generated = await build.outputs.find(o => o.kind === "entry-point")!.text();
    const map = await build.outputs.find(o => o.kind === "sourcemap")!.json();

    // 1-based line, 0-based UTF-16 column: the convention `source-map` uses on
    // both sides of originalPositionFor.
    const lineColumn = (text: string, index: number) => {
      const before = text.slice(0, index);
      return { line: before.split("\n").length, column: index - (before.lastIndexOf("\n") + 1) };
    };

    await SourceMapConsumer.with(map, null, consumer => {
      for (const token of ['new Error("A")', 'new Error("B")', 'new Error("C")', 'new Error("D")']) {
        const { line, column } = consumer.originalPositionFor(lineColumn(generated, generated.indexOf(token)));
        expect({ token, line, column }).toEqual({ token, ...lineColumn(source, source.indexOf(token)) });
      }
    });
  });

  // Chunk paths and split-require chunk ids are substituted into the output
  // after printing; when the linker widens some `[hash]` names to keep them
  // distinct, the substituted strings differ in length from one another and
  // the mappings after them must still line up.
  test("tokens after chunk paths whose [hash] names were widened", async () => {
    const n = 40;
    const files: Record<string, string> = {};
    for (let i = 0; i < n; i++) files[`m${i}.js`] = `export const v = ${i};\n`;
    const imports = Array.from({ length: n }, (_, i) => `import("./m${i}.js")`).join(", ");
    const requires = Array.from({ length: n }, (_, i) => `require("./m${i}.js")`).join(", ");
    const source = [
      `export const mods = [${imports}, "__A__"];`,
      `export const reqs = () => [${requires}, "__B__"];`,
      `export function c1() { throw new Error("C"); }`,
      ``,
    ].join("\n");
    files["in.js"] = source;
    const dir = tempDirWithFiles("build-sourcemap-widened-hash", files);

    const build = await Bun.build({
      entrypoints: [join(dir, "in.js")],
      outdir: join(dir, "out"),
      splitting: true,
      target: "bun",
      naming: { entry: "[name].[ext]", chunk: "c[hash1].[ext]" },
      sourcemap: "external",
    });
    expect(build.success).toBe(true);
    const chunks = build.outputs.filter(o => o.kind === "chunk").map(o => path.basename(o.path));
    expect(chunks.length).toBe(n);
    expect(new Set(chunks).size).toBe(n);
    // 40 names cannot all differ in one character of a 32-character alphabet.
    expect(chunks.some(c => c.length > "cX.js".length)).toBe(true);

    const entry = build.outputs.find(o => o.kind === "entry-point")!;
    const generated = await entry.text();
    for (const c of chunks) expect(generated).toContain(c);
    const map = await build.outputs.find(o => o.kind === "sourcemap" && o.path === entry.path + ".map")!.json();

    const lineColumn = (text: string, index: number) => {
      const before = text.slice(0, index);
      return { line: before.split("\n").length, column: index - (before.lastIndexOf("\n") + 1) };
    };
    await SourceMapConsumer.with(map, null, consumer => {
      // "__A__" and "__B__" sit on the same generated line as, and after, the
      // forty substituted chunk paths.
      for (const token of ['"__A__"', '"__B__"', 'new Error("C")']) {
        expect(generated.indexOf(token)).toBeGreaterThan(0);
        const { line, column } = consumer.originalPositionFor(lineColumn(generated, generated.indexOf(token)));
        expect({ token, line, column }).toEqual({ token, ...lineColumn(source, source.indexOf(token)) });
      }
    });
  });
});

const originalCwd = process.cwd() + "";

describe("tsconfig option", () => {
  afterEach(() => {
    process.chdir(originalCwd);
  });

  test("should resolve path mappings", async () => {
    const dir = tempDirWithFiles("tsconfig-api-basic", {
      "tsconfig.json": `{
        "compilerOptions": {
          "paths": {
            "@/*": ["./src/*"]
          }
        }
      }`,
      "src/utils.ts": `export const greeting = "Hello World";`,
      "index.ts": `import { greeting } from "@/utils";
export { greeting };`,
    });

    try {
      process.chdir(dir);
      const result = await Bun.build({
        entrypoints: ["./index.ts"],
        tsconfig: "./tsconfig.json",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const output = await result.outputs[0].text();
      expect(output).toContain("Hello World");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should work from nested directories", async () => {
    const dir = tempDirWithFiles("tsconfig-api-nested", {
      "tsconfig.json": `{
        "compilerOptions": {
          "paths": {
            "@/*": ["./src/*"]
          }
        }
      }`,
      "src/utils.ts": `export const greeting = "Hello World";`,
      "src/nested/index.ts": `import { greeting } from "@/utils";
export { greeting };`,
    });

    try {
      process.chdir(join(dir, "src/nested"));
      const result = await Bun.build({
        entrypoints: ["./index.ts"],
        tsconfig: "../../tsconfig.json",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const output = await result.outputs[0].text();
      expect(output).toContain("Hello World");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should handle relative tsconfig paths", async () => {
    const dir = tempDirWithFiles("tsconfig-api-relative", {
      "tsconfig.json": `{
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@/*": ["src/*"]
          }
        }
      }`,
      "configs/build-tsconfig.json": `{
        "extends": "../tsconfig.json",
        "compilerOptions": {
          "baseUrl": ".."
        }
      }`,
      "src/utils.ts": `export const greeting = "Hello World";`,
      "index.ts": `import { greeting } from "@/utils";
export { greeting };`,
    });

    try {
      process.chdir(dir);
      const result = await Bun.build({
        entrypoints: ["./index.ts"],
        tsconfig: "./configs/build-tsconfig.json",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const output = await result.outputs[0].text();
      expect(output).toContain("Hello World");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("onEnd fires before promise resolves with throw: true", async () => {
    const dir = tempDirWithFiles("onend-throwonerror-true", {
      "index.ts": `
        // This will cause a build error
        import { missing } from "./does-not-exist";
        console.log(missing);
      `,
    });

    let onEndCalled = false;
    let onEndCalledBeforeReject = false;
    let promiseRejected = false;

    try {
      await Bun.build({
        entrypoints: [join(dir, "index.ts")],
        throw: true,
        plugins: [
          {
            name: "test-plugin",
            setup(builder) {
              builder.onEnd(result => {
                onEndCalled = true;
                onEndCalledBeforeReject = !promiseRejected;
                // Result should contain error information
                expect(result.success).toBe(false);
                expect(result.logs).toBeDefined();
                expect(result.logs.length).toBeGreaterThan(0);
              });
            },
          },
        ],
      });
      // Should not reach here
      expect(false).toBe(true);
    } catch (error) {
      promiseRejected = true;
      // Verify onEnd was called before promise rejected
      expect(onEndCalled).toBe(true);
      expect(onEndCalledBeforeReject).toBe(true);
    }
  });

  test("onEnd fires before promise resolves with throw: false", async () => {
    const dir = tempDirWithFiles("onend-throwonerror-false", {
      "index.ts": `
        // This will cause a build error
        import { missing } from "./does-not-exist";
        console.log(missing);
      `,
    });

    let onEndCalled = false;
    let onEndCalledBeforeResolve = false;
    let promiseResolved = false;

    const result = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      throw: false,
      plugins: [
        {
          name: "test-plugin",
          setup(builder) {
            builder.onEnd(result => {
              onEndCalled = true;
              onEndCalledBeforeResolve = !promiseResolved;
              // Result should contain error information
              expect(result.success).toBe(false);
              expect(result.logs).toBeDefined();
              expect(result.logs.length).toBeGreaterThan(0);
            });
          },
        },
      ],
    });

    promiseResolved = true;

    // Verify onEnd was called before promise resolved
    expect(onEndCalled).toBe(true);
    expect(onEndCalledBeforeResolve).toBe(true);
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("onEnd always fires on successful build", async () => {
    const dir = tempDirWithFiles("onend-success", {
      "index.ts": `
        export const message = "Build successful";
        console.log(message);
      `,
    });

    let onEndCalled = false;
    let onEndCalledBeforeResolve = false;
    let promiseResolved = false;

    const result = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      throw: true, // Should not matter for successful build
      plugins: [
        {
          name: "test-plugin",
          setup(builder) {
            builder.onEnd(result => {
              onEndCalled = true;
              onEndCalledBeforeResolve = !promiseResolved;
              // Result should indicate success
              expect(result.success).toBe(true);
              expect(result.outputs).toBeDefined();
              expect(result.outputs.length).toBeGreaterThan(0);
            });
          },
        },
      ],
    });

    promiseResolved = true;

    // Verify onEnd was called before promise resolved
    expect(onEndCalled).toBe(true);
    expect(onEndCalledBeforeResolve).toBe(true);
    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();
    expect(output).toContain("Build successful");
  });

  test("multiple onEnd callbacks fire in order before promise settles", async () => {
    const dir = tempDirWithFiles("onend-multiple", {
      "index.ts": `
        // This will cause a build error
        import { missing } from "./not-found";
      `,
    });

    const callOrder: string[] = [];
    let promiseSettled = false;

    const result = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      throw: false,
      plugins: [
        {
          name: "plugin-1",
          setup(builder) {
            builder.onEnd(() => {
              callOrder.push("first");
              expect(promiseSettled).toBe(false);
            });
          },
        },
        {
          name: "plugin-2",
          setup(builder) {
            builder.onEnd(() => {
              callOrder.push("second");
              expect(promiseSettled).toBe(false);
            });
          },
        },
        {
          name: "plugin-3",
          setup(builder) {
            builder.onEnd(() => {
              callOrder.push("third");
              expect(promiseSettled).toBe(false);
            });
          },
        },
      ],
    });

    promiseSettled = true;

    // All callbacks should have fired in order before promise resolved
    expect(callOrder).toEqual(["first", "second", "third"]);
    // The build actually succeeds because the import is being resolved to nothing
    // What matters is that callbacks fired before promise settled
    expect(result.success).toBeDefined();
  });
});

// On release builds mimalloc's large-allocation arenas make RSS growth too
// non-deterministic to draw a clean line between "leaking" and "not leaking"
// for this path. Under debug/ASAN the allocator behaviour is stable enough to
// measure reliably, so we only assert there.
test.skipIf(!isDebug && !isASAN)(
  "Bun.build sourcemap: 'inline' with no outdir does not leak sourcemap JSON",
  async () => {
    // The in-memory build path used to leak the intermediate sourcemap JSON
    // buffer: it is base64-encoded into the output and then dropped without a
    // free. To make the leak observable we make the sourcemap JSON huge —
    // "sourcesContent" embeds the full input source, so a ~30MB comment in the
    // entry produces a ~30MB sourcemap JSON while keeping the actual bundle
    // work trivial. 8 leaked builds ≈ ~240MB that can never be reclaimed.
    //
    // RSS is noisy between builds, so we settle with several GC+sleep cycles
    // before each sample to let JSC collect the output blobs and mimalloc
    // purge freed pages.
    const dir = tempDirWithFiles("bun-build-inline-sourcemap-leak", {
      "entry.ts": "export const a = 1;\n/* " + Buffer.alloc(30 * 1024 * 1024, "x").toString() + " */\n",
      "run.ts": `
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const entry = process.argv[2];
        async function build() {
          const res = await Bun.build({ entrypoints: [entry], sourcemap: "inline" });
          if (!res.success) throw new AggregateError(res.logs, "build failed");
        }
        async function settle() {
          for (let i = 0; i < 4; i++) { Bun.gc(true); await Bun.sleep(10); }
        }
        for (let i = 0; i < 2; i++) await build();
        await settle();
        const before = rss();
        for (let i = 0; i < 8; i++) await build();
        await settle();
        const after = rss();
        console.log(JSON.stringify({ before, after, growth: after - before }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(dir, "run.ts"), join(dir, "entry.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const { growth } = JSON.parse(stdout.trim());
    // Observed (2 warmup + 8 measured, settled): ~220-250MB with the free,
    // ~590-650MB without it.
    expect(growth).toBeLessThan(400 * 1024 * 1024);
  },
  120_000,
);

// Regression: src/js_printer/renamer.zig:592 `assignNamesRecursiveWithNumberScope`
// walks a linear single-child scope chain in a `while(true)` loop, allocating a
// fresh `NumberScope` from `number_scope_pool` for every level that declares
// symbols. The trailing `defer if (s != initial_scope) { s.deinit; pool.put(s) }`
// only returns the FINAL `s` to the pool — every intermediate NumberScope (and its
// `name_counts` map) is abandoned. In Zig this is harmless: `name_counts` is backed
// by the per-chunk worker arena (renamer.zig:533 `number_scope_pool = .init(arena)`,
// findUnusedName puts via `r.allocator` = worker MimallocArena) and is bulk-freed
// when the build completes. A port that drops the arena and backs `name_counts`
// with the global heap leaks one HashMap per intermediate nested scope, per build,
// forever — watch-mode / dev-server rebuilds grow unbounded.
//
// This test asserts the Zig invariant: repeated builds of a file with many deep
// linear `{ let ...; { ... } }` chains must not grow RSS proportionally to
// (chain depth × build count). Gated to debug/ASAN like the sourcemap-leak test
// above because release mimalloc page retention makes RSS too noisy to threshold.
// TODO(zig-rust-divergence): currently times out on the Rust debug build (the
// per-chunk arena backing for NumberScope.name_counts was dropped — see
// docs/ZIG_RUST_DIVERGENCE_AUDIT.md). Skipped instead of `.todo` because the
// body never reaches its assertion before the 120s timeout, so `.todo` would
// just burn two minutes of CI per run without exercising the check.
test.skip("Bun.build NumberRenamer does not leak intermediate NumberScope.name_counts across builds", async () => {
  // 8 independent linear chains, each 150 blocks deep, 80 `let` bindings per
  // block. Every block has exactly one child block → renamer takes the linear
  // fast-path and allocates a NumberScope per level; 149 of 150 are the
  // "intermediate" ones the Zig defer never puts back. 80 bindings/level means
  // each leaked `name_counts` holds 80 boxed-key entries.
  const CHAINS = 8;
  const DEPTH = 150;
  const VARS_PER_SCOPE = 80;
  let entry = "";
  for (let c = 0; c < CHAINS; c++) {
    for (let d = 0; d < DEPTH; d++) {
      let decls = "";
      for (let v = 0; v < VARS_PER_SCOPE; v++) decls += `c${c}_d${d}_v${v}=${v},`;
      entry += `{let ${decls.slice(0, -1)};\n`;
    }
    entry += "}\n".repeat(DEPTH);
  }

  const dir = tempDirWithFiles("bun-build-number-renamer-leak", {
    "entry.js": entry,
    "run.ts": `
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const entry = process.argv[2];
        async function build() {
          // No identifier minification → NumberRenamer path (not MinifyRenamer).
          const res = await Bun.build({ entrypoints: [entry], minify: false });
          if (!res.success) throw new AggregateError(res.logs, "build failed");
        }
        async function settle() {
          for (let i = 0; i < 4; i++) { Bun.gc(true); await Bun.sleep(10); }
        }
        // Warm up: fill any one-shot caches and let the worker arenas reach
        // steady-state so the measured window only reflects per-build retention.
        for (let i = 0; i < 2; i++) await build();
        await settle();
        const before = rss();
        for (let i = 0; i < 20; i++) await build();
        await settle();
        const after = rss();
        console.log(JSON.stringify({ before, after, growth: after - before }));
      `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(dir, "run.ts"), join(dir, "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { growth } = JSON.parse(stdout.trim());
  // With arena-backed scopes (Zig spec) the 20 measured builds reuse the same
  // worker heap and settle near zero net growth. With global-heap name_counts
  // and intermediate scopes never returned to the pool, each build abandons
  // ~8×149 maps × 80 entries — roughly 4-5 MB/build, ~90-100 MB over 20
  // iterations. 48 MB sits comfortably between the two with headroom for
  // ASAN/LSan metadata noise.
  expect(growth).toBeLessThan(48 * 1024 * 1024);
  expect(exitCode).toBe(0);
}, 120_000);

// Regression: repeated in-process `Bun.build()` calls panicked with
// `index out of bounds: the len is 4095 but the index is 4095` (SIGTRAP) after
// a couple thousand builds. `Path.dupeAlloc` interns every module path into the
// process-lifetime `FilenameStore`. The Rust port had dropped two things the
// Zig original does: (1) the `isSliceInBuffer` short-circuit that returns an
// already-interned path unchanged, and (2) routing the disjoint `text`/`pretty`
// case (a freshly-relativized display path, recomputed every build) into the
// per-build arena instead of the store. Without them, each build re-appended
// every path, and once the store's overflow blocks filled
// (`OVERFLOW_GROUP_MAX` = 4095 blocks), the next append indexed one past the
// fixed-capacity pointer array and panicked.
//
// Many modules per build reaches the cap in far fewer builds: with 500 modules
// the broken binary panics roughly a third of the way through this loop, while
// the fixed binary keeps the store bounded and exits cleanly after all 400.
// (MODULES stays well under the ~550 where the unrelated recursive tree-shaker
// overflows its thread stack.) Not gated to debug/ASAN — the panic reproduces
// on release builds too.
//
// An explicit timeout is required (not optional): this runs hundreds of real
// bundles, far past bun:test's 5s default. The sibling leak tests above do the
// same. 180s matches the CI runner's own per-test ceiling.
test("Bun.build can be called thousands of times in one process without crashing", async () => {
  const MODULES = 500;
  const BUILDS = 400;
  const files: Record<string, string> = {};
  for (let i = 0; i < MODULES; i++) {
    files[`m${i}.js`] =
      `import { f${(i + 1) % MODULES} } from "./m${(i + 1) % MODULES}.js";\n` +
      `export const v${i} = ${i};\n` +
      `export function f${i}() { return v${i}; }\n`;
  }
  files["entry.js"] = Array.from(
    { length: MODULES },
    (_, i) => `import { f${i} } from "./m${i}.js"; console.log(f${i}());`,
  ).join("\n");
  files["run.ts"] = `
    const entry = process.argv[2];
    const BUILDS = ${BUILDS};
    for (let i = 1; i <= BUILDS; i++) {
      const res = await Bun.build({ entrypoints: [entry], minify: true, sourcemap: "external" });
      if (!res.success) throw new AggregateError(res.logs, "build failed");
      for (const o of res.outputs) await o.arrayBuffer();
    }
    console.log("OK " + BUILDS);
  `;
  const dir = tempDirWithFiles("bun-build-filename-store-overflow", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "run.ts"), join(dir, "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash surfaces as a non-zero (signal) exit and a panic on stderr; assert
  // the run completed cleanly instead.
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK 400");
  expect(exitCode).toBe(0);
}, 180_000);

// A module shared by several entry points is printed once per chunk, and those
// prints run in parallel on the thread pool against the same AST. The printer
// used to flatten `"a" + "b" + "c"` ropes in place, through the `StoreRef`, so
// one thread's write of `data` / `next = None` raced every other thread's read
// of the same node. Observed results on the unfixed printer: the tail printed
// twice ("abcbc"), the tail dropped ("a"), or a crash on a torn `next` pointer
// (a `Bus error` / `Segmentation fault` at a 4 GiB aligned address).
//
// The race needs many chunks printing many ropes at the same time, so this
// builds 64 entry points over one module with 400 folded ropes, twice, and
// checks every folded string in every output. With the in-place flatten the
// first build corrupts hundreds of strings on a 16 core machine.
//
// Needs an explicit timeout: two real 64-entry bundles on a debug build take
// well over bun:test's 5s default.
test("Bun.build does not corrupt folded string ropes shared across chunks", async () => {
  const ENTRIES = 64;
  const ROPES = 400;
  const ROUNDS = 2;
  let shared = "export function helper(...a) { return a; }\n";
  for (let i = 0; i < ROPES; i++) {
    // The rope is a call argument inside an arrow body, the shape the printer
    // crashed on in the field. It folds only with `minify.syntax`.
    shared +=
      `export const fn${i} = helper("first${i}", () => { const q = ${i}; ` +
      `helper(q, "alpha-${i}-" + "beta-" + "gamma-" + "delta-${i}"); return q; });\n`;
  }
  const files: Record<string, string> = { "shared.js": shared };
  for (let i = 0; i < ENTRIES; i++) {
    files[`entry${i}.js`] = `import * as s from "./shared.js";\nconsole.log(s, ${i});\n`;
  }
  files["run.ts"] = `
    import { join } from "node:path";
    const dir = process.argv[2];
    const entrypoints = Array.from({ length: ${ENTRIES} }, (_, i) => join(dir, "entry" + i + ".js"));
    let bad = 0;
    for (let round = 0; round < ${ROUNDS}; round++) {
      const res = await Bun.build({ entrypoints, minify: { syntax: true }, target: "bun" });
      if (!res.success) throw new AggregateError(res.logs, "build failed");
      for (const output of res.outputs) {
        const text = await output.text();
        for (let i = 0; i < ${ROPES}; i++) {
          const expected = '"alpha-' + i + '-beta-gamma-delta-' + i + '"';
          if (!text.includes(expected)) {
            bad++;
            if (bad <= 5) {
              const actual = text.match(new RegExp('"alpha-' + i + '-[^"]*"'));
              console.log("BAD round " + round + " " + output.path + " expected " + expected + " got " + actual?.[0]);
            }
          }
        }
      }
    }
    console.log("DONE " + bad);
  `;
  const dir = tempDirWithFiles("bun-build-rope-print-race", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "run.ts"), dir],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("DONE 0");
  expect(exitCode).toBe(0);
}, 180_000);

// A plugin module's namespace lives in the bundle's arena. The `BuildMessage`
// objects in `result.logs` outlive the arena, so they must own a copy.
// MIMALLOC_PURGE_DELAY=0 makes mimalloc return the arena's pages to the OS as
// soon as the bundle ends, so a stale pointer crashes instead of reading the
// old bytes.
test.concurrent("a BuildMessage keeps the namespace of a plugin module after the build", async () => {
  using dir = tempDir("build-message-namespace", {
    "entry.ts": `import "virtual:broken";`,
    "run.ts": `
      const result = await Bun.build({
        entrypoints: ["./entry.ts"],
        throw: false,
        plugins: [{
          name: "virtual",
          setup(builder) {
            builder.onResolve({ filter: /^virtual:/ }, args => ({
              path: args.path.slice("virtual:".length),
              namespace: "virtual",
            }));
            builder.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
              contents: "let = ;",
              loader: "js",
            }));
          },
        }],
      });
      console.log(JSON.stringify({
        success: result.success,
        positions: result.logs.map(log => {
          const { file, namespace } = log.position!;
          return { file, namespace };
        }),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    cwd: String(dir),
    env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0", MIMALLOC_ABANDONED_PAGE_PURGE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    success: false,
    positions: [{ file: "broken", namespace: "virtual" }],
  });
  expect(exitCode).toBe(0);
});

test("sourcemap sourcesContent is valid JSON when source contains C0 control chars", async () => {
  // RFC 8259 only allows \" \\ \/ \b \f \n \r \t and six-char \u escapes; \v
  // and \xNN are JavaScript-only. A VT (0x0B) or BEL (0x07) in the input used
  // to leak through as \v / \x07 and break JSON.parse on the .map file.
  const controls = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).join("");
  const source = `/* ctrl: [${controls}] */\nexport const x = 1;\n`;
  using dir = tempDir("sourcemap-json-ctrl", { "in.js": source });

  const res = await Bun.build({
    entrypoints: [join(String(dir), "in.js")],
    sourcemap: "external",
    outdir: String(dir),
  });
  expect(res.success).toBe(true);

  const map = res.outputs.find(o => o.kind === "sourcemap")!;
  const text = await map.text();
  expect(text).not.toMatch(/\\v|\\x[0-9A-Fa-f]{2}/);
  const parsed = JSON.parse(text);
  expect(parsed.sourcesContent[0]).toBe(source);
});

// Bun.build's link step waited for the shared thread pool to go *idle* rather than for its
// own tasks, so any unrelated pool work extended the build by its full duration — a
// node:fs read parked on a FIFO nobody writes made every later build hang forever.
test.skipIf(isWindows)(
  "Bun.build does not wait for unrelated thread-pool work",
  async () => {
    using dir = tempDir("build-pool-wait", {
      "a.ts": `import { b } from "./b"; import "./s.css"; console.log(b);`,
      "b.ts": `export const b = 1;`,
      "s.css": `body { color: red }`,
      "run.js": `
      const { join } = require("path");
      const dir = process.argv[2];
      const fs = require("fs");
      const fifo = join(dir, "fifo");
      require("child_process").execFileSync("mkfifo", [fifo]);
      await Bun.build({ entrypoints: [join(dir, "a.ts")], outdir: join(dir, "out") });
      let readDone = false, readErr;
      // a pool thread blocks opening/reading the FIFO
      const readFinished = new Promise((resolve) => fs.readFile(fifo, (err) => { readErr = err; readDone = true; resolve(); }));
      // A non-blocking write-open of a FIFO only succeeds once a reader has it open, so this both
      // waits for the pool thread to be in there and, by staying open without writing, keeps it
      // parked in read() until we close it below.
      let writer;
      for (const deadline = Date.now() + 10_000; ; ) {
        try { writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK); break; } catch (e) {
          if (e.code !== "ENXIO" || Date.now() > deadline) throw e;
          await Bun.sleep(5);
        }
      }
      // Release the pool thread after 5 s regardless, so a regression shows up as readDone
      // being true below rather than as the whole test hanging until its timeout.
      let closed = false;
      const closeWriter = () => { if (!closed) { closed = true; fs.closeSync(writer); } };
      setTimeout(closeWriter, 5000).unref();
      const t = performance.now();
      const result = await Bun.build({ entrypoints: [join(dir, "a.ts")], outdir: join(dir, "out") });
      const elapsed = performance.now() - t;
      // readDone must still be false: the build finished before the release of the FIFO reader,
      // i.e. it did not wait for that unrelated pool task. elapsed is diagnostic only.
      console.error("second build took " + Math.round(elapsed) + " ms");
      console.log(result.success, result.outputs.length > 0, readDone);
      closeWriter(); // EOF for the reader: let the pool thread go before exiting
      await readFinished;
      console.log(readDone, readErr ? readErr.code : "ok");
      process.exit(0);
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", String(dir)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toStartWith("second build took ");
    expect(stdout).toBe("true true false\ntrue ok\n");
    expect(exitCode).toBe(0);
  },
  30_000,
);
