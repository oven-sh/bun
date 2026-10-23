import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import * as path from "path";

// These tests verify that the resolver properly invalidates cache across multiple
// Bun.build() calls in the same process when files/directories are deleted and recreated.
// This tests the fix in src/fs.zig and src/resolver/resolver.zig for generation > 0 behavior.

// Note: Not using describe.concurrent because these tests specifically test
// cache invalidation behavior across multiple Bun.build() calls in the same process,
// and the resolver generation counter is process-global state.
describe("resolver cache invalidation", () => {
  test("directory with index.js deleted then recreated", async () => {
    using dir = tempDir("cache-test-index-js", {
      "entry.js": `export { value } from "./subdir";`,
      "subdir/index.js": `export const value = 42;`,
    });

    const subdirPath = path.join(String(dir), "subdir");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("42");

    // Delete directory
    await fs.rm(subdirPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory
    await fs.mkdir(subdirPath);
    await fs.writeFile(path.join(subdirPath, "index.js"), `export const value = 99;`);

    // Build 3: Should succeed with new value
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("99");
  });

  test("directory with index.ts deleted then recreated", async () => {
    using dir = tempDir("cache-test-index-ts", {
      "entry.ts": `export { add } from "./utils";`,
      "utils/index.ts": `export const add = (a: number, b: number) => a + b;`,
    });

    const utilsPath = path.join(String(dir), "utils");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete directory
    await fs.rm(utilsPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.ts")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory
    await fs.mkdir(utilsPath);
    await fs.writeFile(path.join(utilsPath, "index.ts"), `export const add = (a: number, b: number) => a * b;`);

    // Build 3: Should succeed with new implementation
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    // Verify it's using multiplication (new), not addition (old)
    expect(text3).toContain("a * b");
    expect(text3).not.toContain("a + b");
  });

  test("direct file deleted then recreated", async () => {
    using dir = tempDir("cache-test-direct-file", {
      "entry.js": `export { config } from "./config.js";`,
      "config.js": `export const config = { version: 1 };`,
    });

    const configPath = path.join(String(dir), "config.js");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("1");

    // Delete file
    await fs.rm(configPath);

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate file with new content
    await fs.writeFile(configPath, `export const config = { version: 2 };`);

    // Build 3: Should succeed with new content
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("2");
  });

  test("nested directory deleted then recreated", async () => {
    using dir = tempDir("cache-test-nested", {
      "entry.js": `export { value } from "./deep/nested/module.js";`,
      "deep/nested/module.js": `export const value = "original";`,
    });

    const deepPath = path.join(String(dir), "deep");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete parent directory
    await fs.rm(deepPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory structure
    const nestedPath = path.join(deepPath, "nested");
    await fs.mkdir(deepPath);
    await fs.mkdir(nestedPath);
    await fs.writeFile(path.join(nestedPath, "module.js"), `export const value = "recreated";`);

    // Build 3: Should succeed
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("recreated");
  });

  test("extension resolution after file deletion", async () => {
    using dir = tempDir("cache-test-extension", {
      "entry.js": `export { helper } from "./helper";`,
      "helper.js": `export const helper = "js version";`,
    });

    const helperJsPath = path.join(String(dir), "helper.js");
    const helperTsPath = path.join(String(dir), "helper.ts");

    // Build 1: Resolves to .js
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("js version");

    // Delete .js file
    await fs.rm(helperJsPath);

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Create .ts file instead
    await fs.writeFile(helperTsPath, `export const helper = "ts version";`);

    // Build 3: Should resolve to .ts
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("ts version");
  });

  test("package.json exports field after deletion and recreation", async () => {
    using dir = tempDir("cache-test-pkg-exports", {
      "entry.js": `export { value } from "mypkg";`,
      "node_modules/mypkg/package.json": JSON.stringify({
        name: "mypkg",
        exports: {
          ".": "./dist/index.js",
        },
      }),
      "node_modules/mypkg/dist/index.js": `export const value = "v1";`,
    });

    const pkgPath = path.join(String(dir), "node_modules", "mypkg");
    const distPath = path.join(pkgPath, "dist");

    // Build 1: Should resolve via exports
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("v1");

    // Delete dist directory
    await fs.rm(distPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate dist with new version
    await fs.mkdir(distPath);
    await fs.writeFile(path.join(distPath, "index.js"), `export const value = "v2";`);

    // Build 3: Should succeed with new version
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("v2");
  });

  test("bare import with local node_modules after deletion", async () => {
    using dir = tempDir("cache-test-bare-import", {
      "entry.js": `export { value } from "mylib";`,
      "node_modules/mylib/index.js": `export const value = "v1";`,
      "node_modules/mylib/package.json": JSON.stringify({ name: "mylib" }),
    });

    const nodeModulesMylib = path.join(String(dir), "node_modules", "mylib");

    // Build 1: Should resolve to node_modules
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("v1");

    // Delete node_modules/mylib
    await fs.rm(nodeModulesMylib, { recursive: true });

    // Build 2: Should fail (no fallback for bare imports)
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate node_modules/mylib with new version
    await fs.mkdir(nodeModulesMylib, { recursive: true });
    await fs.writeFile(path.join(nodeModulesMylib, "package.json"), JSON.stringify({ name: "mylib" }));
    await fs.writeFile(path.join(nodeModulesMylib, "index.js"), `export const value = "v2";`);

    // Build 3: Should succeed with new version
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("v2");
  });

  test("sibling directory resolution after parent deletion", async () => {
    using dir = tempDir("cache-test-sibling", {
      "src/index.js": `export { helper } from "../lib/helper.js";`,
      "lib/helper.js": `export const helper = "original";`,
    });

    const libPath = path.join(String(dir), "lib");

    // Build 1: Should resolve sibling directory
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "src", "index.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete lib directory
    await fs.rm(libPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "src", "index.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate lib directory
    await fs.mkdir(libPath);
    await fs.writeFile(path.join(libPath, "helper.js"), `export const helper = "recreated";`);

    // Build 3: Should succeed
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "src", "index.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("recreated");
  });
});

// The resolver reads the package.json and the tsconfig.json of a directory once for the process.
// What it reports then has to reach every build that uses the directory, and not only the build
// (or the runtime) that is the first to read it. Each case runs in a process of its own, so the
// order of the reads is the order in its script.
describe.concurrent("what a package.json or a tsconfig.json reports reaches every build", () => {
  const unterminated = `{ "name": "bad", "main": "./main.js"`;
  const unknownType = `{ "name": "bad", "main": "./main.js", "type": "nonsense" }`;
  const parseError = `error: Expected "}" but found end of file`;
  const typeWarning = `warn: "nonsense" is not a valid value for "type" field (must be either "commonjs" or "module")`;
  const pathWarning = `warn: Non-relative path "nope.ts" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)`;
  const failed = { success: false, logs: [parseError] };
  const warned = { success: true, logs: [typeWarning], bundled: "main" };

  /** `entry.ts` imports the package "bad". Its package.json is `packageJson`. */
  const importsBad = (packageJson: string) => ({
    "package.json": "{}",
    "node_modules/bad/package.json": packageJson,
    "node_modules/bad/index.js": `module.exports = "BUNDLED_index";`,
    "node_modules/bad/main.js": `module.exports = "BUNDLED_main";`,
    "entry.ts": `import which from "bad";\nconsole.log(which);\n`,
  });

  /** Runs `script` in a new process, in `files`. `build()` there reports one `Bun.build` of `./entry.ts`. */
  async function run(files: Record<string, string>, script: string) {
    using dir = tempDir("resolver-config-diagnostics", {
      ...files,
      "run-fixture.ts": `
        import { writeFileSync } from "node:fs";
        const text = (log: any) => log.level + ": " + log.message;
        const build = async (options = {}) => {
          const { success, logs, outputs } = await Bun.build({ entrypoints: ["./entry.ts"], target: "bun", throw: false, ...options });
          const report = { success, logs: logs.map(text) };
          return success ? { ...report, bundled: /BUNDLED_(\\w+)/.exec(await outputs[0].text())?.[1] } : report;
        };
        const rejection = () => Bun.build({ entrypoints: ["./entry.ts"], target: "bun" }).then(() => "fulfilled", error => error.errors.map(text));
        const result = await (async () => { ${script} })();
        console.log("RESULT " + JSON.stringify(result));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run-fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = stdout.split("\n").find(line => line.startsWith("RESULT "));
    return { result: result ? JSON.parse(result.slice("RESULT ".length)) : { stdout, stderr }, exitCode };
  }

  test("a package.json that does not parse fails every build", async () => {
    const script = `return {
      builds: [await build(), await build(), await build()],
      rejections: [await rejection(), await rejection()],
      atOnce: await Promise.all([build(), build(), build()]),
    };`;
    expect(await run(importsBad(unterminated), script)).toEqual({
      result: {
        builds: [failed, failed, failed],
        rejections: [[parseError], [parseError]],
        atOnce: [failed, failed, failed],
      },
      exitCode: 0,
    });
  });

  test("a warning of a package.json is in the logs of every build", async () => {
    expect(await run(importsBad(unknownType), `return [await build(), await build(), await build()];`)).toEqual({
      result: [warned, warned, warned],
      exitCode: 0,
    });
  });

  test.each([
    { packageJson: unterminated, resolved: "index.js", built: failed },
    { packageJson: unknownType, resolved: "main.js", built: warned },
  ])("the runtime reads the package.json first: $resolved", async ({ packageJson, resolved, built }) => {
    const script = `return { resolved: require("node:path").basename(require.resolve("bad")), builds: [await build(), await build()] };`;
    expect(await run(importsBad(packageJson), script)).toEqual({
      result: { resolved, builds: [built, built] },
      exitCode: 0,
    });
  });

  // The runtime reads it when it starts.
  test("the package.json of the working directory", async () => {
    const files = { ...importsBad(`{ "name": "bad", "main": "./main.js" }`), "package.json": `{ "name": "root"` };
    expect(await run(files, `return [await build(), await build()];`)).toEqual({
      result: [failed, failed],
      exitCode: 0,
    });
  });

  test("a build that reads only a directory below the package.json", async () => {
    const files = {
      "package.json": "{}",
      "packages/a/package.json": unterminated,
      "packages/a/src/which.js": `export default "BUNDLED_below";`,
      "entry.ts": `import which from "./packages/a/src/which.js";\nconsole.log(which);\n`,
    };
    expect(await run(files, `return [await build(), await build(), await build()];`)).toEqual({
      result: [failed, failed, failed],
      exitCode: 0,
    });
  });

  // `src/node_modules/bad` has no module to load, so the import is the package in the root.
  test("a package.json that the resolver reads and goes past", async () => {
    const files = {
      ...importsBad(`{ "name": "bad", "main": "./main.js" }`),
      "src/node_modules/bad/package.json": unterminated,
      "src/entry.ts": `import which from "bad";\nconsole.log(which);\n`,
    };
    const script = `const build_ = () => build({ entrypoints: ["./src/entry.ts"] }); return [await build_(), await build_(), await build_()];`;
    expect(await run(files, script)).toEqual({ result: [failed, failed, failed], exitCode: 0 });
  });

  test("several files that import the package give one message", async () => {
    const files = {
      ...importsBad(unknownType),
      "a/one.ts": `import which from "bad";\nexport const one = which;\n`,
      "a/b/two.ts": `import which from "bad";\nexport const two = which;\n`,
      "entry.ts": `import which from "bad";\nimport { one } from "./a/one.ts";\nimport { two } from "./a/b/two.ts";\nconsole.log(which, one, two);\n`,
    };
    expect(await run(files, `return [await build(), await build(), await build()];`)).toEqual({
      result: [warned, warned, warned],
      exitCode: 0,
    });
  });

  // The macro is resolved on a thread of the bundler, which is then the first to read the directory.
  test("a macro import reads the package.json first", async () => {
    const files = {
      ...importsBad(unterminated),
      "node_modules/bad/macro.ts": `export function macro() { return "macro"; }`,
      "entry.ts": `import { macro } from "bad/macro.ts" with { type: "macro" };\nimport which from "bad";\nconsole.log(macro(), which);\n`,
    };
    expect(await run(files, `return [await build(), await build(), await build()];`)).toEqual({
      result: [failed, failed, failed],
      exitCode: 0,
    });
  });

  test("a file that changes between two builds is read again", async () => {
    const script = `
      const write = (packageJson: string) => writeFileSync("node_modules/bad/package.json", packageJson);
      const builds = [await build(), await build()];
      write(${JSON.stringify(unterminated)});
      builds.push(await build(), await build());
      write('{ "name": "bad" }');
      builds.push(await build(), await build());
      return builds;
    `;
    const repaired = { success: true, logs: [], bundled: "index" };
    expect(await run(importsBad(unknownType), script)).toEqual({
      result: [warned, warned, failed, failed, repaired, repaired],
      exitCode: 0,
    });
  });

  test("a tsconfig.json with a warning, and one that does not parse", async () => {
    const files = {
      "package.json": "{}",
      "warns/tsconfig.json": `{ "compilerOptions": { "paths": { "which": ["./which.ts"], "unused": ["nope.ts"] } } }`,
      "warns/which.ts": `export default "BUNDLED_alias";`,
      "warns/entry.ts": `import which from "which";\nconsole.log(which);\n`,
      "broken/tsconfig.json": `{ "compilerOptions": { "paths": `,
      "broken/entry.ts": `console.log("BUNDLED_plain");\n`,
    };
    const script = `
      const warns = () => build({ entrypoints: ["./warns/entry.ts"] });
      const broken = () => build({ entrypoints: ["./broken/entry.ts"] });
      return { warns: [await warns(), await warns(), await warns()], broken: [await broken(), await broken(), await broken()] };
    `;
    const warns = { success: true, logs: [pathWarning], bundled: "alias" };
    const broken = { success: false, logs: ["error: Unexpected end of file"] };
    expect(await run(files, script)).toEqual({
      result: { warns: [warns, warns, warns], broken: [broken, broken, broken] },
      exitCode: 0,
    });
  });

  // What is wrong with a tsconfig.json is for the builds that read it, whichever build is first.
  test.each([
    { order: "the other first", builds: ["custom", "own", "custom", "own", "own"] },
    { order: "its own first", builds: ["own", "custom", "own", "custom"] },
  ])("a build that reads another tsconfig.json in its place: $order", async ({ builds }) => {
    const paths = (which: string) => ({ compilerOptions: { paths: { which: [which], unused: ["nope.ts"] } } });
    const files = {
      "package.json": "{}",
      "project/tsconfig.json": JSON.stringify(paths("./own.ts")),
      "project/custom.json": JSON.stringify({ compilerOptions: { paths: { which: ["./custom.ts"] } } }),
      "project/own.ts": `export default "BUNDLED_own";`,
      "project/custom.ts": `export default "BUNDLED_custom";`,
      "project/entry.ts": `import which from "which";\nconsole.log(which);\n`,
    };
    const script = `
      const builds = [];
      for (const tsconfig of ${JSON.stringify(builds)}) {
        builds.push(await build({ entrypoints: ["./project/entry.ts"], tsconfig: tsconfig === "custom" ? "./project/custom.json" : undefined }));
      }
      return builds;
    `;
    const expected = {
      own: { success: true, logs: [pathWarning], bundled: "own" },
      custom: { success: true, logs: [], bundled: "custom" },
    };
    expect(await run(files, script)).toEqual({
      result: builds.map(tsconfig => expected[tsconfig as "own" | "custom"]),
      exitCode: 0,
    });
  });

  // The base that is not found is not reported, so there is nothing to report again.
  test("a tsconfig.json that extends a package reports nothing", async () => {
    const files = {
      "package.json": "{}",
      "tsconfig.json": `{ "extends": "some-package/tsconfig.base" }`,
      "entry.ts": `console.log("BUNDLED_plain");\n`,
    };
    const built = { success: true, logs: [], bundled: "plain" };
    expect(await run(files, `return [await build(), await build()];`)).toEqual({ result: [built, built], exitCode: 0 });
  });

  test.each([
    { packageJson: unterminated, message: parseError, exitCode: 1 },
    { packageJson: unknownType, message: typeWarning, exitCode: 0 },
  ])("bun build reports it once: exit code $exitCode", async ({ packageJson, message, exitCode }) => {
    using dir = tempDir("resolver-config-diagnostics-cli", importsBad(packageJson));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.ts", "--target=bun", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exited] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ reported: stderr.split(message).length - 1, exitCode: exited }).toEqual({ reported: 1, exitCode });
  });

  // Each route is a build of its own.
  test("the builds of two HTML routes", async () => {
    const html = (title: string) =>
      `<!doctype html><html><head><title>${title}</title><script type="module" src="./entry.ts"></script></head></html>`;
    using dir = tempDir("resolver-config-diagnostics-html", {
      ...importsBad(unterminated),
      "one.html": html("one"),
      "two.html": html("two"),
      "serve-fixture.ts": `
        import one from "./one.html";
        import two from "./two.html";
        using server = Bun.serve({ port: 0, development: false, routes: { "/one": one, "/two": two } });
        const status = async (route: string) => (await fetch(new URL(route, server.url))).status;
        console.log("RESULT " + JSON.stringify([await status("/one"), await status("/two")]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "serve-fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = stdout.split("\n").find(line => line.startsWith("RESULT "));
    expect({ result: result ? JSON.parse(result.slice("RESULT ".length)) : { stdout, stderr }, exitCode }).toEqual({
      result: [500, 500],
      exitCode: 0,
    });
  });
});
