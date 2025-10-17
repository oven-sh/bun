import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
import path from "node:path";

describe("import.meta.glob", () => {
  describe("runtime behavior", () => {
    test("returns lazy-loading functions for matched files", async () => {
      const dir = tempDirWithFiles("import-glob-basic", {
        "index.js": `
          const modules = import.meta.glob('./modules/*.js');
          console.log(JSON.stringify(Object.keys(modules)));
          console.log(typeof modules['./modules/a.js']);
        `,
        "modules/a.js": `export const name = "a";`,
        "modules/b.js": `export const name = "b";`,
        "modules/c.js": `export const name = "c";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[0])).toEqual(["./modules/a.js", "./modules/b.js", "./modules/c.js"]);
      expect(lines[1]).toBe("function");
    });

    test("import option extracts specific named export", async () => {
      const dir = tempDirWithFiles("import-glob-named", {
        "index.js": `
          const defaultModules = import.meta.glob('./routes/*.js', { import: 'default' });
          const namedModules = import.meta.glob('./routes/*.js', { import: 'handler' });
          
          console.log('DEFAULT_MODULES:');
          for (const [path, loader] of Object.entries(defaultModules)) {
            const result = await loader();
            console.log(path + ':', result);
          }
          
          console.log('NAMED_MODULES:');
          for (const [path, loader] of Object.entries(namedModules)) {
            const result = await loader();
            console.log(path + ':', result);
          }
        `,
        "routes/home.js": `
          export default "home-route";
          export const handler = "home-handler";
          export const unused = "should-not-see-this";
        `,
        "routes/about.js": `
          export default "about-route";
          export const handler = "about-handler";
          export const unused = "should-not-see-this";
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines).toContain("./routes/about.js: about-route");
      expect(lines).toContain("./routes/home.js: home-route");
      expect(lines).toContain("./routes/about.js: about-handler");
      expect(lines).toContain("./routes/home.js: home-handler");
      expect(stdout).not.toContain("should-not-see-this");
    });

    test("options are passed through (query and with)", async () => {
      const dir = tempDirWithFiles("import-glob-options", {
        "index.js": `
          const withType = import.meta.glob('./src/*.ts', { with: { type: 'text' } });
          const withQuery = import.meta.glob('./data/*.js', { query: '?inline' });
          console.log('WITH_TYPE:', Object.keys(withType).length);
          console.log('WITH_QUERY:', Object.keys(withQuery).length);
        `,
        "src/helper.ts": `export function helper() { return "typescript"; }`,
        "data/config.js": `export const config = { version: "1.0" };`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("WITH_TYPE: 1");
      expect(lines[1]).toBe("WITH_QUERY: 1");
    });

    test("eager mode loads modules synchronously", async () => {
      const dir = tempDirWithFiles("import-glob-eager", {
        "index.js": `
          const modules = import.meta.glob('./modules/*.js', { eager: true });
          console.log('TYPE:', typeof modules['./modules/a.js']);
          console.log('NAME:', modules['./modules/a.js'].name);
          console.log('KEYS:', JSON.stringify(Object.keys(modules).sort()));
        `,
        "modules/a.js": `export const name = "module-a";`,
        "modules/b.js": `export const name = "module-b";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("TYPE: object");
      expect(lines[1]).toBe("NAME: module-a");
      expect(lines[2]).toBe('KEYS: ["./modules/a.js","./modules/b.js"]');
    });

    test("supports recursive ** and multiple patterns", async () => {
      const dir = tempDirWithFiles("import-glob-patterns", {
        "index.js": `
          const recursive = import.meta.glob('./src/**/*.js');
          const multiple = import.meta.glob(['./lib/*.js', './config/*.js']);
          const negativeTest = import.meta.glob('./src/**/*.ts');
          const complexPattern = import.meta.glob('./src/**/[a-m]*.js');
          
          console.log('RECURSIVE:', JSON.stringify(Object.keys(recursive).sort()));
          console.log('MULTIPLE:', JSON.stringify(Object.keys(multiple).sort()));
          console.log('NEGATIVE_TEST:', JSON.stringify(Object.keys(negativeTest)));
          console.log('COMPLEX_PATTERN:', JSON.stringify(Object.keys(complexPattern).sort()));
        `,
        "src/main.js": `export default "main";`,
        "src/lib/util.js": `export default "util";`,
        "src/components/button.js": `export default "button";`,
        "lib/helper.js": `export default "helper";`,
        "config/app.js": `export default "app";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[0].split(": ")[1])).toEqual([
        "./src/components/button.js",
        "./src/lib/util.js",
        "./src/main.js",
      ]);
      expect(JSON.parse(lines[1].split(": ")[1])).toEqual(["./config/app.js", "./lib/helper.js"]);
      expect(JSON.parse(lines[2].split(": ")[1])).toEqual([]);
      expect(JSON.parse(lines[3].split(": ")[1])).toEqual(["./src/components/button.js", "./src/main.js"]);
    });

    test("negative patterns exclude files from results", async () => {
      const dir = tempDirWithFiles("import-glob-negative", {
        "index.js": `
          const all = import.meta.glob('./dir/*.js');
          const filtered = import.meta.glob(['./dir/*.js', '!**/bar.js']);
          
          console.log('ALL:', JSON.stringify(Object.keys(all).sort()));
          console.log('FILTERED:', JSON.stringify(Object.keys(filtered).sort()));
        `,
        "dir/foo.js": `export default "foo";`,
        "dir/bar.js": `export default "bar";`,
        "dir/baz.js": `export default "baz";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[0].split(": ")[1])).toEqual(["./dir/bar.js", "./dir/baz.js", "./dir/foo.js"]);
      expect(JSON.parse(lines[1].split(": ")[1])).toEqual(["./dir/baz.js", "./dir/foo.js"]);
    });

    test("handles empty results gracefully", () => {
      const modules = import.meta.glob("./non-existent/*.js");
      expect(typeof modules).toBe("object");
      expect(Object.keys(modules)).toHaveLength(0);
      expect(JSON.stringify(modules)).toBe("{}");
    });

    test("dynamic imports work when functions are called", async () => {
      const dir = tempDirWithFiles("import-glob-dynamic", {
        "index.js": `
          const modules = import.meta.glob('./modules/*.js');
          const loader = modules['./modules/test.js'];
          
          if (loader) {
            const mod = await loader();
            console.log('SUCCESS:', mod.message);
          }
        `,
        "modules/test.js": `export const message = "Hello from module!";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("SUCCESS: Hello from module!");
    });

    test("dynamic patterns work at runtime", async () => {
      const dir = tempDirWithFiles("import-glob-runtime", {
        "index.js": `
          const pattern = './modules/*.js';
          const modules = import.meta.glob(pattern);
          console.log('COUNT:', Object.keys(modules).length);
        `,
        "modules/test.js": `export const name = "test";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("COUNT: 1");
    });

    test("error handling and edge cases", async () => {
      const dir = tempDirWithFiles("import-glob-errors", {
        "index.js": `
          const withQuery = import.meta.glob('./data/**/*.json', { query: '?raw' });
          console.log('WITH_QUERY_PATHS:', Object.keys(withQuery).sort());
          
          const complex = import.meta.glob('./{data,config}/**/*.{js,json}');
          console.log('COMPLEX_COUNT:', Object.keys(complex).length);
          
          const keys = Object.keys(withQuery);
          const key = keys.find(k => k.includes('config.json'));
          console.log('ACTUAL_KEY:', key);
          if (key && withQuery[key]) {
            const first = await withQuery[key]();
            const second = await withQuery[key]();
            console.log('SAME_INSTANCE:', first === second);
          }
        `,
        "data/config.json": `{"version": "1.0"}`,
        "data/nested/deep.json": `{"level": "deep"}`,
        "config/app.js": `export default { name: "app" };`,
        "config/settings.json": `{"theme": "dark"}`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");

      expect(lines[0]).toContain("./data/config.json");
      expect(lines[0]).toContain("./data/nested/deep.json");
      expect(lines[1]).toBe("COMPLEX_COUNT: 4");
      expect(lines[2]).toContain("ACTUAL_KEY:");
      expect(lines[3]).toBe("SAME_INSTANCE: true");
    });

    test("base option prepends base path to imports but not keys", async () => {
      using dir = tempDir("import-glob-base", {
        "index.js": `
          const modules = import.meta.glob('./modules/*.js', { base: './src' });
          const moduleKeys = Object.keys(modules).sort();
          
          console.log('KEYS:', JSON.stringify(moduleKeys));
          
          for (const [key, loader] of Object.entries(modules)) {
            console.log('KEY:', key);
            const result = await loader();
            console.log('VALUE:', result.default);
          }
        `,
        "src/modules/foo.js": `export default "foo-value";`,
        "src/modules/bar.js": `export default "bar-value";`,
        "modules/baz.js": `export default "baz-should-not-match";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      if (exitCode !== 0) {
        console.log("STDERR:", stderr);
        console.log("STDOUT:", stdout);
      }
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");

      expect(lines[0]).toBe('KEYS: ["./modules/bar.js","./modules/foo.js"]');

      expect(lines).toContain("KEY: ./modules/foo.js");
      expect(lines).toContain("VALUE: foo-value");
      expect(lines).toContain("KEY: ./modules/bar.js");
      expect(lines).toContain("VALUE: bar-value");
    });

    test("base option with relative path upward", async () => {
      using dir = tempDir("import-glob-base-relative", {
        "src/index.js": `
          const modules = import.meta.glob('./lib/*.js', { base: '../base' });
          
          console.log('KEYS:', JSON.stringify(Object.keys(modules).sort()));
          
          for (const [key, loader] of Object.entries(modules)) {
            const result = await loader();
            console.log(key + ':', result.default);
          }
        `,
        "base/lib/util.js": `export default "util-module";`,
        "base/lib/helper.js": `export default "helper-module";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: path.join(String(dir), "src"),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      if (exitCode !== 0 || !stdout.includes("KEYS:")) {
        console.log("STDERR:", stderr);
        console.log("STDOUT:", stdout);
      }
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");

      expect(lines[0]).toBe('KEYS: ["./lib/helper.js","./lib/util.js"]');
      expect(lines).toContain("./lib/util.js: util-module");
      expect(lines).toContain("./lib/helper.js: helper-module");
    });

    test("base option with parent directory", async () => {
      using dir = tempDir("import-glob-base-parent", {
        "src/index.js": `
          const modules = import.meta.glob('./components/*.js', { base: '../shared' });
          console.log('KEYS:', JSON.stringify(Object.keys(modules).sort()));
          
          for (const [key, loader] of Object.entries(modules)) {
            const result = await loader();
            console.log(key + ':', result.name);
          }
        `,
        "shared/components/button.js": `export const name = "button-component";`,
        "shared/components/input.js": `export const name = "input-component";`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: path.join(String(dir), "src"),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");

      expect(lines[0]).toBe('KEYS: ["./components/button.js","./components/input.js"]');
      expect(lines).toContain("./components/button.js: button-component");
      expect(lines).toContain("./components/input.js: input-component");
    });
  });

  describe("bundler behavior", () => {
    test("preserves import.meta.glob functionality after bundling", async () => {
      const dir = tempDirWithFiles("import-glob-bundle", {
        "index.js": `
          const modules = import.meta.glob('./src/*.js');
          console.log('COUNT:', Object.keys(modules).length);
          console.log('FIRST_TYPE:', typeof Object.values(modules)[0]);
        `,
        "src/a.js": `export default "a";`,
        "src/b.js": `export default "b";`,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "index.js", "--outfile", "dist/bundle.js"],
        env: bunEnv,
        cwd: dir,
      });
      await buildProc.exited;

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "dist/bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("COUNT: 2");
      expect(lines[1]).toBe("FIRST_TYPE: function");
    });

    test("bundled code works with different glob modes", async () => {
      const dir = tempDirWithFiles("import-glob-bundle-modes", {
        "index.js": `
          const regular = import.meta.glob('./lib/*.js');
          const eager = import.meta.glob('./lib/*.js', { eager: true });
          const withImport = import.meta.glob('./lib/*.js', { import: 'name' });
          
          console.log('REGULAR:', typeof Object.values(regular)[0]);
          console.log('EAGER:', typeof Object.values(eager)[0]);
          console.log('IMPORT:', typeof Object.values(withImport)[0]);
        `,
        "lib/util.js": `export const name = "util";`,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "index.js", "--outfile", "dist/bundle.js"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });

      const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
        new Response(buildProc.stdout).text(),
        new Response(buildProc.stderr).text(),
        buildProc.exited,
      ]);

      expect(buildExitCode).toBe(0);
      expect(buildStderr).toBe("");

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "dist/bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("REGULAR: function");
      expect(lines[1]).toBe("EAGER: object");
      expect(lines[2]).toBe("IMPORT: function");
    });

    test("bundled code maintains correct file paths", async () => {
      const dir = tempDirWithFiles("import-glob-bundle-paths", {
        "index.js": `
          const modules = import.meta.glob('./src/**/*.js');
          const paths = Object.keys(modules).sort();
          console.log('PATHS:', JSON.stringify(paths));
          console.log('COUNT:', paths.length);
        `,
        "src/main.js": `export default "main";`,
        "src/lib/util.js": `export default "util";`,
        "src/lib/helper.js": `export default "helper";`,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "index.js", "--outfile", "dist/bundle.js"],
        env: bunEnv,
        cwd: dir,
      });
      await buildProc.exited;

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "dist/bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe('PATHS: ["./src/lib/helper.js","./src/lib/util.js","./src/main.js"]');
      expect(lines[1]).toBe("COUNT: 3");
    });

    test("bundled code works with --splitting", async () => {
      const dir = tempDirWithFiles("import-glob-splitting", {
        "entry1.js": `
          const modules = import.meta.glob('./shared/*.js');
          export function getModules() {
            return modules;
          }
          console.log('ENTRY1_MODULES:', Object.keys(modules).length);
        `,
        "entry2.js": `
          const modules = import.meta.glob('./shared/*.js');
          export function getModules() {
            return modules;
          }
          console.log('ENTRY2_MODULES:', Object.keys(modules).length);
        `,
        "shared/util.js": `export default "util"; export const name = "util";`,
        "shared/helper.js": `export default "helper"; export const name = "helper";`,
        "test.js": `
          import { getModules as getModules1 } from './dist/entry1.js';
          import { getModules as getModules2 } from './dist/entry2.js';
          
          const modules1 = getModules1();
          const modules2 = getModules2();
          
          console.log('TEST_MODULES1:', Object.keys(modules1).length);
          console.log('TEST_MODULES2:', Object.keys(modules2).length);
          console.log('SAME_KEYS:', JSON.stringify(Object.keys(modules1).sort()) === JSON.stringify(Object.keys(modules2).sort()));
        `,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "entry1.js", "entry2.js", "--splitting", "--outdir", "dist", "--target=bun"],
        env: bunEnv,
        cwd: dir,
      });
      const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
        new Response(buildProc.stdout).text(),
        new Response(buildProc.stderr).text(),
        buildProc.exited,
      ]);

      expect(buildExitCode).toBe(0);
      expect(buildStderr).toBe("");

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines).toContain("ENTRY1_MODULES: 2");
      expect(lines).toContain("ENTRY2_MODULES: 2");
      expect(lines).toContain("TEST_MODULES1: 2");
      expect(lines).toContain("TEST_MODULES2: 2");
      expect(lines).toContain("SAME_KEYS: true");
    });

    test("--splitting works with import option", async () => {
      const dir = tempDirWithFiles("import-glob-splitting-import", {
        "entry.js": `
          const modules = import.meta.glob('./lib/*.js', { import: 'name' });
          export async function loadNames() {
            const names = [];
            for (const [path, loader] of Object.entries(modules)) {
              const name = await loader();
              names.push(name);
            }
            return names;
          }
        `,
        "lib/foo.js": `export const name = "foo"; export default "default-foo";`,
        "lib/bar.js": `export const name = "bar"; export default "default-bar";`,
        "test.js": `
          import { loadNames } from './dist/entry.js';
          loadNames().then(names => {
            console.log('NAMES:', JSON.stringify(names.sort()));
          });
        `,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "entry.js", "--splitting", "--outdir", "dist", "--target=bun"],
        env: bunEnv,
        cwd: dir,
      });
      await buildProc.exited;

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toContain('NAMES: ["bar","foo"]');
    });

    test("--splitting works with 'with' option for JS files as text", async () => {
      const dir = tempDirWithFiles("import-glob-splitting-with", {
        "entry.js": `
          const modules = import.meta.glob('./assets/*', { with: { type: 'text' } });
          export async function loadTexts() {
            const texts = {};
            for (const [path, loader] of Object.entries(modules)) {
              const mod = await loader();
              texts[path] = mod.default || mod;
            }
            return texts;
          }
        `,
        "assets/hello.txt": `Hello World`,
        "assets/goodbye.txt": `Goodbye World`,
        "assets/script.js": `console.log("This should be text, not executed!"); export default "js-module";`,
        "test.js": `
          import { loadTexts } from './dist/entry.js';
          loadTexts().then(texts => {
            console.log('COUNT:', Object.keys(texts).length);
            console.log('SCRIPT_TEXT:', texts['./assets/script.js']);
          });
        `,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "entry.js", "--splitting", "--outdir", "dist", "--target=bun"],
        env: bunEnv,
        cwd: dir,
      });
      await buildProc.exited;

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("COUNT: 3");
      expect(stdout).toContain("SCRIPT_TEXT:");
      expect(stdout).toContain('console.log("This should be text, not executed!");');
      expect(stdout).toContain('export default "js-module";');
      const lines = stdout.split("\n");
      const shouldNotExecuteLine = lines.findIndex(line => line === "This should be text, not executed!");
      expect(shouldNotExecuteLine).toBe(-1);
    });

    test("base option works with bundler", async () => {
      using dir = tempDir("import-glob-bundler-base", {
        "index.js": `
          const modules = import.meta.glob('./modules/*.js', { base: './src' });
          const moduleKeys = Object.keys(modules).sort();
          
          console.log('KEYS:', JSON.stringify(moduleKeys));
          
          for (const [key, loader] of Object.entries(modules)) {
            const result = await loader();
            console.log(\`\${key}: \${result.default}\`);
          }
        `,
        "src/modules/foo.js": `export default "foo-bundled";`,
        "src/modules/bar.js": `export default "bar-bundled";`,
        "modules/baz.js": `export default "baz-should-not-match";`,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "index.js", "--outfile", "bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const buildExitCode = await buildProc.exited;
      expect(buildExitCode).toBe(0);

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(`KEYS: ["./modules/bar.js","./modules/foo.js"]
./modules/bar.js: bar-bundled
./modules/foo.js: foo-bundled
`);
    });

    test("base option with parent directory and bundler", async () => {
      using dir = tempDir("import-glob-bundler-base-parent", {
        "project/index.js": `
          const modules = import.meta.glob('./*.js', { base: '../' });
          const moduleKeys = Object.keys(modules).sort();
          
          console.log('KEYS:', JSON.stringify(moduleKeys));
          
          for (const [key, loader] of Object.entries(modules)) {
            const result = await loader();
            console.log(\`\${key}: \${result.default}\`);
          }
        `,
        "module1.js": `export default "module1-value";`,
        "module2.js": `export default "module2-value";`,
        "project/local.js": `export default "should-not-match";`,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "project/index.js", "--outfile", "bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const buildExitCode = await buildProc.exited;
      expect(buildExitCode).toBe(0);

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(`KEYS: ["./module1.js","./module2.js"]
./module1.js: module1-value
./module2.js: module2-value
`);
    });

    test("negative patterns work with bundler", async () => {
      const dir = tempDirWithFiles("import-glob-bundler-negative", {
        "index.js": `
          const all = import.meta.glob('./dir/*.js');
          const filtered = import.meta.glob(['./dir/*.js', '!**/bar.js']);
          
          console.log('ALL:', JSON.stringify(Object.keys(all).sort()));
          console.log('FILTERED:', JSON.stringify(Object.keys(filtered).sort()));
          
          for (const [key, loader] of Object.entries(filtered)) {
            const result = await loader();
            console.log(\`\${key}: \${result.default}\`);
          }
        `,
        "dir/foo.js": `export default "foo";`,
        "dir/bar.js": `export default "bar";`,
        "dir/baz.js": `export default "baz";`,
      });

      await using buildProc = Bun.spawn({
        cmd: [bunExe(), "build", "index.js", "--outfile", "bundle.js"],
        env: bunEnv,
        cwd: dir,
      });
      const buildExitCode = await buildProc.exited;
      expect(buildExitCode).toBe(0);

      expect(await Bun.file(path.join(dir, "bundle.js")).text()).not.toContain("glob");

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "bundle.js"],
        env: bunEnv,
        cwd: dir,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(runProc.stdout).text(),
        new Response(runProc.stderr).text(),
        runProc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[0].split(": ")[1])).toEqual(["./dir/bar.js", "./dir/baz.js", "./dir/foo.js"]);
      expect(JSON.parse(lines[1].split(": ")[1])).toEqual(["./dir/baz.js", "./dir/foo.js"]);
      expect(lines).toContain("./dir/foo.js: foo");
      expect(lines).toContain("./dir/baz.js: baz");
      expect(stdout).not.toContain("./dir/bar.js: bar");
    });
  });
});
