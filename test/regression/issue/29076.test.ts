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
  test("import * as ns from https:// does not produce a { default: <url> } stub", async () => {
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

  // NB: use a specifier with no recognised file extension, otherwise the
  // pre-fix runtime loader selects the .js/.jsx loader, tries to read the
  // URL as a filesystem path, and fails with ENOENT — which gives the same
  // empty-stdout + non-zero-exit outcome as the post-fix behaviour and so
  // wouldn't distinguish the regression. No extension hits the .file
  // loader and produces the { __esModule, default: "<url>" } stub pre-fix.
  test("import from http:// errors at load time", async () => {
    const { stdout, exitCode } = await runCode(`
      import * as ns from "http://bun-issue-29076-nonexistent.invalid";
      console.log("keys=" + JSON.stringify(Object.keys(ns)));
      console.log("default=" + typeof ns.default + ":" + ns.default);
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

  // Regression for https://github.com/oven-sh/bun/issues/22743: a second
  // `await import("https://...")` of the SAME URL that had already failed
  // once used to hang forever in Bun 1.2.21+ — the module cache ended up
  // in a wedged "pending" state. The test imports URL 1, then URL 2, then
  // URL 1 again: pre-fix the third iteration (the repeat of URL 1) hits
  // the poisoned cache entry and never returns, so the loop never reaches
  // "done" and the test-runner timeout fires.
  //
  // `.invalid` hostnames keep the test entirely local (no DNS on slow CI
  // runners). The `.js` extension is intentional: it sends the pre-fix
  // runtime loader through the .js/.jsx path, which ENOENTs on each
  // import and is what wedges the module cache on the repeat visit.
  // Extensionless URLs would instead hit the `.file` loader and return
  // the `{ __esModule, default: "<url>" }` stub; repeat imports of that
  // stub resolve cleanly without hanging, so they wouldn't reproduce the
  // #22743 signature.
  test("repeated dynamic import() of https:// does not hang", async () => {
    const { stdout, exitCode } = await runCode(`
      for (const url of [
        "https://bun-issue-22743.invalid/bundle.js",
        "https://bun-issue-22743-v2.invalid/bundle.js",
        "https://bun-issue-22743.invalid/bundle.js",
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
    // All three imports must reject and the final "done" must print. If
    // the third iteration (the second visit to URL 1) wedged on the
    // poisoned cache entry the loop would never reach "done".
    expect(stdout.trim().split("\n")).toEqual(["rejected", "rejected", "rejected", "done"]);
    expect(exitCode).toBe(0);
  });

  // `require()` of a URL is not a meaningful regression gate: both pre- and
  // post-fix it throws (pre-fix: external branch + CJS file read → ENOENT;
  // post-fix: normal resolve → module-not-found). The test would pass on
  // system bun for the wrong reason. See the http:// test above for the
  // rationale on the `.file`-loader / extension trick.
});
