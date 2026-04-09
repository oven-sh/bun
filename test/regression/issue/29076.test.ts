// https://github.com/oven-sh/bun/issues/29076
//
// Bun has no URL-fetching module loader at runtime, but the resolver used
// to auto-mark `http://`, `https://`, and `//protocol-relative` specifiers
// as implicitly external. The runtime module loader then produced a bogus
// `{ default: "<url>" }` namespace for them, so `import * as d3 from
// "https://esm.sh/d3@7.9.0"; d3.stack` silently returned `undefined`
// instead of failing.
//
// URL imports at runtime should now surface a proper resolve error.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runCode(src: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  using dir = tempDir("issue-29076", {
    "entry.mjs": src,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain stderr alongside stdout: if the child writes more than the pipe
  // buffer (~64 KB) and no one reads, the child blocks on write() and
  // proc.exited never resolves.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("URL imports at runtime are rejected (not silently stubbed)", () => {
  test("import * as from https:// does not produce a { default: <url> } stub", async () => {
    const { stdout, stderr, exitCode } = await runCode(`
      import * as ns from "https://esm.sh/d3@7.9.0";
      console.log("keys=" + JSON.stringify(Object.keys(ns)));
      console.log("default=" + typeof ns.default + ":" + ns.default);
    `);

    // The module must fail to load — no stdout, non-zero exit.
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
    // Assert the canonical resolver message so a future regression that fails
    // for an unrelated reason (syntax error, crash, etc.) doesn't pass this.
    expect(stderr).toContain("Cannot find module");
    expect(stderr).toContain("https://esm.sh/d3@7.9.0");
    // The previous behavior dumped the URL string as `default`. Make sure
    // that regression signature never returns.
    expect(stdout).not.toContain("https://esm.sh/d3@7.9.0");
    // And we definitely don't want the `__esModule`/`default`-only stub.
    expect(stdout).not.toContain('keys=["__esModule","default"]');
  });

  test("import default from https:// errors at load time", async () => {
    const { stdout, stderr, exitCode } = await runCode(`
      import d3 from "https://esm.sh/d3@7.9.0";
      console.log(typeof d3, d3);
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module");
    expect(stderr).toContain("https://esm.sh/d3@7.9.0");
    expect(exitCode).not.toBe(0);
  });

  test("import from http:// errors at load time", async () => {
    const { stdout, stderr, exitCode } = await runCode(`
      import x from "http://example.com/code.js";
      console.log(x);
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module");
    expect(stderr).toContain("http://example.com/code.js");
    expect(exitCode).not.toBe(0);
  });

  test("import from protocol-relative // errors at load time", async () => {
    const { stdout, stderr, exitCode } = await runCode(`
      import x from "//example.com/code.js";
      console.log(x);
    `);
    expect(stdout).toBe("");
    // Protocol-relative URL falls through to filesystem resolution with the
    // flag off; just assert the specifier never silently resolved.
    expect(stderr).toContain("example.com/code.js");
    expect(exitCode).not.toBe(0);
  });

  test("export * from https:// errors at load time", async () => {
    const { stdout, stderr, exitCode } = await runCode(`
      export * from "https://esm.sh/d3@7.9.0";
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module");
    expect(stderr).toContain("https://esm.sh/d3@7.9.0");
    expect(exitCode).not.toBe(0);
  });

  test("dynamic import() of https:// rejects", async () => {
    const { stdout, exitCode } = await runCode(`
      try {
        await import("https://esm.sh/d3@7.9.0");
        console.log("RESOLVED_UNEXPECTEDLY");
      } catch (e) {
        console.log("REJECTED:" + (e && e.message));
      }
    `);
    // The catch gets the rejection; assert on the caught error message so
    // we prove it's the resolver error and not some other failure.
    expect(stdout).toContain("REJECTED:");
    expect(stdout).toContain("Cannot find module");
    expect(stdout).toContain("https://esm.sh/d3@7.9.0");
    expect(stdout).not.toContain("RESOLVED_UNEXPECTEDLY");
    expect(exitCode).toBe(0);
  });

  // Regression for https://github.com/oven-sh/bun/issues/22743: the first
  // `await import("https://...")` used to resolve to the bogus stub, and the
  // second `await import()` of the SAME URL hung forever in Bun 1.2.21+.
  // With the stub gone, the first rejects and the module cache stays clean,
  // so the second rejects too.
  test("repeated dynamic import() of https:// does not hang", async () => {
    const { stdout, exitCode } = await runCode(`
      for (const url of [
        "https://unpkg.com/@flowscripter/example-plugin/dist/bundle.js",
        "https://unpkg.com/@flowscripter/example-plugin@1.0.13/dist/bundle.js",
        "https://unpkg.com/@flowscripter/example-plugin/dist/bundle.js",
      ]) {
        try {
          await import(url);
          console.log("LOADED");
        } catch (err) {
          console.log("error: " + (err && err.message));
        }
      }
      console.log("done");
    `);
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(4);
    for (let i = 0; i < 3; i++) {
      expect(lines[i]).toContain("error:");
      expect(lines[i]).toContain("Cannot find module");
    }
    expect(lines[3]).toBe("done");
    expect(exitCode).toBe(0);
  });

  test("require() of https:// throws", async () => {
    const { stdout, exitCode } = await runCode(`
      try {
        const x = require("https://esm.sh/d3@7.9.0");
        console.log("LOADED:" + typeof x);
      } catch (e) {
        console.log("THREW:" + (e && e.message));
      }
    `);
    expect(stdout).toContain("THREW:");
    expect(stdout).toContain("Cannot find");
    expect(stdout).toContain("https://esm.sh/d3@7.9.0");
    expect(stdout).not.toContain("LOADED:");
    expect(exitCode).toBe(0);
  });
});
