import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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

    test("eager mode falls back to lazy loading", async () => {
      const dir = tempDirWithFiles("import-glob-eager", {
        "index.js": `
          const modules = import.meta.glob('./modules/*.js', { eager: true });
          console.log(typeof modules['./modules/a.js']);
        `,
        "modules/a.js": `export const name = "module-a";`,
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
      expect(stdout.trim()).toBe("function");
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

      // Build and run
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

    test("bundled code still uses lazy loading for all modes", async () => {
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
      expect(lines[0]).toBe("REGULAR: function");
      expect(lines[1]).toBe("EAGER: function");
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

      // Build with splitting
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

      // Run the test file
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
  });
});
