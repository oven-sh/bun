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

// The core regression signature from the pre-fix behavior is:
//   stdout: "keys=[\"__esModule\",\"default\"]" and
//           "default=string:https://esm.sh/d3@7.9.0"
// i.e. the module loader produced a fake namespace whose only own keys are
// `__esModule`/`default`, with `default` set to the URL string itself.
//
// Assertions below check two things: that the child process exits non-zero
// (the module failed to load) and that none of the pre-fix stub markers
// appear on stdout. We deliberately do NOT assert exact resolver-error
// strings on stderr because that phrasing varies across platforms and
// between ESM-loader and CJS-loader paths.

describe.concurrent("URL imports at runtime are rejected (not silently stubbed)", () => {
  test("import * as from https:// does not produce a { default: <url> } stub", async () => {
    const { stdout, exitCode } = await runCode(`
      import * as ns from "https://esm.sh/d3@7.9.0";
      console.log("keys=" + JSON.stringify(Object.keys(ns)));
      console.log("default=" + typeof ns.default + ":" + ns.default);
    `);
    // The module must fail to load — no program output, non-zero exit.
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("import default from https:// errors at load time", async () => {
    const { stdout, exitCode } = await runCode(`
      import d3 from "https://esm.sh/d3@7.9.0";
      console.log(typeof d3, d3);
    `);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("import from http:// errors at load time", async () => {
    const { stdout, exitCode } = await runCode(`
      import x from "http://example.com/code.js";
      console.log(x);
    `);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  // The resolver gate covers `http://`, `https://`, AND `//` (protocol-
  // relative) — if the `//` branch were accidentally dropped, nothing else
  // in this file would catch it, so keep an explicit test for it.
  //
  // Use a specifier with NO file extension: with the pre-fix behavior the
  // resolver marks it `is_external = true`, the runtime loader defaults to
  // `.file`, and we get the same `{ __esModule, default: "<url>" }` stub
  // signature as the https:// tests above. With a `.js` extension the path
  // would instead fall through to filesystem resolution (ENOENT) which
  // isn't a reliable regression signal. Use a nonsense host that can't
  // exist anywhere on any filesystem.
  test("import * from // (protocol-relative) errors at load time", async () => {
    const { stdout, exitCode } = await runCode(`
      import * as ns from "//bun-issue-29076-nonexistent.invalid";
      console.log("keys=" + JSON.stringify(Object.keys(ns)));
      console.log("default=" + typeof ns.default + ":" + ns.default);
    `);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("export * from https:// errors at load time", async () => {
    const { stdout, exitCode } = await runCode(`
      export * from "https://esm.sh/d3@7.9.0";
    `);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("dynamic import() of https:// rejects", async () => {
    const { stdout, exitCode } = await runCode(`
      try {
        const ns = await import("https://esm.sh/d3@7.9.0");
        console.log("LOADED keys=" + JSON.stringify(Object.keys(ns)));
        console.log("default=" + typeof ns.default + ":" + ns.default);
      } catch (e) {
        console.log("REJECTED");
      }
    `);
    // Pre-fix would print LOADED with the stub keys and the URL as default.
    // Post-fix the promise rejects and the catch logs REJECTED.
    expect(stdout).toContain("REJECTED");
    expect(stdout).not.toContain("LOADED");
    expect(stdout).not.toContain('keys=["__esModule","default"]');
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
          console.log("rejected");
        }
      }
      console.log("done");
    `);
    // All three imports must reject and the final "done" must print. If the
    // second iteration hung (the #22743 regression) the loop would never
    // reach "done".
    expect(stdout.trim().split("\n")).toEqual(["rejected", "rejected", "rejected", "done"]);
    expect(exitCode).toBe(0);
  });

  test("require() of https:// throws", async () => {
    const { stdout, exitCode } = await runCode(`
      try {
        const x = require("https://esm.sh/d3@7.9.0");
        console.log("LOADED:" + typeof x);
      } catch (e) {
        console.log("THREW");
      }
    `);
    expect(stdout).toContain("THREW");
    expect(stdout).not.toContain("LOADED");
    expect(exitCode).toBe(0);
  });
});
