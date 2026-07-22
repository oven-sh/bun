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
      // bun build ./index.ts --outdir ./dist --target node
      const { stderr, exited } = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
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
