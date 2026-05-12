import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The `.raw` portion of a tagged template literal and `RegExp.prototype.source`
// must surface the source bytes verbatim. Bun's printer previously escaped
// codepoints > 0x7F to `\uXXXX` and the module loader cloned the resulting
// bytes as Latin-1 — between them, non-ASCII input became mojibake at
// runtime. See #30563.

describe("issue #30563 — String.raw and RegExp.source preserve non-ASCII", () => {
  test("String.raw returns the exact source bytes of `╭─╮`", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const s = String.raw`╭─╮`;" +
          "console.log(JSON.stringify({len: s.length, codepoints: [...s].map(c => c.codePointAt(0).toString(16))}));",
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      len: 3,
      codepoints: ["256d", "2500", "256e"],
    });
    expect(exitCode).toBe(0);
  });

  test("RegExp.source returns the exact source bytes of `╭─╮`", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const r = /╭─╮/;" +
          "console.log(JSON.stringify({len: r.source.length, codepoints: [...r.source].map(c => c.codePointAt(0).toString(16))}));",
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      len: 3,
      codepoints: ["256d", "2500", "256e"],
    });
    expect(exitCode).toBe(0);
  });

  test("String.raw round-trip across a variety of scripts", async () => {
    // Uses a multi-file fixture so the module-loader (Layer 2) clone path
    // runs, not just Bun.Transpiler's in-process output. This catches the
    // `cloneLatin1(printer_output)` mis-decode described in #30563.
    //
    // The raw characters in the template-literal source must remain as-is
    // after transpile — that's what `.raw` surfaces. `JSON.stringify` on the
    // results makes the test output a readable diff when a byte goes astray.
    using dir = tempDir("issue-30563-scripts", {
      "fixture.js": `
        const cases = {
          "box-drawing": String.raw\`╭─╮\`,
          "cyrillic": String.raw\`Привет\`,
          "cjk": String.raw\`你好世界\`,
          "emoji": String.raw\`Hello 🌍\`,
          "regex": /╭─╮/.source,
        };
        console.log(JSON.stringify(cases));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      "box-drawing": "╭─╮",
      "cyrillic": "Привет",
      "cjk": "你好世界",
      "emoji": "Hello 🌍",
      "regex": "╭─╮",
    });
    expect(exitCode).toBe(0);
  });

  test("--hot (watcher enabled) keeps non-ASCII bytes in String.raw and RegExp.source", async () => {
    // The module loader takes a different branch when the watcher is on:
    // it calls `refCountedResolvedSource`, which creates an external
    // Latin-1 WTFString. Pre-fix, that mis-tagged UTF-8 bytes as Latin-1
    // and mangled the visible string. The fix falls through to the
    // encoding-inferring clone when the output contains non-ASCII.
    using dir = tempDir("issue-30563-watch", {
      "entry.js":
        "console.log(JSON.stringify({" +
        "  raw: String.raw`╭─╮`," +
        "  source: /╭─╮/.source," +
        "}));" +
        // Exit promptly so the test doesn't hang on the watcher.
        "process.exit(0);\n",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(stdout.trim())).toEqual({ raw: "╭─╮", source: "╭─╮" });
    expect(exitCode).toBe(0);
  });

  test("pre-bundled `// @bun` modules keep non-ASCII bytes in String.raw and RegExp.source", async () => {
    // Files prefixed with `// @bun` skip transpilation and clone
    // `source.contents` straight into the JSC source — the other branch
    // patched in #30563, beyond the printer-output one.
    using dir = tempDir("issue-30563-already-bundled", {
      "fixture.js":
        "// @bun\n" + "console.log(JSON.stringify({" + "  raw: String.raw`╭─╮`," + "  source: /╭─╮/.source," + "}));\n",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ raw: "╭─╮", source: "╭─╮" });
    expect(exitCode).toBe(0);
  });

  test("runtime transpiler cache round-trips non-ASCII in String.raw", async () => {
    // Runtime transpiler cache triggers for files >= MINIMUM_CACHE_SIZE
    // (50 KB). Pre-fix, `cloneLatin1` on the printer output mis-tagged
    // the cached entry's bytes and the wrong string was served on every
    // subsequent run.
    const padding = "/*" + Buffer.alloc(60_000, "x").toString() + "*/\n";
    const program =
      "const s = String.raw`╭─╮`;" +
      "const r = /╭─╮/;" +
      "console.log(JSON.stringify({" +
      "  s_len: s.length," +
      "  s: s," +
      "  r_len: r.source.length," +
      "  r: r.source," +
      "}));\n";

    using dir = tempDir("issue-30563-cache", {
      "sample.js": padding + program,
    });

    const env = {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: `${dir}/.cache`,
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };

    const expected = { s_len: 3, s: "╭─╮", r_len: 3, r: "╭─╮" };

    // Run twice: first writes the cache entry, second reads it back.
    for (const label of ["cache-miss", "cache-hit"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "sample.js"],
        env,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ label, parsed: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
        label,
        parsed: expected,
        stderr: "",
        exitCode: 0,
      });
    }
  });
});
