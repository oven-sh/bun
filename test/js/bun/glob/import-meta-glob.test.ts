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
          const modules = import.meta.glob('./routes/*.js', { import: 'default' });
          
          for (const [path, loader] of Object.entries(modules)) {
            const result = await loader();
            console.log(path + ':', result);
          }
        `,
        "routes/home.js": `export default "home-route";`,
        "routes/about.js": `export default "about-route";`,
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
      expect(stdout.trim()).toBe("function"); // Still returns function, not module
    });

    test("supports recursive ** and multiple patterns", async () => {
      const dir = tempDirWithFiles("import-glob-patterns", {
        "index.js": `
          const recursive = import.meta.glob('./src/**/*.js');
          const multiple = import.meta.glob(['./lib/*.js', './config/*.js']);
          console.log('RECURSIVE:', JSON.stringify(Object.keys(recursive).sort()));
          console.log('MULTIPLE:', JSON.stringify(Object.keys(multiple).sort()));
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
    });

    test("handles empty results gracefully", () => {
      const modules = import.meta.glob("./non-existent/*.js");
      expect(typeof modules).toBe("object");
      expect(Object.keys(modules)).toHaveLength(0);
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
      expect(lines[1]).toBe("EAGER: function"); // Eager still lazy in bundler
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
  });
});
