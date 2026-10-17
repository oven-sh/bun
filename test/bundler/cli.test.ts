import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, normalizeBunSnapshot, tempDir, tmpdirSync } from "harness";
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

// Without --root, the root is the directory that the entry point names share. Unfixed, every
// command here stopped with `ENOENT opening root directory` before it resolved the entry point.
// Not concurrent: side by side on a debug build, these tests reach the default timeout.
describe("bun build with an entry point name whose directory does not exist", () => {
  const run = async (cwd: string, ...args: string[]) => {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const failed = (stderr: string) => ({ stdout: "", stderr, exitCode: 1 });
  const notFound = (entry: string) => failed(`error: ModuleNotFound resolving "${entry}" (entry point)\n`);
  const pkg = {
    "node_modules/@scope/pkg/package.json": JSON.stringify({ name: "@scope/pkg", version: "1.0.0", main: "index.js" }),
    "node_modules/@scope/pkg/index.js": `console.log("scoped");`,
  };
  const bundled = '// node_modules/@scope/pkg/index.js\nconsole.log("scoped");\n';

  for (const [mode, commands] of [
    [
      "when it bundles",
      [
        ["build", "./nodir/x.ts"],
        ["build", "./nodir/x.ts", "--outfile=out.js"],
        ["build", "./nodir/x.ts", "--outdir=out"],
        ["build", "./nodir/x.ts", "--compile"],
      ],
    ],
    [
      "when it does not bundle",
      [
        ["build", "./nodir/x.ts", "--no-bundle"],
        ["build", "./nodir/x.ts", "--no-bundle", "--outdir=out"],
        ["install", "--analyze", "./nodir/x.ts"],
      ],
    ],
  ] as const) {
    test(`a missing file is reported by the resolver ${mode}`, async () => {
      using dir = tempDir("build-cli-missing-dir", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
      });
      const results = await Promise.all(commands.map(async args => [args.join(" "), await run(String(dir), ...args)]));
      expect(Object.fromEntries(results)).toEqual(
        Object.fromEntries(commands.map(args => [args.join(" "), notFound("./nodir/x.ts")])),
      );
      // Neither the directory of the entry point nor an output directory was created.
      expect(fs.readdirSync(String(dir))).toEqual(["package.json"]);
    });
  }

  test("a package builds", async () => {
    using dir = tempDir("build-cli-package-entry", pkg);
    const [toStdout, toOutdir, noBundle] = await Promise.all([
      run(String(dir), "build", "@scope/pkg"),
      run(String(dir), "build", "@scope/pkg", "--outdir=out"),
      run(String(dir), "build", "@scope/pkg", "--no-bundle"),
    ]);
    expect({ toStdout, noBundle }).toEqual({
      toStdout: { stdout: bundled, stderr: "", exitCode: 0 },
      noBundle: { stdout: 'console.log("scoped");\n', stderr: "", exitCode: 0 },
    });
    expect({ stderr: toOutdir.stderr, exitCode: toOutdir.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // The same place as with `--root .`.
    expect(await Bun.file(join(String(dir), "out", "node_modules", "@scope", "pkg", "index.js")).text()).toBe(bundled);
    expect(fs.readdirSync(String(dir)).sort()).toEqual(["node_modules", "out"]);
  });

  test("a package builds to --outfile, to bytecode, and to --outdir without bundling", async () => {
    using dir = tempDir("build-cli-package-entry-outfile", pkg);
    const [toOutfile, toBytecode, noBundle] = await Promise.all([
      run(String(dir), "build", "@scope/pkg", "--outfile=out.js"),
      run(String(dir), "build", "@scope/pkg", "--bytecode", "--target=bun", "--outdir=out"),
      run(String(dir), "build", "@scope/pkg", "--no-bundle", "--outdir=transpiled"),
    ]);
    const inOutdir = (outdir: string) => join(String(dir), outdir, "node_modules", "@scope", "pkg");
    expect(await Bun.file(join(String(dir), "out.js")).text()).toBe(bundled);
    expect(fs.readdirSync(inOutdir("out")).sort()).toEqual(["index.js", "index.js.jsc"]);
    expect(await Bun.file(join(inOutdir("transpiled"), "index.js")).text()).toBe('console.log("scoped");\n');
    expect(fs.readdirSync(String(dir)).sort()).toEqual(["node_modules", "out", "out.js", "transpiled"]);
    expect([toOutfile, toBytecode, noBundle].map(({ stderr, exitCode }) => ({ stderr, exitCode }))).toEqual(
      Array(3).fill({ stderr: "", exitCode: 0 }),
    );
  });

  // A debug build takes too long to copy itself.
  test.skipIf(isDebug)("a package compiles", async () => {
    using dir = tempDir("build-cli-package-entry-compile", pkg);
    const outfile = join(String(dir), isWindows ? "app.exe" : "app");
    const compiled = await run(String(dir), "build", "@scope/pkg", "--compile", `--outfile=${outfile}`);
    expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    await using app = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([app.stdout.text(), app.stderr.text(), app.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "scoped\n", stderr: "", exitCode: 0 });
  });

  test("no directory is created for output files that would go beside the entry point", async () => {
    // With more than one output file and no --outdir, the output goes beside the entry point.
    // That would create ./@scope, or ./data:text.
    using dir = tempDir("build-cli-package-entry-beside", pkg);
    const refused = (directory: string) =>
      failed(
        `error: Cannot write the output files next to the entry point: "${directory}" is not a directory. Use --outdir\n`,
      );
    const [linked, linkedToOutfile, dataUrl] = await Promise.all([
      run(String(dir), "build", "@scope/pkg", "--sourcemap=linked"),
      run(String(dir), "build", "@scope/pkg", "--outfile=dist/out.js", "--sourcemap=linked"),
      run(String(dir), "build", "data:text/javascript,console.log(1)", "--sourcemap=linked"),
    ]);
    expect({ linked, linkedToOutfile, dataUrl }).toEqual({
      linked: refused("@scope"),
      linkedToOutfile: refused("@scope"),
      dataUrl: refused("data:text"),
    });
    expect(fs.readdirSync(String(dir))).toEqual(["node_modules"]);
  });

  test("an output is not written over a file that it is built from", async () => {
    // From the working directory, an output of a package is named from a path in node_modules.
    const files = {
      ...pkg,
      // The CSS that index.tsx imports is built to src/index.css.
      "node_modules/@scope/styled/package.json": JSON.stringify({ name: "@scope/styled", main: "src/index.tsx" }),
      "node_modules/@scope/styled/src/index.tsx": `import "./index.css";`,
      "node_modules/@scope/styled/src/index.css": `.a { color: red }`,
    };
    using dir = tempDir("build-cli-package-entry-overwrite", files);
    const [toOutdir, transpiled, toOutfile, stylesheet] = await Promise.all([
      run(String(dir), "build", "@scope/pkg", "--outdir=."),
      run(String(dir), "build", "@scope/pkg", "--no-bundle", "--outdir=."),
      run(String(dir), "build", "@scope/pkg", "--outfile=node_modules/@scope/pkg/index.js"),
      run(String(dir), "build", "@scope/styled", "--outdir=."),
    ]);
    const refused = (input: string) =>
      failed(`error: Refusing to overwrite input file "node_modules/@scope/${input}"\n`);
    expect({ toOutdir, transpiled, toOutfile, stylesheet }).toEqual({
      toOutdir: refused("pkg/index.js"),
      transpiled: refused("pkg/index.js"),
      toOutfile: refused("pkg/index.js"),
      stylesheet: refused("styled/src/index.css"),
    });
    const inputs = Object.keys(files).map(file => fs.readFileSync(join(String(dir), file), "utf8"));
    expect(inputs).toEqual(Object.values(files));
    expect(fs.readdirSync(String(dir))).toEqual(["node_modules"]);
    expect(fs.readdirSync(join(String(dir), "node_modules", "@scope", "styled", "src")).sort()).toEqual([
      "index.css",
      "index.tsx",
    ]);
  });

  test("an entry point that does not resolve fails the build, and nothing is written", async () => {
    using dir = tempDir("build-cli-package-entry-unresolved", pkg);
    const [builtin, dataUrl, oneOfTwo, oneOfTwoBundled] = await Promise.all([
      run(String(dir), "build", "--no-bundle", "node:fs/promises", "--outdir=out"),
      run(String(dir), "build", "--no-bundle", "data:image/png;base64,AAAA", "--outdir=out"),
      run(String(dir), "build", "--no-bundle", "@scope/pkg", "@scope/missing", "--outdir=out"),
      run(String(dir), "build", "@scope/pkg", "@scope/missing", "--outdir=out"),
    ]);
    expect({ builtin, dataUrl, oneOfTwo, oneOfTwoBundled }).toEqual({
      builtin: failed('error: Cannot use "node:fs/promises" as an entry point: it resolves to a builtin module\n'),
      dataUrl: notFound("data:image/png;base64,AAAA"),
      oneOfTwo: notFound("@scope/missing"),
      oneOfTwoBundled: notFound("@scope/missing"),
    });
    expect(fs.readdirSync(String(dir))).toEqual(["node_modules"]);
  });

  test("--watch reports the failure and waits, as for a missing file in a directory that exists", async () => {
    using dir = tempDir("build-cli-package-entry-watch", pkg);
    // Unfixed, the process printed `ENOENT opening root directory` and exited.
    const firstLine = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--watch", ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const decoder = new TextDecoder();
      let stderr = "";
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        if (stderr.includes("\n")) break;
      }
      return stderr;
    };
    const [beside, missing] = await Promise.all([
      firstLine("@scope/pkg", "--sourcemap=linked"),
      firstLine("./nodir/x.ts"),
    ]);
    expect({ beside, missing }).toEqual({
      beside:
        'error: Cannot write the output files next to the entry point: "@scope" is not a directory. Use --outdir\n',
      missing: 'error: ModuleNotFound resolving "./nodir/x.ts" (entry point)\n',
    });
    expect(fs.readdirSync(String(dir))).toEqual(["node_modules"]);
  });

  // The bound on Linux: the working directory and the name together reach half of PATH_MAX.
  test.skipIf(!isLinux)("a name that can overflow a path buffer fails at the root", async () => {
    using dir = tempDir("build-cli-long-entry", { "package.json": JSON.stringify({ name: "app", version: "1.0.0" }) });
    const cwd = realpathSync(String(dir));
    const named = (length: number) => "nodir/" + Buffer.alloc(length - "nodir/.js".length, "b").toString() + ".js";
    const [atTheBound, underTheBound] = await Promise.all([
      run(cwd, "build", named(2048 - cwd.length)),
      run(cwd, "build", named(2047 - cwd.length)),
    ]);
    underTheBound.stderr = underTheBound.stderr.replace(named(2047 - cwd.length), "<name>");
    expect({ atTheBound, underTheBound }).toEqual({
      atTheBound: failed('ENOENT opening root directory "nodir"\n'),
      underTheBound: notFound("<name>"),
    });
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
