import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, MAX_PATH_BYTES, normalizeBunSnapshot, tempDir, tmpdirSync } from "harness";
import fs, { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";

(describe.concurrent as any)(
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

// macOS and Windows read files on the IO pool by default.
test("exits with the build error when a build fails while the IO pool is still reading entry points", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 50; i++) {
    files[`f${i}.ts`] = `export const v${i} = ${i};\n`;
  }
  using dir = tempDir("build-missing-entry-io-pool", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./missing.ts", ...Object.keys(files).map(name => `./${name}`), "--outdir", "out"],
    env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" },
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stderr, dir)).toBe('error: ModuleNotFound resolving "./missing.ts" (entry point)');
  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/issues/9859
describe.concurrent("--no-bundle with --outdir", () => {
  test("writes a single entry point", async () => {
    using dir = tempDir("no-bundle-outdir-single", {
      "src/app.tsx": `export const App = () => <div>app</div>;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/app.tsx", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("app.js");
    expect(exitCode).toBe(0);

    const out = await Bun.file(path.join(String(dir), "dist", "app.js")).text();
    expect(out).toContain("jsx");
    expect(out).toContain("app");
  });

  test("reports the size of the written file", async () => {
    using dir = tempDir("no-bundle-outdir-size", {
      "src/app.js": `console.log(1);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/app.js", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/app\.js\s+16 bytes/);
    expect(exitCode).toBe(0);

    const out = await Bun.file(path.join(String(dir), "dist", "app.js")).text();
    expect(out).toBe("console.log(1);\n");
  });

  test("writes multiple entry points", async () => {
    using dir = tempDir("no-bundle-outdir-multi", {
      "src/main.tsx": `import { App } from "./app";\nexport const Main = () => <div><App /></div>;\n`,
      "src/app.tsx": `export const App = () => <div>app</div>;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/main.tsx", "./src/app.tsx", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("main.js");
    expect(stdout).toContain("app.js");
    expect(exitCode).toBe(0);

    expect(fs.readdirSync(path.join(String(dir), "dist")).sort()).toEqual(["app.js", "main.js"]);

    const main = await Bun.file(path.join(String(dir), "dist", "main.js")).text();
    const app = await Bun.file(path.join(String(dir), "dist", "app.js")).text();
    expect(main).toContain('from "./app"');
    expect(app).toContain("app");
  });

  test("preserves nested directory structure relative to the source root", async () => {
    using dir = tempDir("no-bundle-outdir-nested", {
      "src/main.ts": `export const main = 1;\n`,
      "src/nested/deep.ts": `export const deep = 2;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/main.ts", "./src/nested/deep.ts", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const main = await Bun.file(path.join(String(dir), "dist", "main.js")).text();
    const deep = await Bun.file(path.join(String(dir), "dist", "nested", "deep.js")).text();
    expect(main).toContain("main");
    expect(deep).toContain("deep");
    expect(stdout).toContain("main.js");
    expect(stdout).toContain("nested/deep.js");
  });

  test("creates nested directories for a single entry point with --root", async () => {
    using dir = tempDir("no-bundle-outdir-root", {
      "src/nested/deep.ts": `export const deep = 2;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--root=.", "./src/nested/deep.ts", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const deep = await Bun.file(path.join(String(dir), "dist", "src", "nested", "deep.js")).text();
    expect(deep).toContain("deep");
    expect(stdout).toContain("src/nested/deep.js");
  });

  test("writes entry points that share a subdirectory under --root", async () => {
    using dir = tempDir("no-bundle-outdir-shared-subdir", {
      "src/a.ts": `export const a = 1;\n`,
      "src/b.ts": `export const b = 2;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--root=.", "./src/a.ts", "./src/b.ts", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("src/a.js");
    expect(stdout).toContain("src/b.js");
    expect(exitCode).toBe(0);

    expect(fs.readdirSync(path.join(String(dir), "dist"), { recursive: true }).sort()).toEqual([
      "src",
      path.join("src", "a.js"),
      path.join("src", "b.js"),
    ]);
  });

  test("rejects two entry points that map to the same output path", async () => {
    using dir = tempDir("no-bundle-outdir-collision", {
      "src/app.ts": `export const a = 1;\n`,
      "src/app.js": `export const b = 2;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/app.ts", "./src/app.js", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: Multiple files share the same output path
        ./app.js:
          from input src/app.ts
          from input src/app.js


      note: entry naming is '[dir]/[name].[ext]', consider adding '[hash]' to make filenames unique"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);

    expect(fs.existsSync(path.join(String(dir), "dist", "app.js"))).toBe(false);
  });

  test.each([
    ["browser", []],
    ["bun", ["--target=bun"]],
    ["node", ["--target=node"]],
  ])("fills [target] in --entry-naming with %s", async (expected, targetArgs) => {
    using dir = tempDir("no-bundle-outdir-target", {
      "app.ts": `export const app = 1;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--no-bundle",
        ...targetArgs,
        "./app.ts",
        "--outdir=dist",
        "--entry-naming",
        "[target]/[name].[ext]",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain(`${expected}/app.js`);
    expect(exitCode).toBe(0);

    expect(fs.readdirSync(path.join(String(dir), "dist"))).toEqual([expected]);
    expect(fs.readdirSync(path.join(String(dir), "dist", expected))).toEqual(["app.js"]);
  });

  test("respects --entry-naming", async () => {
    using dir = tempDir("no-bundle-outdir-naming", {
      "src/app.ts": `export const app = 1;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./src/app.ts", "--outdir=dist", "--entry-naming", "[name].mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("app.mjs");
    expect(exitCode).toBe(0);

    const out = await Bun.file(path.join(String(dir), "dist", "app.mjs")).text();
    expect(out).toContain("app");
  });

  test("fills [hash] in --entry-naming with distinct values per entry", async () => {
    using dir = tempDir("no-bundle-outdir-hash", {
      "a.ts": `export const a = 1;\n`,
      "b.ts": `export const b = 2;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--no-bundle",
        "./a.ts",
        "./b.ts",
        "--outdir=dist",
        "--entry-naming",
        "[name]-[hash].[ext]",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const files = fs.readdirSync(path.join(String(dir), "dist")).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^a-[0-9a-z]+\.js$/);
    expect(files[1]).toMatch(/^b-[0-9a-z]+\.js$/);
    expect(stdout).toContain(files[0]);
    expect(stdout).toContain(files[1]);
  });

  test("names outputs by loader: js for transpiled data, css for the css loader", async () => {
    using dir = tempDir("no-bundle-outdir-loaders", {
      "config.toml": `key = 1\n`,
      "data.yaml": `key: 2\n`,
      "style.css": `.x { color: red; }\n`,
      "theme.pcss": `.y { color: blue; }\n`,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--no-bundle",
        "./config.toml",
        "./data.yaml",
        "./style.css",
        "./theme.pcss",
        "--loader",
        ".pcss:css",
        "--outdir=dist",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(fs.readdirSync(path.join(String(dir), "dist")).sort()).toEqual([
      "config.js",
      "data.js",
      "style.css",
      "theme.css",
    ]);
    expect(stdout).toContain("config.js");
    expect(stdout).toContain("data.js");
    expect(stdout).toContain("style.css");
    expect(stdout).toContain("theme.css");
    expect(stdout).not.toMatch(/\.css\s+0 /);
  });

  test.each(["base64", "dataurl"])("the %s loader is an error", async loader => {
    using dir = tempDir("no-bundle-" + loader, { "entry.bin": "ABC" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--loader", ".bin:" + loader, "./entry.bin"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`error: loader "${loader}" is not supported with --no-bundle`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("does not escape --outdir when an entry point is outside --root", async () => {
    using dir = tempDir("no-bundle-outdir-escape", {
      "src/a.ts": `export const a = 1;\n`,
      "other/b.ts": `export const b = 2;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--root=src", "./src/a.ts", "./other/b.ts", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(fs.existsSync(path.join(String(dir), "other", "b.js"))).toBe(false);
    const b = await Bun.file(path.join(String(dir), "dist", "_.._", "other", "b.js")).text();
    expect(b).toContain("b");
    expect(stdout).toContain("_.._/other/b.js");
  });

  // https://github.com/oven-sh/bun/issues/5206
  test("transpiles bare entry points in place with --outdir .", async () => {
    using dir = tempDir("no-bundle-outdir-in-place", {
      "a.ts": `console.log("hello world!" as string);\n`,
      "b.ts": `console.log("foo bar baz" as string);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "a.ts", "b.ts", "--no-bundle", "--outdir", "."],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("a.js");
    expect(stdout).toContain("b.js");
    expect(exitCode).toBe(0);

    expect(fs.readdirSync(String(dir)).sort()).toEqual(["a.js", "a.ts", "b.js", "b.ts"]);
    expect(await Bun.file(path.join(String(dir), "a.js")).text()).toContain('console.log("hello world!")');
    expect(await Bun.file(path.join(String(dir), "b.js")).text()).toContain('console.log("foo bar baz")');
  });

  test("refuses to transpile a .js entry point over itself with --outdir .", async () => {
    using dir = tempDir("no-bundle-outdir-overwrite", {
      "a.js": `console.log("hello world!");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "a.js", "--no-bundle", "--outdir", "."],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "a.js". Please choose a different outdir or outfile');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "a.js")).text()).toBe(`console.log("hello world!");\n`);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("bun build refuses to write an output over an input", () => {
  test("--outfile that names a dependency", async () => {
    using dir = tempDir("build-overwrite-dep", {
      "a.js": `import "./b.js";\nconsole.log("A");\n`,
      "b.js": `console.log("B-SOURCE");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./a.js", "--outfile", "b.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "b.js". Please choose a different outdir or outfile');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(`console.log("B-SOURCE");\n`);
    expect(exitCode).toBe(1);
  });

  test("--outfile that names the entry point", async () => {
    using dir = tempDir("build-overwrite-entry", {
      "a.js": `console.log("A");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./a.js", "--outfile", "a.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "a.js"');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "a.js")).text()).toBe(`console.log("A");\n`);
    expect(exitCode).toBe(1);
  });

  test("--outdir . with an HTML entry point", async () => {
    using dir = tempDir("build-overwrite-html", {
      "index.html": `<!doctype html><script type="module" src="./app.js"></script>\n`,
      "app.js": `console.log("APP");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.html", "--outdir", "."],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      'Refusing to overwrite input file "index.html". Please choose a different outdir or outfile',
    );
    expect(stdout).toBe("");
    expect(fs.readdirSync(String(dir)).sort()).toEqual(["app.js", "index.html"]);
    expect(await Bun.file(path.join(String(dir), "index.html")).text()).toBe(
      `<!doctype html><script type="module" src="./app.js"></script>\n`,
    );
    expect(exitCode).toBe(1);
  });

  test("--outdir .. from a subdirectory with an entry point in the parent", async () => {
    using dir = tempDir("build-overwrite-parent", {
      "index.js": `console.log("PARENT");\n`,
      "sub/index.js": `import "../index.js";\nconsole.log("SUB");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.js", "--outdir", ".."],
      env: bunEnv,
      cwd: path.join(String(dir), "sub"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Refusing to overwrite input file");
    expect(stderr).toContain("index.js");
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "index.js")).text()).toBe(`console.log("PARENT");\n`);
    expect(exitCode).toBe(1);
  });

  // `a.ts` imports "./b.js". The first build writes `src/b.js`, and the second build reads it.
  test("--outdir that holds the sources, built twice", async () => {
    const files = {
      "src/a.ts": `import { b } from "./b.js";\nconsole.log(b);\n`,
      "src/b.ts": `export const b: number = 1;\n`,
    };
    using dir = tempDir("build-overwrite-in-place-twice", files);

    async function build() {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/a.ts", "./src/b.ts", "--outdir", "src"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }

    expect(await build()).toEqual({ stderr: "", exitCode: 0 });
    const written = await Bun.file(path.join(String(dir), "src", "b.js")).text();
    expect(await build()).toEqual({
      stderr: 'error: Refusing to overwrite input file "src/b.js". Please choose a different outdir or outfile\n',
      exitCode: 1,
    });
    expect(await Bun.file(path.join(String(dir), "src", "b.js")).text()).toBe(written);
    expect(fs.readdirSync(path.join(String(dir), "src")).sort()).toEqual(["a.js", "a.ts", "b.js", "b.ts"]);
  });

  // Nothing is in a directory that does not exist yet, but this output name leaves it.
  test("an output name that leaves an --outdir that does not exist yet", async () => {
    using dir = tempDir("build-overwrite-leaves-new-outdir", {
      "src/app.js": `console.log("APP");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out", "--entry-naming", "../src/[name].[ext]"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "src/app.js"');
    expect(stdout).toBe("");
    expect(fs.readdirSync(String(dir))).toEqual(["src"]);
    expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(`console.log("APP");\n`);
    expect(exitCode).toBe(1);
  });

  test("--compile --target=browser with an HTML entry point and no --outdir", async () => {
    using dir = tempDir("build-overwrite-standalone-html", {
      "index.html": `<!doctype html><script type="module" src="./app.js"></script>\n`,
      "app.js": `console.log("APP");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--target=browser", "./index.html"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "index.html"');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "index.html")).text()).toBe(
      `<!doctype html><script type="module" src="./app.js"></script>\n`,
    );
    expect(exitCode).toBe(1);
  });

  // On Windows the executable gets an .exe suffix, so it cannot collide with the entry point.
  test.skipIf(isWindows)("--compile with an --outfile that names the entry point", async () => {
    using dir = tempDir("build-overwrite-compile", {
      "app.js": `console.log("APP");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./app.js", "--outfile", "app.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "app.js". Please choose a different outdir or outfile');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "app.js")).text()).toBe(`console.log("APP");\n`);
    expect(exitCode).toBe(1);
  });

  // On Windows the executable gets an .exe suffix, so it cannot collide with the asset.
  test.skipIf(isWindows)("--compile with an --outfile that names an embedded --asset file", async () => {
    using dir = tempDir("build-overwrite-compile-asset", {
      "app.js": `console.log("APP");\n`,
      "assets/cli": `ASSET\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./app.js", "--asset", "assets", "--outfile", "assets/cli"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "assets/cli"');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "assets", "cli")).text()).toBe(`ASSET\n`);
    expect(exitCode).toBe(1);
  });

  test("--compile with a --metafile that names an embedded --asset file", async () => {
    using dir = tempDir("build-overwrite-compile-asset-metafile", {
      "app.js": `console.log("APP");\n`,
      "assets/meta.json": `{ "asset": true }\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./app.js", "--asset", "assets", "--metafile=assets/meta.json"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      'Refusing to overwrite input file "assets/meta.json". Please choose a different metafile path',
    );
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "assets", "meta.json")).text()).toBe(`{ "asset": true }\n`);
    expect(exitCode).toBe(1);
  });

  test("Bun.build with compile assets and a metafile path that names one of them", async () => {
    using dir = tempDir("build-api-overwrite-compile-asset-metafile", {
      "app.js": `console.log("APP");\n`,
      "assets/meta.json": `{ "asset": true }\n`,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./app.js"],
          compile: { outfile: "app", assets: ["./assets"] },
          outdir: "./out",
          metafile: "../assets/meta.json",
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
    expect(JSON.parse(stdout)).toEqual({
      success: false,
      logs: [
        expect.stringContaining(
          'Refusing to overwrite input file "assets/meta.json". Please choose a different metafile path',
        ),
      ],
    });
    expect(await Bun.file(path.join(String(dir), "assets", "meta.json")).text()).toBe(`{ "asset": true }\n`);
    expect(exitCode).toBe(0);
  });

  // A --bytecode-order file is read by the build and is not in the module graph.
  const orderFile = `v2\nF 0123456789abcdef\n`;

  // On Windows the executable gets an .exe suffix, so it cannot collide with the order file.
  test.skipIf(isWindows)("--compile with an --outfile that names a --bytecode-order file", async () => {
    using dir = tempDir("build-overwrite-compile-order", {
      "app.js": `console.log("APP");\n`,
      "app.order": orderFile,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--bytecode-order=app.order",
        "./app.js",
        "--outfile",
        "app.order",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "app.order"');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "app.order")).text()).toBe(orderFile);
    expect(exitCode).toBe(1);
  });

  test("--compile with a --metafile that names a --bytecode-order file", async () => {
    using dir = tempDir("build-overwrite-compile-order-metafile", {
      "app.js": `console.log("APP");\n`,
      "app.order": orderFile,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--bytecode-order=app.order",
        "./app.js",
        "--metafile=app.order",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "app.order"');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "app.order")).text()).toBe(orderFile);
    expect(exitCode).toBe(1);
  });

  test("Bun.build with compile.bytecodeOrder and a metafile path that names the order file", async () => {
    using dir = tempDir("build-api-overwrite-compile-order-metafile", {
      "app.js": `console.log("APP");\n`,
      "app.order": orderFile,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./app.js"],
          bytecode: true,
          compile: { outfile: "app", bytecodeOrder: "app.order" },
          outdir: "./out",
          metafile: "../app.order",
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
    // The order file names no function of this build, which is a warning in the logs.
    expect(JSON.parse(stdout)).toEqual({
      success: false,
      logs: expect.arrayContaining([expect.stringContaining('Refusing to overwrite input file "app.order"')]),
    });
    expect(await Bun.file(path.join(String(dir), "app.order")).text()).toBe(orderFile);
    expect(exitCode).toBe(0);
  });

  test("--metafile that names an input", async () => {
    using dir = tempDir("build-overwrite-metafile", {
      "a.js": `import data from "./data.json";\nconsole.log(data);\n`,
      "data.json": `{ "source": true }\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./a.js", "--outdir", "out", "--metafile=data.json"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "data.json". Please choose a different metafile path');
    expect(await Bun.file(path.join(String(dir), "data.json")).text()).toBe(`{ "source": true }\n`);
    // The refusal comes before the first write, so no chunk is on disk.
    expect(fs.readdirSync(String(dir)).sort()).toEqual(["a.js", "data.json"]);
    expect(exitCode).toBe(1);
  });

  test("a refused --outfile leaves no metafile behind", async () => {
    using dir = tempDir("build-overwrite-no-metafile", {
      "a.js": `import "./b.js";\nconsole.log("A");\n`,
      "b.js": `console.log("B-SOURCE");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./a.js", "--outfile", "b.js", "--metafile=meta.json"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "b.js"');
    expect(fs.readdirSync(String(dir)).sort()).toEqual(["a.js", "b.js"]);
    expect(exitCode).toBe(1);
  });

  // The output path and the input path differ as strings but name the same file.
  // Creating a symlink needs a privilege on Windows.
  describe.skipIf(isWindows)("through a symlink", () => {
    const files = {
      "src/app.js": `import { v } from "./lib.js";\nconsole.log(v);\n`,
      "src/lib.js": `export const v = 42;\n`,
    };

    test("--outdir is a symlink to the source directory", async () => {
      using dir = tempDir("build-overwrite-symlink-outdir", files);
      fs.symlinkSync("src", path.join(String(dir), "out"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/app.js"');
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(exitCode).toBe(1);
    });

    test("--outfile goes through a symlinked parent directory", async () => {
      using dir = tempDir("build-overwrite-symlink-parent", { ...files, "real/.keep": "" });
      fs.symlinkSync("../src", path.join(String(dir), "real", "link"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outfile", "real/link/app.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/app.js"');
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(exitCode).toBe(1);
    });

    test("a directory under --outdir is a symlink to the source directory", async () => {
      using dir = tempDir("build-overwrite-symlink-subdir", { ...files, "out/.keep": "" });
      fs.symlinkSync("../src", path.join(String(dir), "out", "src"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out", "--root", "."],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/app.js"');
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(exitCode).toBe(1);
    });

    test("a symlink to an input is at the output path, under a symlinked directory", async () => {
      using dir = tempDir("build-overwrite-symlink-subdir-leaf", {
        ...files,
        "out/.keep": "",
        "elsewhere/.keep": "",
      });
      fs.symlinkSync("../elsewhere", path.join(String(dir), "out", "src"));
      fs.symlinkSync("../src/lib.js", path.join(String(dir), "elsewhere", "app.js"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out", "--root", "."],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/lib.js"');
      expect(await Bun.file(path.join(String(dir), "src", "lib.js")).text()).toBe(files["src/lib.js"]);
      expect(exitCode).toBe(1);
    });

    // The executable is moved into place with a rename, which replaces the link and not its target.
    test("--compile over a symlink to the entry point replaces the link", async () => {
      using dir = tempDir("build-compile-over-symlink", { ...files, "bin/.keep": "" });
      fs.symlinkSync("../src/app.js", path.join(String(dir), "bin", "cli"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "./src/app.js", "--outfile", "bin/cli"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("Refusing to overwrite");
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(fs.lstatSync(path.join(String(dir), "bin", "cli")).isSymbolicLink()).toBe(false);
      expect(exitCode).toBe(0);
    });

    test("a symlink to an input is already at the output path", async () => {
      using dir = tempDir("build-overwrite-symlink-leaf", { ...files, "out/.keep": "" });
      fs.symlinkSync("../src/lib.js", path.join(String(dir), "out", "app.js"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/lib.js"');
      expect(await Bun.file(path.join(String(dir), "src", "lib.js")).text()).toBe(files["src/lib.js"]);
      expect(exitCode).toBe(1);
    });

    test("a symlink to an input is at an output path that leaves an --outdir that does not exist yet", async () => {
      using dir = tempDir("build-overwrite-symlink-leaves-new-outdir", files);
      fs.symlinkSync("lib.js", path.join(String(dir), "src", "link.js"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out", "--entry-naming", "../src/link.[ext]"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/lib.js"');
      expect(await Bun.file(path.join(String(dir), "src", "lib.js")).text()).toBe(files["src/lib.js"]);
      expect(exitCode).toBe(1);
    });

    test("a new --outdir under a symlink to the source directory, and an output name that leaves it", async () => {
      using dir = tempDir("build-overwrite-new-outdir-under-symlink", files);
      fs.symlinkSync("src", path.join(String(dir), "alias"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "alias/new", "--entry-naming", "../lib.[ext]"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/lib.js"');
      expect(await Bun.file(path.join(String(dir), "src", "lib.js")).text()).toBe(files["src/lib.js"]);
      expect(exitCode).toBe(1);
    });

    // The kernel resolves a symlink before the `..` after it. `link` is a symlink to src/inner, so `link/..` is src.
    for (const [args, input] of [
      [["--outdir", "link/.."], "src/app.js"],
      [["--outfile", "link/../app.js"], "src/app.js"],
      [["--outdir", "dist", "--metafile=link/../lib.js"], "src/lib.js"],
    ] as const) {
      test(`${args.join(" ")} goes up from a symlink into the source directory`, async () => {
        using dir = tempDir("build-overwrite-dotdot-after-symlink", { ...files, "src/inner/.keep": "" });
        fs.symlinkSync("src/inner", path.join(String(dir), "link"));

        await using proc = Bun.spawn({
          cmd: [bunExe(), "build", "./src/app.js", ...args],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toContain(`Refusing to overwrite input file "${input}"`);
        expect(await Bun.file(path.join(String(dir), input)).text()).toBe(files[input]);
        expect(fs.readdirSync(String(dir)).sort()).toEqual(["link", "src"]);
        expect(exitCode).toBe(1);
      });
    }

    test("--outdir that goes up from a symlink and holds no input is written", async () => {
      const app = `import { v } from "./lib.js";\nconsole.log(v);\n`;
      using dir = tempDir("build-outdir-dotdot-no-input", {
        "app.js": app,
        "lib.js": `export const v = 42;\n`,
        "sub/inner/.keep": "",
      });
      fs.symlinkSync("sub/inner", path.join(String(dir), "link"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./app.js", "--outdir", "link/.."],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("Refusing to overwrite");
      expect(await Bun.file(path.join(String(dir), "sub", "app.js")).text()).toContain("console.log(");
      expect(await Bun.file(path.join(String(dir), "app.js")).text()).toBe(app);
      expect(exitCode).toBe(0);
    });

    // `new` does not exist, so `new/../out` is `out`, which exists.
    test("--outdir names a missing directory before a `..`, and a symlink to an input is at the output path", async () => {
      using dir = tempDir("build-overwrite-missing-dotdot-leaf", { ...files, "out/.keep": "" });
      fs.symlinkSync("../src/lib.js", path.join(String(dir), "out", "app.js"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "new/../out"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/lib.js"');
      expect(await Bun.file(path.join(String(dir), "src", "lib.js")).text()).toBe(files["src/lib.js"]);
      expect(exitCode).toBe(1);
    });

    test("--outdir names a missing directory before a `..`, and then a symlink to the source directory", async () => {
      using dir = tempDir("build-overwrite-missing-dotdot-dir", files);
      fs.symlinkSync("src", path.join(String(dir), "out"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "new/../out"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/app.js"');
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(exitCode).toBe(1);
    });

    test("an output name goes up from a symlinked directory under --outdir", async () => {
      using dir = tempDir("build-overwrite-name-dotdot", { ...files, "src/inner/.keep": "", "out/.keep": "" });
      fs.symlinkSync("../src/inner", path.join(String(dir), "out", "sub"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out", "--entry-naming", "sub/../[name].[ext]"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "src/app.js"');
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(exitCode).toBe(1);
    });

    test("an output name that goes up from a symlinked directory and names no input is written", async () => {
      using dir = tempDir("build-name-dotdot-no-input", { ...files, "src/inner/.keep": "", "out/.keep": "" });
      fs.symlinkSync("../src/inner", path.join(String(dir), "out", "sub"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out", "--entry-naming", "sub/../built-[name].[ext]"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("Refusing to overwrite");
      expect(await Bun.file(path.join(String(dir), "src", "built-app.js")).text()).toContain("console.log(");
      expect(await Bun.file(path.join(String(dir), "src", "app.js")).text()).toBe(files["src/app.js"]);
      expect(exitCode).toBe(0);
    });

    test("a symlink to a file that is not an input is written through", async () => {
      using dir = tempDir("build-symlink-leaf-unrelated", { ...files, "out/.keep": "", "elsewhere.js": "old\n" });
      fs.symlinkSync("../elsewhere.js", path.join(String(dir), "out", "app.js"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("Refusing to overwrite");
      expect(await Bun.file(path.join(String(dir), "elsewhere.js")).text()).toContain("console.log(");
      expect(exitCode).toBe(0);
    });
  });

  test("a hard link to an input is already at the output path", async () => {
    using dir = tempDir("build-overwrite-hardlink-leaf", {
      "src/app.js": `import { v } from "./lib.js";\nconsole.log(v);\n`,
      "src/lib.js": `export const v = 42;\n`,
      "out/.keep": "",
    });
    fs.linkSync(path.join(String(dir), "src", "lib.js"), path.join(String(dir), "out", "app.js"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./src/app.js", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "src/lib.js"');
    expect(await Bun.file(path.join(String(dir), "src", "lib.js")).text()).toBe(`export const v = 42;\n`);
    expect(exitCode).toBe(1);
  });

  // On Windows the executable gets an .exe suffix, so it cannot collide with the entry point.
  test.skipIf(isWindows)("Bun.build with a compile outfile that names the entry point", async () => {
    using dir = tempDir("build-api-overwrite-compile", {
      "app.js": `console.log("APP");\n`,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./app.js"],
          compile: { outfile: "app.js" },
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
    expect(JSON.parse(stdout)).toEqual({
      success: false,
      logs: [
        expect.stringContaining(
          'Refusing to overwrite input file "app.js". Please choose a different outdir or outfile',
        ),
      ],
    });
    expect(await Bun.file(path.join(String(dir), "app.js")).text()).toBe(`console.log("APP");\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.build with compile, outdir and a metafile path that names an input", async () => {
    using dir = tempDir("build-api-overwrite-compile-metafile", {
      "a.js": `import data from "./data.json";\nconsole.log(data);\n`,
      "data.json": `{ "source": true }\n`,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./a.js"],
          compile: { outfile: "app" },
          outdir: "./out",
          metafile: "../data.json",
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
    expect(JSON.parse(stdout)).toEqual({
      success: false,
      logs: [
        expect.stringContaining(
          'Refusing to overwrite input file "data.json". Please choose a different metafile path',
        ),
      ],
    });
    expect(await Bun.file(path.join(String(dir), "data.json")).text()).toBe(`{ "source": true }\n`);
    expect(exitCode).toBe(0);
  });

  // Bun.build joins an absolute metafile path under outdir as plain segments.
  test("Bun.build with an absolute metafile path that lands on an input", async () => {
    using dir = tempDir("build-api-overwrite-absolute-metafile", {
      "a.js": `import data from "./data.json";\nconsole.log(data);\n`,
      "data.json": `{ "source": true }\n`,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./a.js"],
          outdir: "./out",
          metafile: "/../data.json",
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
    expect(JSON.parse(stdout)).toEqual({
      success: false,
      logs: [expect.stringContaining('Refusing to overwrite input file "data.json"')],
    });
    expect(await Bun.file(path.join(String(dir), "data.json")).text()).toBe(`{ "source": true }\n`);
    expect(exitCode).toBe(0);
  });

  // The build does not read an in-memory file from disk. The second run finds the output of the first run at its path.
  test("Bun.build writes an output at the path of an in-memory file, on every run", async () => {
    using dir = tempDir("build-api-in-memory-input", {
      "run.js": `
        const entry = require("node:path").join(process.cwd(), "entry.js");
        const results = [];
        for (let run = 0; run < 2; run++) {
          const result = await Bun.build({
            entrypoints: [entry],
            files: { [entry]: 'console.log("virtual");' },
            outdir: ".",
            throw: false,
          });
          results.push({ success: result.success, logs: result.logs.map(l => l.message) });
        }
        console.log(JSON.stringify(results));
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
    expect(JSON.parse(stdout)).toEqual([
      { success: true, logs: [] },
      { success: true, logs: [] },
    ]);
    expect(await Bun.file(path.join(String(dir), "entry.js")).text()).toContain('console.log("virtual")');
    expect(exitCode).toBe(0);
  });

  // Creating a symlink needs a privilege on Windows.
  test.skipIf(isWindows)("--compile with a --metafile that is a symlink to an embedded --asset file", async () => {
    using dir = tempDir("build-overwrite-compile-asset-metafile-link", {
      "app.js": `console.log("APP");\n`,
      "assets/meta.json": `{ "asset": true }\n`,
    });
    fs.symlinkSync("assets/meta.json", path.join(String(dir), "meta.json"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./app.js", "--asset", "assets", "--metafile=meta.json"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Refusing to overwrite input file "assets/meta.json"');
    expect(stdout).toBe("");
    expect(await Bun.file(path.join(String(dir), "assets", "meta.json")).text()).toBe(`{ "asset": true }\n`);
    expect(exitCode).toBe(1);
  });

  test("Bun.build with a metafile path that names an input", async () => {
    using dir = tempDir("build-api-overwrite-metafile", {
      "a.js": `import data from "./data.json";\nconsole.log(data);\n`,
      "data.json": `{ "source": true }\n`,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./a.js"],
          outdir: "./out",
          metafile: "../data.json",
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
      success: false,
      logs: [
        expect.stringContaining(
          'Refusing to overwrite input file "data.json". Please choose a different metafile path',
        ),
      ],
    });
    expect(await Bun.file(path.join(String(dir), "data.json")).text()).toBe(`{ "source": true }\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.build with outdir set to the source directory", async () => {
    using dir = tempDir("build-api-overwrite", {
      "a.js": `import "./b.js";\nconsole.log("A");\n`,
      "b.js": `console.log("B-SOURCE");\n`,
      "run.js": `
        const result = await Bun.build({
          entrypoints: ["./a.js"],
          outdir: ".",
          naming: "b.[ext]",
          throw: false,
        });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
      success: false,
      logs: [
        expect.stringContaining('Refusing to overwrite input file "b.js". Please choose a different outdir or outfile'),
      ],
    });
    expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(`console.log("B-SOURCE");\n`);
    expect(exitCode).toBe(0);
  });

  // On POSIX a `\` is a byte of a file name, not a separator.
  describe.skipIf(isWindows)("a backslash in an output path", () => {
    const files = {
      "a.js": `import "./b.js";\nconsole.log("A");\n`,
      "b.js": `console.log("B-SOURCE");\n`,
    };

    test.each([
      ["--outfile '\\b.js'", ["--outfile", "\\b.js"], "\\b.js"],
      ["--outdir 'out\\..'", ["--outdir", "out\\.."], "out\\../a.js"],
    ])("%s names no input and is written", async (_, args, output) => {
      using dir = tempDir("build-overwrite-backslash", files);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./a.js", ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(await Bun.file(path.join(String(dir), output)).text()).toContain("B-SOURCE");
      expect(await Bun.file(path.join(String(dir), "a.js")).text()).toBe(files["a.js"]);
      expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
      expect(exitCode).toBe(0);
    });

    test("an output name that goes up from a new --outdir with a backslash in its name", async () => {
      using dir = tempDir("build-overwrite-backslash-dotdot", files);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./a.js", "--outdir", "o\\p", "--entry-naming", "../[name].[ext]"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "a.js"');
      expect(stdout).toBe("");
      expect(await Bun.file(path.join(String(dir), "a.js")).text()).toBe(files["a.js"]);
      expect(exitCode).toBe(1);
    });

    test("a symlink to the source directory with a backslash in its name", async () => {
      using dir = tempDir("build-overwrite-backslash-link", { ...files, "out/.keep": "" });
      fs.symlinkSync("..", path.join(String(dir), "out", "l\\x"));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./a.js", "--outdir", "out", "--entry-naming", "l\\x/b.[ext]"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('Refusing to overwrite input file "b.js"');
      expect(stdout).toBe("");
      expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
      expect(exitCode).toBe(1);
    });
  });

  // The check reads every output path before the writer does. A path buffer does not hold these paths.
  describe("an output path that does not fit a path buffer", () => {
    const component = Buffer.alloc(200, "a").toString();
    const long = Array(Math.ceil((MAX_PATH_BYTES * 1.25) / 201))
      .fill(component)
      .join("/");
    // Fits a path buffer. Two of them do not.
    const half = Array(Math.ceil((MAX_PATH_BYTES * 0.6) / 201))
      .fill(component)
      .join("/");
    const name = Buffer.alloc(100, "n").toString();
    const short = Buffer.alloc(20, "n").toString();
    const files = {
      "a.js": `import "./b.js";\nconsole.log("A");\n`,
      "b.js": `console.log("B-SOURCE");\n`,
      "assets/one.txt": `ASSET\n`,
    };

    /** Creates a directory under `base` whose absolute path is `length` bytes, and returns its path relative to `base`. */
    function deepDir(base: string, length: number): string {
      let rest = length - base.length - 1;
      const names: string[] = [];
      for (; rest > 202; rest -= 201) names.push(component);
      names.push(Buffer.alloc(rest, "d").toString());
      const relative = names.join("/");
      fs.mkdirSync(path.join(base, relative), { recursive: true });
      return relative;
    }

    async function build(cwd: string, args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", ...args],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    // A Windows command line holds 32,767 characters.
    test.skipIf(isWindows).each([
      ["--outdir", ["--outdir", long], "Failed to create output directory"],
      ["--outfile", ["--outfile", long + "/out.js"], "could not open output directory"],
      ["--metafile", ["--outdir", "out", "--metafile=" + long + "/meta.json"], "could not open metafile"],
      [
        "--metafile under an --asset directory",
        ["--compile", "--asset", "assets", "--outfile", "app", "--metafile=assets/" + long + "/meta.json"],
        "could not open metafile",
      ],
    ])("%s that is too long fails as the writer reports it", async (_, args, message) => {
      using dir = tempDir("build-overwrite-long-path", files);

      const { stdout, stderr, exitCode } = await build(String(dir), ["./a.js", ...args]);
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
      expect(exitCode).toBe(1);
    });

    // Windows opens no path that is longer than its path buffer.
    test.skipIf(isWindows)("an output directory and an output name that only fit apart are written", async () => {
      using dir = tempDir("build-overwrite-long-joined-path", files);

      const { stderr, exitCode } = await build(String(dir), [
        "./a.js",
        "--outdir",
        half,
        "--entry-naming",
        half + "/[name].[ext]",
      ]);
      expect(stderr).toBe("");
      // The output is too deep to open by its absolute path. Move the inner half up.
      fs.renameSync(path.join(String(dir), half), path.join(String(dir), "inner"));
      expect(await Bun.file(path.join(String(dir), "inner", half, "a.js")).text()).toContain("B-SOURCE");
      expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
      expect(exitCode).toBe(0);
    });

    // The inputs are at the longest path that can be opened.
    describe.skipIf(isWindows)("from a working directory next to the path limit", () => {
      const deepest = MAX_PATH_BYTES - 1 - "/a.js".length;

      function fixture(dir: string, length: number, sources: Record<string, string>) {
        const cwd = path.join(dir, deepDir(dir, length));
        for (const [file, text] of Object.entries(sources)) fs.writeFileSync(path.join(cwd, file), text);
        return cwd;
      }

      test("--outfile that names a dependency is refused", async () => {
        using dir = tempDir("build-overwrite-deep-cwd-outfile", {});
        const cwd = fixture(String(dir), deepest, { "a.js": files["a.js"], "b.js": files["b.js"] });

        const { stdout, stderr, exitCode } = await build(cwd, ["./a.js", "--outfile", "b.js"]);
        expect(stderr).toContain('Refusing to overwrite input file "b.js"');
        expect(stdout).toBe("");
        expect(await Bun.file(path.join(cwd, "b.js")).text()).toBe(files["b.js"]);
        expect(exitCode).toBe(1);
      });

      test("--outdir out is written", async () => {
        using dir = tempDir("build-overwrite-deep-cwd-outdir", {});
        const cwd = fixture(String(dir), deepest, { "a.js": files["a.js"], "b.js": files["b.js"] });

        const { stderr, exitCode } = await build(cwd, ["./a.js", "--outdir", "out"]);
        expect(stderr).toBe("");
        // `out/a.js` is too deep to open by its absolute path.
        fs.renameSync(path.join(cwd, "out"), path.join(String(dir), "out"));
        expect(await Bun.file(path.join(String(dir), "out", "a.js")).text()).toContain("B-SOURCE");
        expect(await Bun.file(path.join(cwd, "b.js")).text()).toBe(files["b.js"]);
        expect(exitCode).toBe(0);
      });

      // `link/..` is `sub`. By name it is the working directory, which holds the inputs.
      test("--outdir that goes up from a symlink and holds no input is written", async () => {
        const app = `import { v } from "./lib.js";\nconsole.log(v);\n`;
        using dir = tempDir("build-overwrite-deep-cwd-dotdot", {});
        const cwd = fixture(String(dir), MAX_PATH_BYTES - 16, { "app.js": app, "lib.js": `export const v = 42;\n` });
        // `sub/innermost-dir` does not fit a path buffer, so it is made outside and moved in.
        fs.mkdirSync(path.join(String(dir), "sub", "innermost-dir"), { recursive: true });
        fs.renameSync(path.join(String(dir), "sub"), path.join(cwd, "sub"));
        fs.symlinkSync("sub/innermost-dir", path.join(cwd, "link"));

        const { stderr, exitCode } = await build(cwd, ["./app.js", "--outdir", "link/.."]);
        expect(stderr).toBe("");
        expect(await Bun.file(path.join(cwd, "sub", "app.js")).text()).toContain("console.log(");
        expect(await Bun.file(path.join(cwd, "app.js")).text()).toBe(app);
        expect(exitCode).toBe(0);
      });

      // `out/sub` is a symlink to `real`. The path of `real` fits a path buffer, and the path of a file in it does not.
      const real = Buffer.alloc(50, "r").toString();
      test.each([
        ["an output name under it", ["--outdir", "out", "--entry-naming", `sub/${short}.[ext]`], `${short}.js`],
        [
          "an output name that goes up from a new directory under it",
          ["--outdir", "out", "--entry-naming", `sub/new-directory/../${short}.[ext]`],
          `${short}.js`,
        ],
        ["a new --outdir under it", ["--outdir", `out/sub/new-directory/${short}`], `new-directory/${short}/a.js`],
        [
          "a new --outdir that goes up from a new directory under it",
          ["--outdir", `out/sub/new-directory/../${short}`],
          `${short}/a.js`,
        ],
      ])("a symlink to a directory next to the path limit: %s is written", async (_, args, output) => {
        using dir = tempDir("build-overwrite-deep-cwd-real-path", {});
        const cwd = fixture(String(dir), MAX_PATH_BYTES - 60, { "a.js": files["a.js"], "b.js": files["b.js"] });
        fs.mkdirSync(path.join(cwd, real));
        fs.mkdirSync(path.join(cwd, "out"));
        fs.symlinkSync("../" + real, path.join(cwd, "out", "sub"));

        const { stderr, exitCode } = await build(cwd, ["./a.js", ...args]);
        expect(stderr).toBe("");
        // The output is too deep to open by its absolute path.
        fs.renameSync(path.join(cwd, real), path.join(String(dir), "real"));
        expect(await Bun.file(path.join(String(dir), "real", output)).text()).toContain("B-SOURCE");
        expect(await Bun.file(path.join(cwd, "b.js")).text()).toBe(files["b.js"]);
        expect(exitCode).toBe(0);
      });
    });

    // `out/<deep>/L` is a symlink to the source directory. Its path fits a path buffer, and the path of a file in it does not.
    describe.skipIf(isWindows)("through a symlinked directory next to the path limit", () => {
      function fixture(dir: string) {
        const deep = deepDir(path.join(dir, "out"), MAX_PATH_BYTES - 3 - "/L".length);
        fs.symlinkSync(dir, path.join(dir, "out", deep, "L"));
        fs.linkSync(path.join(dir, "b.js"), path.join(dir, "hard.js"));
        fs.symlinkSync("b.js", path.join(dir, "soft.js"));
        return deep;
      }

      test.each([
        ["an input", "b"],
        ["a hard link to an input", "hard"],
        ["a symlink to an input", "soft"],
      ])("%s at the output path is not replaced", async (_, output) => {
        using dir = tempDir("build-overwrite-long-link", files);
        const deep = fixture(String(dir));

        const { stdout, stderr, exitCode } = await build(String(dir), [
          "./a.js",
          "--outdir",
          "out",
          "--entry-naming",
          `${deep}/L/${output}.[ext]`,
        ]);
        expect(stderr).toContain('Refusing to overwrite input file "b.js"');
        expect(stdout).toBe("");
        expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
        expect(exitCode).toBe(1);
      });

      test("a new file in the --outdir that the symlink names is written", async () => {
        using dir = tempDir("build-overwrite-long-link-root", files);
        const deep = fixture(String(dir));

        const { stderr, exitCode } = await build(String(dir), [
          "./a.js",
          "--outdir",
          `out/${deep}/L`,
          "--entry-naming",
          name + ".[ext]",
        ]);
        expect(stderr).toBe("");
        expect(await Bun.file(path.join(String(dir), name + ".js")).text()).toContain("B-SOURCE");
        expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
        expect(exitCode).toBe(0);
      });
    });

    test.each([
      ["a compile.outfile", `compile: { outfile: long }`, /^Failed to (open|create) output directory/],
      ["a compile.assets path", `compile: { outfile: "app", assets: [long] }`, /^failed to read asset/],
    ])("Bun.build with %s that is too long fails as the writer reports it", async (_, options, message) => {
      using dir = tempDir("build-api-overwrite-long-path", {
        ...files,
        "run.js": `
          const long = Array(${long.split("/").length}).fill(Buffer.alloc(200, "a").toString()).join("/");
          const result = await Bun.build({ entrypoints: ["./a.js"], ${options}, throw: false });
          console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
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
      expect(JSON.parse(stdout)).toEqual({ success: false, logs: [expect.stringMatching(message)] });
      expect(await Bun.file(path.join(String(dir), "b.js")).text()).toBe(files["b.js"]);
      expect(exitCode).toBe(0);
    });
  });
});

test.concurrent("bun build names every input that maps to a shared output path", async () => {
  using dir = tempDir("bundle-outdir-collision", {
    "a.ts": `export const a = 1;\n`,
    "b.ts": `export const b = 2;\n`,
    "c.ts": `export const c = 3;\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./a.ts", "./b.ts", "./c.ts", "--outdir=dist", "--entry-naming=same.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
    "error: Multiple files share the same output path
      ./same.js:
        from input a.ts
        from input b.ts
        from input c.ts


    note: entry naming is './same.js', consider adding '[hash]' to make filenames unique"
  `);
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

test.concurrent("bun build widens [hash] names that would otherwise collide", async () => {
  // 40 entry points under `[hash1]` naming cannot all differ in one character
  // (the alphabet has 32), so some names widen to 2+; none collide. The
  // chunks use a different width so that their names sort between the
  // entries' without hiding the entries' collisions from each other.
  const files: Record<string, string> = {};
  for (let i = 0; i < 40; i++) files[`e${i}.ts`] = `import("./s${i % 20}.js"); export const v = ${i};\n`;
  for (let i = 0; i < 20; i++) files[`s${i}.js`] = `export const s = ${i};\n`;
  using dir = tempDir("bundle-hash-widen", files);
  const entries = Object.keys(files).filter(f => f.startsWith("e"));

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      ...entries,
      "--splitting",
      "--outdir=dist",
      "--entry-naming=[hash1].[ext]",
      "--chunk-naming=c[hash3].[ext]",
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const names = fs.readdirSync(path.join(String(dir), "dist")).sort();
  // Entries print 1–3 characters, chunks `c` + 3 or more.
  const entryNames = names.filter(n => /^[0-9a-z]{1,3}\.js$/.test(n));
  expect(entryNames.length).toBe(40);
  expect(names.length - entryNames.length).toBeGreaterThanOrEqual(20);
  expect(names.every(n => /^c?[0-9a-z]{1,13}\.js$/.test(n))).toBe(true);
  expect(entryNames.some(n => n.length > "x.js".length)).toBe(true);
  expect(exitCode).toBe(0);
});

test("reports an empty entry point the same way with more than 8 entry points", async () => {
  // The message differs by platform, so compare with the output of a run with 2 entry points.
  const entries = Array.from({ length: 8 }, (_, i) => `e${i}.ts`);
  using dir = tempDir(
    "build-many-entries-empty-entry",
    Object.fromEntries(entries.map((name, i) => [name, `console.log(${i});`])),
  );

  async function build(entryPoints: string[], outdir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", `--outdir=${outdir}`, ...entryPoints, ""],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { firstStderrLine: stderr.split("\n")[0], exitCode };
  }

  const [two, nine] = await Promise.all([build(entries.slice(0, 1), "dist-2"), build(entries, "dist-9")]);
  expect(two.firstStderrLine).not.toBe("");
  expect(nine).toEqual(two);
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

  // Where "too deep" starts depends on the stack frames of the build, so this walks the depths around it.
  test("--define with a value nested deeper than the stack has room for is an error", async () => {
    using dir = tempDir("build-define-deep", { "in.js": "console.log(typeof FOO)" });
    // A Windows command line holds 32,767 characters.
    const depths = [250, 1000, 2000, 4000, 8000, 11_000, 12_000, 15_000, ...(isWindows ? [] : [30_000, 60_000])];
    const outcomes: string[] = [];
    for (const depth of depths) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--define",
          `FOO=${Buffer.alloc(depth, "[")}1${Buffer.alloc(depth, "]")}`,
          "in.js",
          "--outfile=out.js",
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      outcomes.push(
        exitCode === 0
          ? "built"
          : exitCode === 1 && stderr.includes("error: Maximum call stack size exceeded while generating code")
            ? "too deep to print"
            : exitCode === 1 && stderr.includes("error: JSON document is too deeply nested")
              ? "too deep to define"
              : `depth ${depth}: exit ${exitCode}\n${stderr.slice(-600)}`,
      );
    }

    const inOrder = ["built", "too deep to print", "too deep to define"];
    expect(outcomes.filter(outcome => !inOrder.includes(outcome))).toEqual([]);
    expect(outcomes).toEqual(outcomes.toSorted((a, b) => inOrder.indexOf(a) - inOrder.indexOf(b)));
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

describe.concurrent("diagnostic markup", () => {
  // Two composed classes from different files set the same property. The
  // diagnostic names the property and the class, and the message template
  // marks both names bold.
  const composesConflict = {
    "a.module.css": '.foo {\n  composes: bar from "./b.module.css";\n  color: red;\n}\n',
    "b.module.css": ".bar {\n  color: blue;\n}\n",
  };

  test("css composes conflict renders the bold names as ANSI when colors are on", async () => {
    using dir = tempDir("build-css-composes-color", composesConflict);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "a.module.css"],
      env: { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("The value of \x1b[1mcolor\x1b[0m in the class \x1b[1mfoo\x1b[0m is undefined.");
  });

  test("css composes conflict strips the markup when colors are off", async () => {
    using dir = tempDir("build-css-composes-plain", composesConflict);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "a.module.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("The value of color in the class foo is undefined.");
    expect(stderr).not.toContain("<b>");
    expect(stderr).not.toContain("\x1b[");
  });
});
