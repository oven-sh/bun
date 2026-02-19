import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #20546 - CSS @layer declarations should be stripped from source files", () => {
  test("separate @layer statements with @import layer()", async () => {
    using dir = tempDir("css-layer-20546", {
      "main.css": /* css */ `
@layer one;
@layer two;
@layer three;

@import url('./a.css') layer(one);
@import url('./b.css') layer(two);
@import url('./c.css') layer(three);
`,
      "a.css": /* css */ `body { margin: 0; }`,
      "b.css": /* css */ `h1 { font-family: sans-serif; }`,
      "c.css": /* css */ `.text-centered { text-align: center; }`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./main.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");

    const outCss = await Bun.file(`${dir}/out/main.css`).text();

    // @layer declarations should appear at the top (hoisted or as part of the layer blocks)
    // @import statements should NOT appear in the output (they've been inlined)
    expect(outCss).not.toContain("@import");

    // The bare @layer declarations should not be duplicated at the bottom
    // They should either be hoisted to the top or removed entirely since
    // the layer blocks establish the same ordering
    const layerOneStatements = outCss.match(/@layer one;/g);
    const layerTwoStatements = outCss.match(/@layer two;/g);
    const layerThreeStatements = outCss.match(/@layer three;/g);

    // Each @layer declaration should appear at most once (hoisted)
    expect((layerOneStatements ?? []).length).toBeLessThanOrEqual(1);
    expect((layerTwoStatements ?? []).length).toBeLessThanOrEqual(1);
    expect((layerThreeStatements ?? []).length).toBeLessThanOrEqual(1);

    // The actual layer block content should be present
    expect(outCss).toContain("margin: 0");
    expect(outCss).toContain("font-family: sans-serif");
    expect(outCss).toContain("text-align: center");

    expect(exitCode).toBe(0);
  });

  test("comma syntax @layer statement with @import layer()", async () => {
    using dir = tempDir("css-layer-20546-comma", {
      "main.css": /* css */ `
@layer one, two, three;

@import url('./a.css') layer(one);
@import url('./b.css') layer(two);
@import url('./c.css') layer(three);
`,
      "a.css": /* css */ `body { margin: 0; }`,
      "b.css": /* css */ `h1 { font-family: sans-serif; }`,
      "c.css": /* css */ `.text-centered { text-align: center; }`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./main.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");

    const outCss = await Bun.file(`${dir}/out/main.css`).text();

    // @import statements should NOT appear in the output
    expect(outCss).not.toContain("@import");

    // The actual layer block content should be present
    expect(outCss).toContain("margin: 0");
    expect(outCss).toContain("font-family: sans-serif");
    expect(outCss).toContain("text-align: center");

    expect(exitCode).toBe(0);
  });
});
