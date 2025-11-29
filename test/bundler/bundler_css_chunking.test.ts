import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("CSS Chunking", () => {
  test("cssChunking reduces duplicate CSS when multiple JS entry points import the same CSS", async () => {
    using dir = tempDir("css-chunking-test", {
      "shared.css": `body { background: black; }`,
      "utils.css": `@import "./shared.css";\n.util { margin: 0; }`,
      "page-a.js": `import "./utils.css";\nconsole.log("Page A");`,
      "page-b.js": `import "./utils.css";\nconsole.log("Page B");`,
      "page-c.js": `import "./utils.css";\nconsole.log("Page C");`,
    });

    // Test with cssChunking: true
    await using proc1 = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--splitting",
        "--css-chunking",
        "--outdir",
        join(String(dir), "out-with-chunking"),
        join(String(dir), "page-a.js"),
        join(String(dir), "page-b.js"),
        join(String(dir), "page-c.js"),
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    expect(exitCode1).toBe(0);

    const withChunkingFiles = readdirSync(join(String(dir), "out-with-chunking")).filter(f => f.endsWith(".css"));

    // Test without cssChunking (default)
    await using proc2 = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--splitting",
        "--outdir",
        join(String(dir), "out-without-chunking"),
        join(String(dir), "page-a.js"),
        join(String(dir), "page-b.js"),
        join(String(dir), "page-c.js"),
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    expect(exitCode2).toBe(0);

    const withoutChunkingFiles = readdirSync(join(String(dir), "out-without-chunking")).filter(f => f.endsWith(".css"));

    // With CSS chunking, should create only 1 shared CSS file
    expect(withChunkingFiles.length).toBe(1);

    // Without CSS chunking, should create 3 separate CSS files (one per entry point)
    expect(withoutChunkingFiles.length).toBe(3);

    // Verify the shared CSS file contains the expected content
    const sharedCssContent = readFileSync(join(String(dir), "out-with-chunking", withChunkingFiles[0]), "utf-8");
    expect(sharedCssContent).toContain("background: #000");
    expect(sharedCssContent).toContain("margin: 0");
  });

  test("cssChunking: true via bun.build API", async () => {
    using dir = tempDir("css-chunking-api-test", {
      "shared.css": `body { background: black; }`,
      "utils.css": `@import "./shared.css";\n.util { padding: 0; }`,
      "entry-a.js": `import "./utils.css";\nexport const a = "a";`,
      "entry-b.js": `import "./utils.css";\nexport const b = "b";`,
    });

    // Build with cssChunking: true
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry-a.js"), join(String(dir), "entry-b.js")],
      outdir: join(String(dir), "out"),
      splitting: true,
      cssChunking: true,
    });

    expect(result.success).toBe(true);

    const cssOutputs = result.outputs.filter(o => o.path.endsWith(".css"));

    // Should create only 1 shared CSS chunk
    expect(cssOutputs.length).toBe(1);

    const cssContent = await cssOutputs[0].text();
    expect(cssContent).toContain("background: #000");
    expect(cssContent).toContain("padding: 0");
  });

  test("cssChunking: false creates separate CSS files per entry point", async () => {
    using dir = tempDir("css-no-chunking-api-test", {
      "shared.css": `body { color: red; }`,
      "entry-1.js": `import "./shared.css";\nexport const x = 1;`,
      "entry-2.js": `import "./shared.css";\nexport const y = 2;`,
    });

    // Build with cssChunking: false
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry-1.js"), join(String(dir), "entry-2.js")],
      outdir: join(String(dir), "out"),
      splitting: true,
      cssChunking: false,
    });

    expect(result.success).toBe(true);

    const cssOutputs = result.outputs.filter(o => o.path.endsWith(".css"));

    // Should create 2 separate CSS files (one per entry point)
    expect(cssOutputs.length).toBe(2);
  });

  test("cssChunking works with nested CSS imports", async () => {
    using dir = tempDir("css-chunking-nested", {
      "base.css": `.base { font-family: sans-serif; }`,
      "theme.css": `@import "./base.css";\n.theme { color: blue; }`,
      "utils.css": `@import "./theme.css";\n.utils { margin: 10px; }`,
      "app-a.js": `import "./utils.css";\nconsole.log("App A");`,
      "app-b.js": `import "./utils.css";\nconsole.log("App B");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app-a.js"), join(String(dir), "app-b.js")],
      outdir: join(String(dir), "dist"),
      splitting: true,
      cssChunking: true,
    });

    expect(result.success).toBe(true);

    const cssOutputs = result.outputs.filter(o => o.path.endsWith(".css"));

    // Should deduplicate all the nested CSS imports into one chunk
    expect(cssOutputs.length).toBe(1);

    const cssContent = await cssOutputs[0].text();
    expect(cssContent).toContain("font-family: sans-serif");
    expect(cssContent).toContain("#00f"); // minified "blue"
    expect(cssContent).toContain("margin: 10px");
  });

  test("cssChunking: true with different CSS per entry creates separate chunks", async () => {
    using dir = tempDir("css-chunking-different", {
      "shared.css": `body { margin: 0; }`,
      "red.css": `@import "./shared.css";\n.red { color: red; }`,
      "blue.css": `@import "./shared.css";\n.blue { color: blue; }`,
      "page-red.js": `import "./red.css";\nconsole.log("red");`,
      "page-blue.js": `import "./blue.css";\nconsole.log("blue");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "page-red.js"), join(String(dir), "page-blue.js")],
      outdir: join(String(dir), "out"),
      splitting: true,
      cssChunking: true,
    });

    expect(result.success).toBe(true);

    const cssOutputs = result.outputs.filter(o => o.path.endsWith(".css"));

    // Should create 2 CSS files because red.css and blue.css are different
    expect(cssOutputs.length).toBe(2);

    const contents = await Promise.all(cssOutputs.map(o => o.text()));

    // One should have red styles, the other blue
    const hasRed = contents.some(c => c.includes("red") || c.includes("#f00"));
    const hasBlue = contents.some(c => c.includes("blue") || c.includes("#00f"));

    expect(hasRed).toBe(true);
    expect(hasBlue).toBe(true);

    // Both should include the shared styles
    expect(contents.every(c => c.includes("margin: 0"))).toBe(true);
  });
});
