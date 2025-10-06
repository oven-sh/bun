import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/22003
describe("sourcemap escaping with tab characters - issue #22003", () => {
  test("tabs in source should be properly escaped in sourcemap JSON", async () => {
    using dir = tempDir("22003", {
      "index.js": `module.exports = {\n\th32: require("./a"),\n\th64: require("./b")\n};`,
      "a.js": "module.exports = 'a';",
      "b.js": "module.exports = 'b';",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.js", "--outfile=out.js", "--sourcemap"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("InvalidSourceMap");

    const sourcemapContent = await Bun.file(`${dir}/out.js.map`).text();

    // Must be valid JSON
    let sourcemap;
    expect(() => {
      sourcemap = JSON.parse(sourcemapContent);
    }).not.toThrow();

    // sourcesContent should have the tab properly escaped
    expect(sourcemap.sourcesContent).toBeDefined();
    const indexSource = sourcemap.sourcesContent.find((s: string) => s.includes("h32") && s.includes("h64"));
    expect(indexSource).toBeDefined();
    // When parsed from JSON, \t becomes actual tab character
    expect(indexSource).toContain("\th32");
    expect(indexSource).toContain("\th64");
  });

  test("tabs with --compile should not cause InvalidSourceMap error", async () => {
    using dir = tempDir("22003-compile", {
      "index.js": `// Comment with tab:\there\nconsole.log("test");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.js", "--compile", "--sourcemap", "--outfile=out.exe"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("InvalidSourceMap");
  });
});
