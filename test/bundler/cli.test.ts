import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import fs, { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";

describe.concurrent(
  "bun build",
  () => {
    test("warnings dont return exit code 1", async () => {
      const { stderr, exited } = Bun.spawn({
        cmd: [bunExe(), "build", path.join(import.meta.dir, "./fixtures/jsx-warning/index.jsx")],
        env: bunEnv,
        stderr: "pipe",
      });
      expect(await exited).toBe(0);
      expect(await stderr.text()).toContain(
        'warn: "key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.',
      );
    });

    async function testCompile(outfile: string) {
      const { exited } = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          path.join(import.meta.dir, "./fixtures/trivial/index.js"),
          "--compile",
          "--outfile",
          outfile,
        ],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(await exited).toBe(0);
    }
    async function testExec(outfile: string) {
      const { exited, stderr } = Bun.spawn({
        cmd: [outfile],
        env: bunEnv,
        stdout: "inherit",
        stderr: "pipe",
      });
      expect(await stderr.text()).toBeEmpty();
      expect(await exited).toBe(0);
    }
    async function testCompileAndExec(relativeOutfile: string) {
      const baseDir = tmpdirSync();
      const outfile = path.join(baseDir, relativeOutfile);
      await testCompile(outfile);
      await testExec(outfile);
      fs.rmSync(baseDir, { recursive: true, force: true });
    }

    test("generating a standalone binary with --outfile", async () => {
      await testCompileAndExec(path.join("bun-build-outfile", "index.exe"));
    });

    // https://github.com/oven-sh/bun/issues/4195
    test("generating a standalone binary in nested path, issue #4195", async () => {
      await testCompileAndExec(path.join("bun-build-outfile2", "b/u/n", "index.exe"));
    });

    test("works with utf8 bom", async () => {
      const tmp = tmpdirSync();
      const src = path.join(tmp, "index.js");
      fs.writeFileSync(src, '\ufeffconsole.log("hello world");', { encoding: "utf8" });
      const { exited } = Bun.spawn({
        cmd: [bunExe(), "build", src],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(await exited).toBe(0);
    });

    test("--tsconfig-override works", async () => {
      const tmp = tmpdirSync();
      const baseDir = path.join(tmp, "tsconfig-override-test");
      fs.mkdirSync(baseDir, { recursive: true });

      fs.writeFileSync(
        path.join(baseDir, "index.ts"),
        `import { utils } from "@utils/helper";
console.log(utils());`,
      );

      fs.writeFileSync(path.join(baseDir, "helper.ts"), `export function utils() { return "Hello from utils"; }`);

      fs.writeFileSync(
        path.join(baseDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            paths: {
              "@wrong/*": ["./wrong/*"],
            },
          },
        }),
      );

      fs.writeFileSync(
        path.join(baseDir, "custom-tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            paths: {
              "@utils/*": ["./*"],
            },
          },
        }),
      );

      const failResult = Bun.spawn({
        cmd: [bunExe(), "build", path.join(baseDir, "index.ts"), "--outdir", path.join(baseDir, "out-fail")],
        env: bunEnv,
        cwd: baseDir,
        stderr: "pipe",
      });
      expect(await failResult.exited).not.toBe(0);
      expect(await failResult.stderr?.text()).toContain("Could not resolve");

      const successResult = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          path.join(baseDir, "index.ts"),
          "--tsconfig-override",
          path.join(baseDir, "custom-tsconfig.json"),
          "--outdir",
          path.join(baseDir, "out-success"),
        ],
        env: bunEnv,
        cwd: baseDir,
        stderr: "pipe",
      });
      expect(await successResult.exited).toBe(0);

      const outputFile = path.join(baseDir, "out-success", "index.js");
      expect(fs.existsSync(outputFile)).toBe(true);
      const output = fs.readFileSync(outputFile, "utf8");
      expect(output).toContain("Hello from utils");
    });

    test("--tsconfig-override works from nested directories", async () => {
      const tmp = tmpdirSync();
      const baseDir = path.join(tmp, "tsconfig-nested-test");
      const nestedDir = path.join(baseDir, "nested", "deep");
      fs.mkdirSync(nestedDir, { recursive: true });

      fs.writeFileSync(
        path.join(nestedDir, "index.ts"),
        `import { utils } from "@utils/helper";
console.log(utils());`,
      );

      fs.writeFileSync(path.join(baseDir, "helper.ts"), `export function utils() { return "Hello from nested!"; }`);

      fs.writeFileSync(
        path.join(baseDir, "custom-tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            paths: {
              "@utils/*": ["./*"],
            },
          },
        }),
      );

      const result = Bun.spawn({
        cmd: [bunExe(), "build", "index.ts", "--tsconfig-override", "../../custom-tsconfig.json", "--outdir", "out"],
        env: bunEnv,
        cwd: nestedDir,
      });
      expect(await result.exited).toBe(0);

      const outputFile = path.join(nestedDir, "out", "index.js");
      expect(fs.existsSync(outputFile)).toBe(true);
      const output = fs.readFileSync(outputFile, "utf8");
      expect(output).toContain("Hello from nested!");
    });

    test("__dirname and __filename are printed correctly", async () => {
      using baseDirPath = tempDir("bun-build-dirname-filename", {
        "我": {
          "我.ts": "console.log(__dirname); console.log(__filename);",
        },
      });
      const baseDir = baseDirPath + "";

      const { exited } = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          path.join(baseDir, "我/我.ts"),
          "--compile",
          "--outfile",
          path.join(baseDir, "exe.exe"),
        ],
        env: bunEnv,
        cwd: baseDir,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(await exited).toBe(0);

      await using proc = Bun.spawn({
        cmd: [path.join(baseDir, "exe.exe")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = await proc.stdout.text();
      await proc.exited;

      expect(text).toContain(path.join(baseDir, "我") + "\n");
      expect(text).toContain(path.join(baseDir, "我", "我.ts") + "\n");
    });

    test.skipIf(!isWindows)("should be able to handle pretty path when using pnpm +  #14685", async () => {
      // this test code follows the same structure as and
      // is based on the code for testing issue 4893

      let testDir = tmpdirSync();

      // Clean up from prior runs if necessary
      rmSync(testDir, { recursive: true, force: true });

      // Create a directory with our test file
      mkdirSync(testDir, { recursive: true });

      writeFileSync(
        join(testDir, "index.ts"),
        "import chalk from \"chalk\"; export function main() { console.log(chalk.red('Hello, World!')); }",
      );
      writeFileSync(
        join(testDir, "package.json"),
        `
  {
  "dependencies": {
    "chalk": "^5.3.0"
  }
}`,
      );
      testDir = realpathSync(testDir);

      await Bun.spawn({
        cmd: [bunExe(), "x", "pnpm@9", "i"],
        env: bunEnv,
        stderr: "pipe",
        cwd: testDir,
      }).exited;
      // bun build --entrypoints ./index.ts --outdir ./dist --target node
      const { stderr, exited } = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--entrypoints",
          join(testDir, "index.ts"),
          "--outdir",
          join(testDir, "dist"),
          "--target",
          "node",
        ],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(await stderr.text()).toBe("");
      expect(await exited).toBe(0);
    });
  },
  10_000,
);

