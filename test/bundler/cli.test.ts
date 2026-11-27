import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  forEachLine,
  isLinux,
  isRoot,
  isWindows,
  normalizeBunSnapshot,
  substDrive,
  tempDir,
  tmpdirSync,
} from "harness";
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

test("log with an entry point below --root and an asset", async () => {
  using dir = tempDir("build-log-widths", {
    "src/a.js": `import file from "./long-name.bin"; console.log(file);`,
    "src/long-name.bin": "1",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./src/a.js", "--root=.", "--outdir=out", "--asset-naming=[name].[ext]", "--minify"],
    env: bunEnv,
    cwd: String(dir),
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.replace(/in \d+ms/g, "in {time}ms").replaceAll("\\", "/")).toMatchInlineSnapshot(`
    "Bundled 2 modules in {time}ms

      src/a.js        41 bytes  (entry point)
      long-name.bin   1 bytes   (asset)

    "
  `);
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows).each([
  ["a", "long-name.js  16 bytes"],
  ["a-b", "long-name.js   16 bytes"],
])("log with nine outputs, the first below %s", async (first, row) => {
  const names = [...Array.from({ length: 8 }, (_, i) => `${i ? "a-b" : first}/x${i}`), "long-name"];
  using dir = tempDir("build-log-nine", Object.fromEntries(names.map(name => [`${name}.js`, "console.log(1);"])));
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", ...names.map(name => `./${name}.js`), "--root=.", "--outdir=out", "--minify"],
    env: bunEnv,
    cwd: String(dir),
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain(row);
  expect(exitCode).toBe(0);
});

test.each([
  ["a/y", "file"],
  ["ab", isWindows ? "file" : "directory"],
])("--no-bundle ./%s/ takes the %s", async (name, expected) => {
  using dir = tempDir("no-bundle-trailing-slash", { [`${name}.js`]: `file();`, [`${name}/index.js`]: `directory();` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", `./${name}/`],
    env: bunEnv,
    cwd: String(dir),
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(`${expected}();\n`);
  expect(exitCode).toBe(0);
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

test("--outdir creates folders beside the working directory", async () => {
  using dir = tempDir("build-outdir-beside", {
    "project/entry.ts": `export const x: number = 1;\nconsole.log("built", x);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outdir", "../other/deep/dist"],
    env: bunEnv,
    cwd: path.join(String(dir), "project"),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const out = await Bun.file(path.join(String(dir), "other", "deep", "dist", "entry.js")).text();
  expect(out).toContain("built");
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

  test.skipIf(!isLinux)("closes the files it has read", async () => {
    using dir = tempDir("no-bundle-outdir-closes", { "src/a.ts": `console.log(1);`, "src/b.css": `a { color: red }` });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--watch", "./src/a.ts", "./src/b.css", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    // A build that fails keeps watching, so wait for whichever stream prints first.
    const first = await Promise.race([forEachLine(proc.stdout).next(), forEachLine(proc.stderr).next()]);
    expect(first.value).toStartWith("Transpiled");
    const open = fs.readdirSync(`/proc/${proc.pid}/fd`).flatMap(fd => {
      try {
        return fs.readlinkSync(`/proc/${proc.pid}/fd/${fd}`);
      } catch {
        return [];
      }
    });
    expect(open.length).toBeGreaterThan(0);
    expect(open.filter(target => /src\/(a\.ts|b\.css)$/.test(target))).toEqual([]);
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
});

// An entry point whose loader has nothing to transpile is copied: wasm, napi, sqlite, sh, and the
// file loader that every other extension falls back to.
describe.concurrent("--no-bundle with entry points that are copied", () => {
  // Not valid UTF-8. The two BOM fixtures start with the bytes that a loader of text strips or decodes.
  const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0xfe, 0x80]);
  const addon = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const sqlite = Buffer.from("SQLite format 3\0");
  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const utf8BomData = Buffer.concat([utf8Bom, Buffer.from("data")]);
  const utf16BomData = Buffer.from([0xff, 0xfe, 0x5a, 0x5a]);

  /** The time in the summary becomes `{time}`. */
  async function build(cwd: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", ...args],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replace(/in \d+ms/, "in {time}ms"), stderr, exitCode };
  }

  /** What `build` gives when it wrote these files. Each has a name, a number of bytes, and a kind if it is not an asset. */
  function wrote(...files: [name: string, bytes: number, kind?: "chunk"][]) {
    const rows = files.map(([name, bytes, kind = "asset"]) => [name, `${bytes} bytes`, kind]);
    const nameWidth = Math.max(...rows.map(row => row[0].length)) + 2;
    const sizeWidth = Math.max(...rows.map(row => row[1].length)) + 2;
    const lines = rows.map(([name, size, kind]) => `  ${name.padEnd(nameWidth)}${size.padEnd(sizeWidth)}(${kind})\n`);
    return { stdout: `Transpiled file in {time}ms\n\n${lines.join("")}\n`, stderr: "", exitCode: 0 };
  }

  /** Every file below `dir`, by its `/`-separated path. */
  function readTree(dir: string): Record<string, Buffer> {
    const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
    return Object.fromEntries(
      entries.map(entry => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(dir, file).replaceAll(path.sep, "/"), fs.readFileSync(file)];
      }),
    );
  }

  test("copies a .wasm entry point into --outdir and lists it in the summary", async () => {
    using dir = tempDir("no-bundle-copy-wasm", { "src/x.wasm": wasm });

    expect(await build(String(dir), ["./src/x.wasm", "--outdir=dist"])).toEqual({
      stdout: "Transpiled file in {time}ms\n\n  x.wasm  11 bytes  (asset)\n\n",
      stderr: "",
      exitCode: 0,
    });

    expect(readTree(String(dir))).toEqual({ "dist/x.wasm": wasm, "src/x.wasm": wasm });
  });

  test.each(["file", "wasm", "napi", "sqlite", "sqlite_embedded", "sh"])(
    "copies an entry point that --loader maps to %s",
    async loader => {
      using dir = tempDir("no-bundle-copy-loader", { "src/x.zz": wasm });

      expect(await build(String(dir), ["--loader", `.zz:${loader}`, "./src/x.zz", "--outdir=dist"])).toEqual(
        wrote(["x.zz", 11]),
      );

      expect(readTree(String(dir))).toEqual({ "dist/x.zz": wasm, "src/x.zz": wasm });
    },
  );

  test("refuses an entry point that --loader maps to html, as it refuses a .html entry point", async () => {
    using dir = tempDir("no-bundle-copy-html", { "src/x.zz": wasm });

    expect(await build(String(dir), ["--loader", ".zz:html", "./src/x.zz", "--outdir=dist"])).toEqual({
      stdout: "",
      stderr: "error: HTML imports are only supported when bundling\n",
      exitCode: 1,
    });

    expect(readTree(String(dir))).toEqual({ "src/x.zz": wasm });
  });

  test("copies every byte of each file, a BOM included", async () => {
    const files: Record<string, Buffer> = {
      "t.bin": utf16BomData,
      "v.bin": utf8BomData,
      "w.db": sqlite,
      "x.wasm": wasm,
      "y.node": addon,
      "z.png": png,
    };
    const names = Object.keys(files);
    using dir = tempDir("no-bundle-copy-bytes", Object.fromEntries(names.map(name => [`src/${name}`, files[name]])));

    expect(
      await build(String(dir), [...names.map(name => `./src/${name}`), "--loader", ".db:sqlite", "--outdir=dist"]),
    ).toEqual(wrote(...names.map((name): [string, number] => [name, files[name].length])));

    expect(readTree(path.join(String(dir), "dist"))).toEqual(files);
    expect(readTree(path.join(String(dir), "src"))).toEqual(files);
  });

  // On Windows `foo.` is another spelling of `foo`.
  test.each(["Makefile", ".env", "a.tar.gz", ...(isWindows ? [] : ["foo."])])("keeps the name %s", async name => {
    using dir = tempDir("no-bundle-copy-name", { [`src/${name}`]: png });

    expect(await build(String(dir), [`./src/${name}`, "--outdir=dist"])).toEqual(wrote([name, 9]));

    expect(readTree(String(dir))).toEqual({ [`dist/${name}`]: png, [`src/${name}`]: png });
  });

  // Windows has no execute bit.
  test.skipIf(isWindows)("keeps the execute bit of a copied file", async () => {
    using dir = tempDir("no-bundle-copy-mode", { "src/run.sh": "#!/bin/sh\necho hi\n", "src/data.bin": png });
    fs.chmodSync(path.join(String(dir), "src", "run.sh"), 0o755);
    fs.chmodSync(path.join(String(dir), "src", "data.bin"), 0o644);

    expect(await build(String(dir), ["./src/run.sh", "./src/data.bin", "--outdir=dist"])).toEqual(
      wrote(["run.sh", 18], ["data.bin", 9]),
    );

    const mode = (name: string) => fs.statSync(path.join(String(dir), "dist", name)).mode & 0o777;
    const allowed = 0o777 & ~process.umask();
    expect({ "run.sh": mode("run.sh"), "data.bin": mode("data.bin") }).toEqual({
      "run.sh": 0o755 & allowed,
      "data.bin": 0o644 & allowed,
    });
  });

  test("writes a copied file beside the transpiled files of the same build", async () => {
    const source = `export const a: number = 1;\n`;
    using dir = tempDir("no-bundle-copy-mixed", { "src/a.ts": source, "src/x.wasm": wasm });

    expect(await build(String(dir), ["./src/a.ts", "./src/x.wasm", "--outdir=dist"])).toEqual({
      stdout: "Transpiled file in {time}ms\n\n  a.js    20 bytes  (chunk)\n  x.wasm  11 bytes  (asset)\n\n",
      stderr: "",
      exitCode: 0,
    });

    expect(readTree(String(dir))).toEqual({
      "dist/a.js": Buffer.from("export const a = 1;\n"),
      "dist/x.wasm": wasm,
      "src/a.ts": Buffer.from(source),
      "src/x.wasm": wasm,
    });
  });

  test("keeps the directories below the common root, so files of one name do not collide", async () => {
    using dir = tempDir("no-bundle-copy-dirs", { "src/a/x.wasm": wasm, "src/b/x.wasm": png });

    expect(await build(String(dir), ["./src/a/x.wasm", "./src/b/x.wasm", "--outdir=dist"])).toEqual(
      wrote(["a/x.wasm", 11], ["b/x.wasm", 9]),
    );

    expect(readTree(path.join(String(dir), "dist"))).toEqual({ "a/x.wasm": wasm, "b/x.wasm": png });
  });

  test("creates the directories that --root implies", async () => {
    using dir = tempDir("no-bundle-copy-root", { "src/nested/x.wasm": wasm });

    expect(await build(String(dir), ["--root=.", "./src/nested/x.wasm", "--outdir=dist"])).toEqual(
      wrote(["src/nested/x.wasm", 11]),
    );

    expect(readTree(path.join(String(dir), "dist"))).toEqual({ "src/nested/x.wasm": wasm });
  });

  test("does not leave --outdir for an entry point outside --root", async () => {
    using dir = tempDir("no-bundle-copy-outside-root", { "src/a.wasm": wasm, "other/b.wasm": png });

    expect(await build(String(dir), ["--root=src", "./src/a.wasm", "./other/b.wasm", "--outdir=dist"])).toEqual(
      wrote(["a.wasm", 11], ["_.._/other/b.wasm", 9]),
    );

    expect(readTree(String(dir))).toEqual({
      "dist/_.._/other/b.wasm": png,
      "dist/a.wasm": wasm,
      "other/b.wasm": png,
      "src/a.wasm": wasm,
    });
  });

  test("fills [name], [ext] and a [hash] of the bytes in --entry-naming", async () => {
    const withBom = Buffer.concat([utf8Bom, wasm]);
    using dir = tempDir("no-bundle-copy-hash", { "a.wasm": wasm, "b.wasm": withBom, "c.wasm": wasm });

    const built = await build(String(dir), [
      "./a.wasm",
      "./b.wasm",
      "./c.wasm",
      "--outdir=dist",
      "--entry-naming",
      "[name]-[hash].[ext]",
    ]);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const written = readTree(path.join(String(dir), "dist"));
    const names = Object.keys(written).sort();
    expect(names).toEqual([
      expect.stringMatching(/^a-[0-9a-z]{8}\.wasm$/),
      expect.stringMatching(/^b-[0-9a-z]{8}\.wasm$/),
      expect.stringMatching(/^c-[0-9a-z]{8}\.wasm$/),
    ]);
    expect(built).toEqual(wrote([names[0], 11], [names[1], 14], [names[2], 11]));
    expect(names.map(name => written[name])).toEqual([wasm, withBom, wasm]);
    // The hash is of the file as it is, so the BOM changes it.
    const [a, b, c] = names.map(name => name.slice(2, -".wasm".length));
    expect({ sameBytes: c === a, otherBytes: b === a }).toEqual({ sameBytes: true, otherBytes: false });
  });

  test.each([
    ["browser", []],
    ["bun", ["--target=bun"]],
    ["node", ["--target=node"]],
  ])("fills [target] in --entry-naming with %s", async (expected, targetArgs) => {
    using dir = tempDir("no-bundle-copy-target", { "x.wasm": wasm });

    expect(
      await build(String(dir), [...targetArgs, "./x.wasm", "--outdir=dist", "--entry-naming", "[target]/[name].[ext]"]),
    ).toEqual(wrote([`${expected}/x.wasm`, 11]));

    expect(readTree(path.join(String(dir), "dist"))).toEqual({ [`${expected}/x.wasm`]: wasm });
  });

  test("copies to the path that --outfile names", async () => {
    using dir = tempDir("no-bundle-copy-outfile", { "src/x.wasm": wasm });

    expect(await build(String(dir), ["./src/x.wasm", "--outfile=out/renamed.wasm"])).toEqual(
      wrote(["renamed.wasm", 11]),
    );

    expect(readTree(String(dir))).toEqual({ "out/renamed.wasm": wasm, "src/x.wasm": wasm });
  });

  test("does not copy a file without --outdir or --outfile", async () => {
    using dir = tempDir("no-bundle-copy-no-output-path", { "x.wasm": wasm });

    expect(await build(String(dir), ["./x.wasm"])).toEqual({
      stdout: "",
      stderr: 'error: Must use --outdir or --outfile to copy "x.wasm"\n',
      exitCode: 1,
    });

    expect(readTree(String(dir))).toEqual({ "x.wasm": wasm });
  });

  test("names a copied file with --entry-naming, not with --asset-naming or --chunk-naming", async () => {
    const source = `export const a: number = 1;\n`;
    using dir = tempDir("no-bundle-copy-naming-flags", { "src/a.ts": source, "src/x.wasm": wasm });

    const others = ["--asset-naming", "assets/[name]-[hash].[ext]", "--chunk-naming", "chunks/[name]-[hash].[ext]"];
    expect(await build(String(dir), ["./src/a.ts", "./src/x.wasm", "--outdir=other", ...others])).toEqual(
      wrote(["a.js", 20, "chunk"], ["x.wasm", 11]),
    );
    expect(
      await build(String(dir), ["./src/a.ts", "./src/x.wasm", "--outdir=entry", "--entry-naming", "[name].mjs"]),
    ).toEqual(wrote(["a.mjs", 20, "chunk"], ["x.mjs", 11]));

    const transpiled = Buffer.from("export const a = 1;\n");
    expect(readTree(String(dir))).toEqual({
      "entry/a.mjs": transpiled,
      "entry/x.mjs": wasm,
      "other/a.js": transpiled,
      "other/x.wasm": wasm,
      "src/a.ts": Buffer.from(source),
      "src/x.wasm": wasm,
    });
  });

  /** `src/x.wasm` with an old modification time. A write sets the time, also when it writes the same bytes. */
  function oldSource(dir: string) {
    const file = path.join(dir, "src", "x.wasm");
    fs.utimesSync(file, 1_600_000_000, 1_600_000_000);
    const inode = fs.statSync(file).ino;
    return () => {
      const now = fs.statSync(file);
      return { bytes: fs.readFileSync(file), sameInode: now.ino === inode, mtimeMs: now.mtimeMs };
    };
  }
  const untouched = { bytes: wasm, sameInode: true, mtimeMs: 1_600_000_000_000 };

  // Each row: the working directory, then the arguments. The file is `src/x.wasm`.
  test.each([
    ["src", ["./x.wasm", "--outdir", "."]],
    [".", ["./src/x.wasm", "--outdir", "src"]],
    [".", ["./src/x.wasm", "--outdir=./src/"]],
    ["src", ["./x.wasm", "--outdir", "../src"]],
    [".", ["./src/x.wasm", "--outfile", "./src/x.wasm"]],
    [".", ["./src/x.wasm", "--outdir", "src", "--entry-naming", "[name].wasm"]],
  ])("does not write a file onto itself: in %s, %p", async (cwd, args) => {
    using dir = tempDir("no-bundle-copy-in-place", { "src/x.wasm": wasm });
    const source = oldSource(String(dir));

    expect(await build(path.join(String(dir), cwd), args)).toEqual(wrote(["x.wasm", 11]));

    expect(readTree(String(dir))).toEqual({ "src/x.wasm": wasm });
    expect(source()).toEqual(untouched);
  });

  // Each row: what else the directory has, then the arguments. The output path is another spelling of `src/x.wasm`.
  // Windows needs a privilege for a symbolic link.
  test.skipIf(isWindows).each<[string, (dir: string) => void, string[]]>([
    ["a link to its directory as --outdir", dir => fs.symlinkSync("src", path.join(dir, "out")), ["--outdir", "out"]],
    [
      "a link to its directory in --outfile",
      dir => fs.symlinkSync("src", path.join(dir, "out")),
      ["--outfile", "out/x.wasm"],
    ],
    [
      "a second link to the file",
      dir => {
        fs.mkdirSync(path.join(dir, "dist"));
        fs.linkSync(path.join(dir, "src", "x.wasm"), path.join(dir, "dist", "x.wasm"));
      },
      ["--outdir", "dist"],
    ],
    [
      "a symbolic link to the file",
      dir => {
        fs.mkdirSync(path.join(dir, "dist"));
        fs.symlinkSync(path.join("..", "src", "x.wasm"), path.join(dir, "dist", "x.wasm"));
      },
      ["--outdir", "dist"],
    ],
    ["a `..` in --outdir", dir => fs.mkdirSync(path.join(dir, "a")), ["--outdir", "a/../src"]],
    ["a `..` in --entry-naming", () => {}, ["--outdir", "dist", "--entry-naming", "../src/[name].[ext]"]],
  ])("does not write a file onto itself through %s", async (_, prepare, args) => {
    using dir = tempDir("no-bundle-copy-in-place-alias", { "src/x.wasm": wasm });
    prepare(String(dir));
    const source = oldSource(String(dir));

    const name = args.includes("--entry-naming") ? "../src/x.wasm" : "x.wasm";
    expect(await build(String(dir), ["./src/x.wasm", ...args])).toEqual(wrote([name, 11]));

    expect(fs.readdirSync(path.join(String(dir), "src"))).toEqual(["x.wasm"]);
    expect(source()).toEqual(untouched);
  });

  // Each row reads like a path to `src/x.wasm`. With `link` for `real/sub`, it is `real/src/x.wasm`.
  // Windows removes `..` from a path before it follows a link.
  test.skipIf(isWindows).each([
    ["--outdir", ["--outdir", "link/../src"]],
    ["--entry-naming", ["--outdir", "link", "--entry-naming", "../src/[name].[ext]"]],
  ])("writes the file when a `..` in %s follows a link to another directory", async (_, args) => {
    using dir = tempDir("no-bundle-copy-link", { "src/x.wasm": wasm });
    fs.mkdirSync(path.join(String(dir), "real", "sub"), { recursive: true });
    fs.symlinkSync(path.join("real", "sub"), path.join(String(dir), "link"));
    const source = oldSource(String(dir));

    const name = args.includes("--entry-naming") ? "../src/x.wasm" : "x.wasm";
    expect(await build(String(dir), ["./src/x.wasm", ...args])).toEqual(wrote([name, 11]));

    expect(readTree(String(dir))).toEqual({ "real/src/x.wasm": wasm, "src/x.wasm": wasm });
    expect(source()).toEqual(untouched);
  });

  test("writes the transpiled files of the same build onto their sources", async () => {
    using dir = tempDir("no-bundle-copy-in-place-mixed", {
      "src/a.js": `export   const a = 1 ;\n`,
      "src/s.css": `.x{color:red}\n`,
      "src/x.wasm": wasm,
    });
    const source = oldSource(String(dir));

    expect(await build(String(dir), ["./src/a.js", "./src/s.css", "./src/x.wasm", "--outdir", "src"])).toEqual({
      stdout:
        "Transpiled file in {time}ms\n\n  a.js    20 bytes  (chunk)\n  s.css   21 bytes  (chunk)\n  x.wasm  11 bytes  (asset)\n\n",
      stderr: "",
      exitCode: 0,
    });

    expect(readTree(String(dir))).toEqual({
      "src/a.js": Buffer.from("export const a = 1;\n"),
      "src/s.css": Buffer.from(".x {\n  color: red;\n}\n"),
      "src/x.wasm": wasm,
    });
    expect(source()).toEqual(untouched);
  });

  // The bundler calls a stylesheet an asset too. Its bytes are not those of its source.
  test("without --no-bundle, a stylesheet that is its own --outfile is written", async () => {
    using dir = tempDir("bundle-css-in-place", { "a.css": `.x{color:red}\n` });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./a.css", "--outfile", "./a.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.replace(/in \d+ms/, "in {time}ms"), stderr, exitCode }).toEqual({
      stdout: "Bundled 1 module in {time}ms\n\n  a.css  33 bytes  (asset)\n\n",
      stderr: "",
      exitCode: 0,
    });

    expect(readTree(String(dir))).toEqual({ "a.css": Buffer.from("/* a.css */\n.x {\n  color: red;\n}\n") });
  });

  // On Windows the working directory can be on a drive that `subst` made, or behind a junction.
  test.skipIf(!isWindows).each(["drive", "junction"])(
    "copies a file, and does not write it onto itself, in a working directory behind a %s",
    async through => {
      using dir = tempDir("no-bundle-copy-windows", { "w/src/x.wasm": wasm });
      using drive = substDrive(String(dir));
      fs.symlinkSync(path.join(String(dir), "w"), path.join(String(dir), "link"), "junction");
      const cwd = through === "drive" ? path.join(drive.root, "w") : path.join(String(dir), "link");
      const source = oldSource(path.join(String(dir), "w"));

      expect(await build(cwd, ["./src/x.wasm", "--outdir=out"])).toEqual(wrote(["x.wasm", 11]));
      expect(await build(cwd, ["./src/x.wasm", "--outdir", "src"])).toEqual(wrote(["x.wasm", 11]));

      expect(readTree(path.join(String(dir), "w"))).toEqual({ "out/x.wasm": wasm, "src/x.wasm": wasm });
      expect(source()).toEqual(untouched);
    },
  );

  // Root can write a file of mode 444, and Windows does not have the mode.
  test.skipIf(isWindows || isRoot)("accepts a read-only file whose output path is the file itself", async () => {
    using dir = tempDir("no-bundle-copy-read-only", { "x.wasm": wasm });
    fs.chmodSync(path.join(String(dir), "x.wasm"), 0o444);

    expect(await build(String(dir), ["./x.wasm", "--outdir", "."])).toEqual(wrote(["x.wasm", 11]));

    expect(readTree(String(dir))).toEqual({ "x.wasm": wasm });
  });

  // Root can read a file of mode 000, and Windows does not have the mode.
  test.skipIf(isWindows || isRoot)("fails the build when it cannot read the file", async () => {
    using dir = tempDir("no-bundle-copy-unreadable", { "src/x.wasm": wasm });
    fs.chmodSync(path.join(String(dir), "src", "x.wasm"), 0o000);

    expect(await build(String(dir), ["./src/x.wasm", "--outdir=dist"])).toEqual({
      stdout: "",
      stderr: 'error: EACCES reading "src/x.wasm"\n',
      exitCode: 1,
    });

    expect(fs.readdirSync(String(dir), { recursive: true }).sort()).toEqual(["src", path.join("src", "x.wasm")]);
  });

  test("rejects a copied file and a transpiled file that map to the same output path", async () => {
    const files = { "src/a.js": `export const copied = 1;\n`, "src/a.ts": `export const transpiled: number = 2;\n` };
    using dir = tempDir("no-bundle-copy-collision", files);

    const { stdout, stderr, exitCode } = await build(String(dir), [
      "--loader",
      ".js:file",
      "./src/a.js",
      "./src/a.ts",
      "--outdir=dist",
    ]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: Multiple files share the same output path
        ./a.js:
          from input src/a.js
          from input src/a.ts


      note: entry naming is '[dir]/[name].[ext]', consider adding '[hash]' to make filenames unique"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);

    expect(readTree(String(dir))).toEqual({
      "src/a.js": Buffer.from(files["src/a.js"]),
      "src/a.ts": Buffer.from(files["src/a.ts"]),
    });
  });

  /** `x.wasm` below `dir`, at an absolute path that is `bytes` bytes long. Returns its path from `dir`. */
  function deepFile(dir: string, bytes: number): string {
    let folder = dir;
    const left = () => bytes - Buffer.byteLength(folder) - "/x.wasm".length;
    // A name is at most 255 bytes long.
    while (left() > 256) folder = path.join(folder, Buffer.alloc(200, "d").toString());
    folder = path.join(folder, Buffer.alloc(left() - 1, "L").toString());
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, "x.wasm");
    fs.writeFileSync(file, wasm);
    expect(Buffer.byteLength(file)).toBe(bytes);
    return path.relative(dir, file).replaceAll(path.sep, "/");
  }

  // The name of a copy was made in 1024 bytes: a path of 1008 bytes or more failed. macOS has paths of up to 1023.
  test("copies a file whose path is 1016 bytes long", async () => {
    using dir = tempDir("no-bundle-copy-long-path", {});
    const file = deepFile(String(dir), 1016);

    expect(await build(String(dir), [`./${file}`, "--outdir=dist"])).toEqual(wrote(["x.wasm", 11]));

    // On macOS a recursive `readdirSync` does not list a file this deep, so the source is read by its path.
    expect(readTree(path.join(String(dir), "dist"))).toEqual({ "x.wasm": wasm });
    expect(fs.readFileSync(path.join(String(dir), file))).toEqual(wasm);
  });

  // Only Linux has paths this long.
  test.skipIf(!isLinux)("copies a file whose path is longer than 2000 bytes", async () => {
    using dir = tempDir("no-bundle-copy-longer-path", {});
    const file = deepFile(String(dir), 2100);

    expect(await build(String(dir), [`./${file}`, "--outdir=dist"])).toEqual(wrote(["x.wasm", 11]));

    expect(readTree(String(dir))).toEqual({ "dist/x.wasm": wasm, [file]: wasm });
  });

  test.skipIf(!isLinux)("closes the files it has copied", async () => {
    using dir = tempDir("no-bundle-copy-closes", { "src/x.wasm": wasm, "src/y.bin": png });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--watch", "./src/x.wasm", "./src/y.bin", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = forEachLine(proc.stdout);
    // A build that fails keeps watching, so wait for whichever stream prints first.
    const first = await Promise.race([lines.next(), forEachLine(proc.stderr).next()]);
    expect(first.value).toStartWith("Transpiled");
    // The build prints one row for each file after it has written them all.
    let rows = 0;
    while (rows < 2) {
      const { value, done } = await lines.next();
      expect(done).toBe(false);
      if (value.endsWith(")")) rows++;
    }
    const open = fs.readdirSync(`/proc/${proc.pid}/fd`).flatMap(fd => {
      try {
        return fs.readlinkSync(`/proc/${proc.pid}/fd/${fd}`);
      } catch {
        return [];
      }
    });
    expect(open.length).toBeGreaterThan(0);
    expect(open.filter(target => /(x\.wasm|y\.bin)/.test(target))).toEqual([]);
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
    // Compiling nesting away writes the parent selector for each `&`. With two per level the
    // printer stops at its expansion limit.
    using dir = tempDir("build-css-print-err", {
      "styles.css": "&:is(.a, &.b) {\n".repeat(20) + "color: red;\n" + "}\n".repeat(20),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "styles.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Failed to generate CSS for this file");
    expect(stderr).toContain("styles.css");
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

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
test.skipIf(!isLinux || !cc)("bun build works without getrandom() and /dev/urandom", async () => {
  using dir = tempDir("build-no-getrandom", {
    "index.js": `console.log(1);`,
    "shim.c": `
      #define _GNU_SOURCE
      #include <dlfcn.h>
      #include <errno.h>
      #include <string.h>
      #include <unistd.h>
      long getrandom(void) { return errno = ENOSYS, -1; }
      static int refuse(const char *name, const char *path, int flags, int mode) {
        if (strcmp(path, "/dev/urandom")) return ((int (*)(const char *, int, ...))dlsym(RTLD_NEXT, name))(path, flags, mode);
        write(2, "refused\\n", 8);
        return errno = EMFILE, -1;
      }
      int open(const char *path, int flags, int mode) { return refuse("open", path, flags, mode); }
      int open64(const char *path, int flags, int mode) { return refuse("open64", path, flags, mode); }
    `,
  });
  const shim = join(String(dir), "shim.so");
  await Bun.$`${cc} -shared -fPIC -o ${shim} ${join(String(dir), "shim.c")} -ldl`.env(bunEnv).quiet();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js"],
    env: { ...bunEnv, LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "// index.js\nconsole.log(1);\n",
    stderr: expect.stringMatching(/^(refused\n)+$/),
    exitCode: 0,
  });
});
