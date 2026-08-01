// https://github.com/oven-sh/bun/issues/28914
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("issue #28914 - bundler preserves top-level @layer statements", () => {
  test("Tailwind-style @layer statement with a @layer block", async () => {
    using dir = tempDir("css-layer-28914-tailwind", {
      "entry.css": /* css */ `
@layer theme, base, components, utilities;

@layer base {
  body {
    color: red;
  }
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = await Bun.file(`${dir}/out/entry.css`).text();

    // The statement carrying layer ordering must survive the bundle.
    expect(out).toContain("@layer theme, base, components, utilities;");
    // The block content must also be present.
    expect(out).toContain("@layer base");
    expect(out).toContain("color: red");
    expect(stdout).toContain("Bundled");
    expect(exitCode).toBe(0);
  });

  test("bare @layer statement survives the bundle", async () => {
    using dir = tempDir("css-layer-28914-bare", {
      "entry.css": /* css */ `@layer theme, base, components, utilities;`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = await Bun.file(`${dir}/out/entry.css`).text();
    expect(out).toContain("@layer theme, base, components, utilities;");
    expect(stdout).toContain("Bundled");
    expect(exitCode).toBe(0);
  });

  test("@layer statement followed by an unlayered rule", async () => {
    using dir = tempDir("css-layer-28914-mixed", {
      "entry.css": /* css */ `
@layer reset, base, components, utilities;

.foo { color: blue; }
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = await Bun.file(`${dir}/out/entry.css`).text();
    expect(out).toContain("@layer reset, base, components, utilities;");
    expect(out).toContain(".foo");
    expect(stdout).toContain("Bundled");
    expect(exitCode).toBe(0);
  });

  test("multiple individual @layer statements are all preserved", async () => {
    using dir = tempDir("css-layer-28914-multi", {
      "entry.css": /* css */ `
@layer theme;
@layer base;
@layer components;

.foo { color: red; }
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = await Bun.file(`${dir}/out/entry.css`).text();
    expect(out).toContain("@layer theme;");
    expect(out).toContain("@layer base;");
    expect(out).toContain("@layer components;");
    expect(out).toContain(".foo");
    expect(stdout).toContain("Bundled");
    expect(exitCode).toBe(0);
  });

  // The `.source_index` branch of `prepareCssAstsForChunk` only shallow-copies
  // the stylesheet, so its `rules.v.items` still points at the AST owned by
  // the parse graph. If the same source is imported from multiple chunks the
  // filter must not mutate that shared backing buffer. This test imports the
  // same file twice with two different layer conditions so both copies go
  // through the filter, and then checks every layer's rule still shows up.
  test("duplicate imports of a layered source don't corrupt the shared AST", async () => {
    using dir = tempDir("css-layer-28914-dup", {
      "entry.css": /* css */ `
@layer one, two;
@import url('./shared.css') layer(one);
@import url('./shared.css') layer(two);
`,
      // `shared.css` deliberately mixes an `.import` rule with an
      // `.layer_statement` in its prefix so the filter's interleaved
      // `else` branch (dropped=1, layer_count=1) is exercised, not the
      // no-op fast path.
      "shared.css": /* css */ `
@import url('./nested.css');
@layer base;
.shared { color: rebeccapurple; }
`,
      "nested.css": /* css */ `.nested { color: green; }`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.css", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = await Bun.file(`${dir}/out/entry.css`).text();

    // Both layer-wrapped copies of shared.css must emit the rule. An
    // in-place compaction of the shared backing array would leave a stale
    // slot that the second visit re-reads, producing three matches
    // instead of two (the duplicated rule falls through to the wrap step).
    const sharedMatches = out.match(/\.shared\s*\{/g) ?? [];
    expect(sharedMatches.length).toBe(2);
    // The shared `@layer base;` declaration must also survive in both
    // copies — it's part of the prefix the filter scans over.
    const baseMatches = out.match(/@layer base;/g) ?? [];
    expect(baseMatches.length).toBe(2);
    // The entry file's comma-separated ordering statement must survive.
    // `toContain("@layer one")` alone would be satisfied by the
    // `@layer one { ... }` wrapper, so assert the exact statement form.
    expect(out).toContain("@layer one, two;");
    // The per-condition block wrappers must also be present.
    expect(out).toContain("@layer one {");
    expect(out).toContain("@layer two {");
    expect(stdout).toContain("Bundled");
    expect(exitCode).toBe(0);
  });
});