test.skipIf(!isWindows)("should be able to handle pretty path on windows #13897", async () => {
  // this test code follows the same structure as and
  // is based on the code for testing issue 4893

  let testDir = tmpdirSync();

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test file
  mkdirSync(testDir, { recursive: true });

  writeFileSync(
    join(testDir, "index.ts"),
    "import chalk from \"chalk\"; export function main() { console.log(chalk.red('Hello, World!')); }",
  );

  writeFileSync(join(testDir, "chalk.ts"), "function red(value){ consol.error(value); } export default { red };");
  testDir = realpathSync(testDir);

  // bun build --entrypoints ./index.ts --outdir ./dist --target node
  const buildOut = await Bun.build({
    entrypoints: [join(testDir, "index.ts")],
    outdir: join(testDir, "dist"),
    minify: true,
    sourcemap: "linked",
    plugins: [
      {
        name: "My windows plugin",
        async setup(build) {
          build.onResolve({ filter: /chalk/ }, () => ({ path: join(testDir, "chalk.ts").replaceAll("/", "\\") }));
        },
      },
    ],
  });
  expect(buildOut?.success).toBe(true);
});

test("you can use --outfile=... and --sourcemap", async () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");
  const outFile = path.join(tmpdir, "out.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');

  const originalContent = fs.readFileSync(inputFile, "utf8");

  const { exited, stdout } = Bun.spawn({
    cmd: [bunExe(), "build", "--outfile=" + path.relative(tmpdir, outFile), "--sourcemap", inputFile],
    env: bunEnv,
    cwd: tmpdir,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await exited).toBe(0);

  // Verify that the input file wasn't overwritten
  expect(fs.readFileSync(inputFile, "utf8")).toBe(originalContent);

  // Verify that the output file was created
  expect(fs.existsSync(outFile)).toBe(true);

  // Verify that the sourcemap file was created
  expect(fs.existsSync(outFile + ".map")).toBe(true);

  // Verify that the output file contains sourceMappingURL comment
  const outputContent = fs.readFileSync(outFile, "utf8");
  expect(outputContent).toContain("//# sourceMappingURL=out.js.map");

  expect((await stdout.text()).replace(/\d{1,}ms/, "0.000000001ms")).toMatchInlineSnapshot(`
    "Bundled 1 module in 0.000000001ms

      out.js      120 bytes  (entry point)
      out.js.map  213 bytes  (source map)

    "
  `);
});

test("some log cases", async () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");
  const outFile = path.join(tmpdir, "out.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');

  // absolute path
  const { exited, stdout } = Bun.spawn({
    cmd: [bunExe(), "build", "--outfile=" + outFile, "--sourcemap", inputFile],
    env: bunEnv,
    cwd: tmpdir,
  });
  expect(await exited).toBe(0);
  expect((await stdout.text()).replace(/in \d+ms/g, "in {time}ms")).toMatchInlineSnapshot(`
    "Bundled 1 module in {time}ms

      out.js      120 bytes  (entry point)
      out.js.map  213 bytes  (source map)

    "
  `);
});

test("log case 1", async () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");
  const inputFile2 = path.join(tmpdir, "input-twooo.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');
  writeFileSync(inputFile2, 'console.log("Hello, world!");');

  const { exited, stdout } = Bun.spawn({
    cmd: [bunExe(), "build", "--outdir=" + tmpdir + "/out", inputFile, inputFile2],
    env: bunEnv,
    cwd: tmpdir,
  });
  expect(await exited).toBe(0);
  expect((await stdout.text()).replace(/in \d+ms/g, "in {time}ms")).toMatchInlineSnapshot(`
    "Bundled 2 modules in {time}ms

      input.js        42 bytes  (entry point)
      input-twooo.js  48 bytes  (entry point)

    "
  `);
});

test("log case 2", async () => {
  const tmpdir = tmpdirSync();
  const inputFile = path.join(tmpdir, "input.js");

  writeFileSync(inputFile, 'console.log("Hello, world!");');

  const { exited, stdout } = Bun.spawn({
    cmd: [bunExe(), "build", "--outdir=" + tmpdir + "/out", inputFile],
    env: bunEnv,
    cwd: tmpdir,
  });
  expect(await exited).toBe(0);
  expect((await stdout.text()).replace(/in \d+ms/g, "in {time}ms")).toMatchInlineSnapshot(`
    "Bundled 1 module in {time}ms

      input.js  42 bytes  (entry point)

    "
  `);
});

test("--outdir build succeeds when the output directory already exists with prior output", async () => {
  using dir = tempDir("build-outdir-reuse", {
    "entry.ts": `export const x: number = 1;\nconsole.log("built", x);`,
    "dist/entry.js": `console.log("stale");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outdir", "dist"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("EBADF");
  expect(stderr).not.toContain("could not open output directory");
  expect(exitCode).toBe(0);

  const out = await Bun.file(path.join(String(dir), "dist", "entry.js")).text();
  expect(out).toContain("built");
  expect(out).not.toContain("stale");
});

test("multi-entry build writes each entry point into the output directory", async () => {
  using dir = tempDir("build-multi-entry-outdir", {
    "a.ts": `export const a: number = 1;\nconsole.log("A" + a);`,
    "b.ts": `export const b: number = 2;\nconsole.log("B" + b);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "a.ts", "b.ts", "--outdir", "dist"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("EBADF");
  expect(exitCode).toBe(0);

  const a = await Bun.file(path.join(String(dir), "dist", "a.js")).text();
  const b = await Bun.file(path.join(String(dir), "dist", "b.js")).text();
  expect(a).toContain('"A"');
  expect(b).toContain('"B"');
});

// Entry points whose loader has nothing to transpile (wasm, napi, sqlite, the
// `file` fallback for unknown extensions) are copied through by `--no-bundle`.
// The copy used to be written next to the source under a hashed name instead
// of into --outdir, and the summary listed it with an empty name and 0 KB.
describe.concurrent("--no-bundle with entry points that are copied verbatim", () => {
  // Not valid UTF-8 (and starts with the wasm magic), so a byte-for-byte
  // comparison proves the file was copied rather than decoded and re-encoded.
  const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0xfe, 0x80]);
  const addon = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const sqlite = Buffer.from("SQLite format 3\0");

  async function build(cwd: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", ...args],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function listFiles(dir: string): string[] {
    return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
      .sort();
  }

  test("copies a .wasm entry point into --outdir and lists it in the summary", async () => {
    using dir = tempDir("no-bundle-copy-wasm", { "src/x.wasm": wasm });

    const { stdout, stderr, exitCode } = await build(String(dir), ["./src/x.wasm", "--outdir=dist"]);
    expect(stderr).toBe("");
    expect(stdout.replace(/in \d+ms/, "in {time}ms")).toMatchInlineSnapshot(`
      "Transpiled file in {time}ms

        x.wasm  11 bytes  (chunk)

      "
    `);
    expect(exitCode).toBe(0);

    expect(listFiles(path.join(String(dir), "dist"))).toEqual(["x.wasm"]);
    expect(fs.readFileSync(path.join(String(dir), "dist", "x.wasm"))).toEqual(wasm);
    expect(listFiles(path.join(String(dir), "src"))).toEqual(["x.wasm"]);
  });

  test("copies the wasm, napi, sqlite, and file loaders", async () => {
    using dir = tempDir("no-bundle-copy-loaders", {
      "src/x.wasm": wasm,
      "src/y.node": addon,
      "src/z.png": png,
      "src/w.db": sqlite,
    });

    const { stdout, stderr, exitCode } = await build(String(dir), [
      "./src/x.wasm",
      "./src/y.node",
      "./src/z.png",
      "./src/w.db",
      "--loader",
      ".db:sqlite",
      "--outdir=dist",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const dist = path.join(String(dir), "dist");
    expect(listFiles(dist)).toEqual(["w.db", "x.wasm", "y.node", "z.png"]);
    expect({
      "w.db": fs.readFileSync(path.join(dist, "w.db")),
      "x.wasm": fs.readFileSync(path.join(dist, "x.wasm")),
      "y.node": fs.readFileSync(path.join(dist, "y.node")),
      "z.png": fs.readFileSync(path.join(dist, "z.png")),
    }).toEqual({ "w.db": sqlite, "x.wasm": wasm, "y.node": addon, "z.png": png });
    for (const name of ["w.db", "x.wasm", "y.node", "z.png"]) {
      expect(stdout).toContain(name);
    }
    expect(listFiles(path.join(String(dir), "src"))).toEqual(["w.db", "x.wasm", "y.node", "z.png"]);
  });

  test("keeps directories relative to the common root, so same-named files do not collide", async () => {
    using dir = tempDir("no-bundle-copy-dirs", {
      "src/a/x.wasm": wasm,
      "src/b/x.wasm": png,
    });

    const { stdout, stderr, exitCode } = await build(String(dir), [
      "./src/a/x.wasm",
      "./src/b/x.wasm",
      "--outdir=dist",
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain("a/x.wasm");
    expect(stdout).toContain("b/x.wasm");
    expect(exitCode).toBe(0);

    const dist = path.join(String(dir), "dist");
    expect(listFiles(dist)).toEqual(["a/x.wasm", "b/x.wasm"]);
    expect(fs.readFileSync(path.join(dist, "a", "x.wasm"))).toEqual(wasm);
    expect(fs.readFileSync(path.join(dist, "b", "x.wasm"))).toEqual(png);
  });

  test("creates the output directories implied by --root", async () => {
    using dir = tempDir("no-bundle-copy-root", { "src/nested/x.wasm": wasm });

    const { stdout, stderr, exitCode } = await build(String(dir), ["--root=.", "./src/nested/x.wasm", "--outdir=dist"]);
    expect(stderr).toBe("");
    expect(stdout).toContain("src/nested/x.wasm");
    expect(exitCode).toBe(0);

    expect(listFiles(path.join(String(dir), "dist"))).toEqual(["src/nested/x.wasm"]);
    expect(fs.readFileSync(path.join(String(dir), "dist", "src", "nested", "x.wasm"))).toEqual(wasm);
  });

  test("does not escape --outdir for an entry point outside --root", async () => {
    using dir = tempDir("no-bundle-copy-outside-root", {
      "src/a.wasm": wasm,
      "other/b.wasm": png,
    });

    const { stdout, stderr, exitCode } = await build(String(dir), [
      "--root=src",
      "./src/a.wasm",
      "./other/b.wasm",
      "--outdir=dist",
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain("_.._/other/b.wasm");
    expect(exitCode).toBe(0);

    expect(listFiles(path.join(String(dir), "dist"))).toEqual(["_.._/other/b.wasm", "a.wasm"]);
    expect(fs.readFileSync(path.join(String(dir), "dist", "_.._", "other", "b.wasm"))).toEqual(png);
    expect(listFiles(path.join(String(dir), "other"))).toEqual(["b.wasm"]);
  });

  test("fills [name], [ext], and a content-derived [hash] in --entry-naming", async () => {
    using dir = tempDir("no-bundle-copy-hash", {
      "a.wasm": wasm,
      "b.wasm": png,
      "c.wasm": wasm,
    });

    const { stdout, stderr, exitCode } = await build(String(dir), [
      "./a.wasm",
      "./b.wasm",
      "./c.wasm",
      "--outdir=dist",
      "--entry-naming",
      "[name]-[hash].[ext]",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const files = listFiles(path.join(String(dir), "dist"));
    expect(files).toEqual([
      expect.stringMatching(/^a-[0-9a-z]{8}\.wasm$/),
      expect.stringMatching(/^b-[0-9a-z]{8}\.wasm$/),
      expect.stringMatching(/^c-[0-9a-z]{8}\.wasm$/),
    ]);
    const hashOf = (file: string) => file.slice(2, -".wasm".length);
    // a and c have the same bytes; b differs.
    expect(hashOf(files[2])).toBe(hashOf(files[0]));
    expect(hashOf(files[1])).not.toBe(hashOf(files[0]));
    for (const file of files) {
      expect(stdout).toContain(file);
    }
  });

  test.each([
    ["browser", []],
    ["bun", ["--target=bun"]],
    ["node", ["--target=node"]],
  ])("fills [target] in --entry-naming with %s", async (expected, targetArgs) => {
    using dir = tempDir("no-bundle-copy-target", { "x.wasm": wasm });

    const { stdout, stderr, exitCode } = await build(String(dir), [
      ...targetArgs,
      "./x.wasm",
      "--outdir=dist",
      "--entry-naming",
      "[target]/[name].[ext]",
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain(`${expected}/x.wasm`);
    expect(exitCode).toBe(0);

    expect(listFiles(path.join(String(dir), "dist"))).toEqual([`${expected}/x.wasm`]);
  });

  test("copies to the path given by --outfile", async () => {
    using dir = tempDir("no-bundle-copy-outfile", { "src/x.wasm": wasm });

    const { stdout, stderr, exitCode } = await build(String(dir), ["./src/x.wasm", "--outfile=out/renamed.wasm"]);
    expect(stderr).toBe("");
    expect(stdout).toContain("renamed.wasm");
    expect(exitCode).toBe(0);

    expect(listFiles(path.join(String(dir), "out"))).toEqual(["renamed.wasm"]);
    expect(fs.readFileSync(path.join(String(dir), "out", "renamed.wasm"))).toEqual(wasm);
    expect(listFiles(path.join(String(dir), "src"))).toEqual(["x.wasm"]);
  });

  test("writes the bytes to stdout without --outdir or --outfile", async () => {
    using dir = tempDir("no-bundle-copy-stdout", { "src/x.wasm": wasm });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/x.wasm"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(Buffer.from(stdout)).toEqual(wasm);
    expect(exitCode).toBe(0);

    expect(listFiles(String(dir))).toEqual(["src/x.wasm"]);
  });

  test("leaves the file intact when --outdir . makes the output path the source path", async () => {
    using dir = tempDir("no-bundle-copy-in-place", { "x.wasm": wasm });

    const { stdout, stderr, exitCode } = await build(String(dir), ["./x.wasm", "--outdir", "."]);
    expect(stderr).toBe("");
    expect(stdout).toContain("x.wasm");
    expect(exitCode).toBe(0);

    expect(listFiles(String(dir))).toEqual(["x.wasm"]);
    expect(fs.readFileSync(path.join(String(dir), "x.wasm"))).toEqual(wasm);
  });

  // Root can read a mode 000 file, and Windows has no such mode bit.
  test.skipIf(isWindows || process.getuid?.() === 0)("fails the build when the file cannot be read", async () => {
    using dir = tempDir("no-bundle-copy-unreadable", { "src/x.wasm": wasm });
    fs.chmodSync(path.join(String(dir), "src", "x.wasm"), 0o000);

    const { stdout, stderr, exitCode } = await build(String(dir), ["./src/x.wasm", "--outdir=dist"]);
    expect(stderr).toContain('error: EACCES reading "src/x.wasm"');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);

    expect(fs.existsSync(path.join(String(dir), "dist", "x.wasm"))).toBe(false);
  });
});

describe("CLI argument error messages", () => {
  test("--format with an unrecognized value echoes the value back", async () => {
    using dir = tempDir("build-format-err", { "in.js": "console.log(1)" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--format=commonjs", "in.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: expect.stringContaining('--format: "commonjs"'),
    });
    expect(stderr).toContain("'esm', 'cjs', or 'iife'");
    expect(exitCode).toBe(1);
  });

  test("--loader without a ':' separator names the flag and the bad token", async () => {
    using dir = tempDir("build-loader-err", { "in.js": "console.log(1)" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--loader", "text", "in.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("--loader");
    expect(stderr).toContain('"text"');
    expect(stderr).toContain(".ext:loader");
    expect(exitCode).toBe(1);
  });

  test("--define without a separator names the flag and shows an example", async () => {
    using dir = tempDir("build-define-err", { "in.js": "console.log(FOO)" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--define", "FOO", "in.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("--define");
    expect(stderr).toContain('"FOO"');
    expect(stderr).toContain("key=value");
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("modules that fail to print", () => {
  // A TOML dotted header builds an object nested arbitrarily deep without
  // recursing in the parser, so the printer's recursion guard is the first
  // thing to hit it. The build must fail instead of emitting truncated
  // output with exit code 0.
  const deepToml = "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 1\n";

  test("bun build fails instead of emitting a truncated bundle", async () => {
    using dir = tempDir("build-deep-toml", { "deep.toml": deepToml });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "deep.toml"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Maximum call stack size exceeded while generating code for this file");
    expect(stderr).toContain("deep.toml");
    // No partial bundle: the printer used to bail mid-print and emit only
    // the trailing export stub.
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("bun build --no-bundle fails instead of emitting empty output", async () => {
    using dir = tempDir("build-deep-toml-nb", { "deep.toml": deepToml });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "deep.toml"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Maximum call stack size exceeded while generating code for "');
    expect(stderr).toContain("deep.toml");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("bun build fails instead of emitting a truncated stylesheet when CSS cannot be generated", async () => {
    // `composes` on a non-simple selector makes the CSS printer fail; the
    // whole stylesheet body used to be dropped while the build exited 0.
    using dir = tempDir("build-css-print-err", {
      "styles.module.css": ".b { color: blue }\n.a .c { composes: b; color: red }\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "styles.module.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Failed to generate CSS for this file");
    expect(stderr).toContain("styles.module.css");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
