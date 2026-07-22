// https://github.com/oven-sh/bun/issues/30678
//
// Reported against 1.3.14-canary.1+19d8ade2c: the HMR client crashed with
//   TypeError: Cannot destructure property 'isLikelyComponentType' of 'k'
//     as it is undefined.
// from `isReactRefreshBoundary` the first time a user module that
// self-accepted as a React Fast Refresh boundary loaded.
//
// The per-file emission of `hmr.reactRefreshAccept()` in
// `src/js_parser/lower/lower_esm_exports_hmr.rs:759` and the per-chunk
// emission of `refresh: "..."` in
// `src/runtime/bake/dev_server/incremental_graph.rs:1798` can disagree:
// the parser emits unconditionally when `features.react_fast_refresh &&
// react_refresh.register_used` are set at parse time, while the bundler
// gates the config on the refresh-runtime file being present and
// non-stale in the client graph. When the two disagreed, the client
// bundle shipped with `reactRefreshAccept()` calls but without a
// `refresh:` entry, so `setRefreshRuntime` never ran and the
// module-scoped `refreshRuntime` stayed `undefined`. The first user
// module that ran `hmr.reactRefreshAccept()` hit
//   const { isLikelyComponentType } = refreshRuntime
// in `src/runtime/bake/hmr-module.ts` and threw.
//
// The runtime now treats a missing `refreshRuntime` the same as a
// missing `isLikelyComponentType` function and falls through to the
// existing self-accept fallback on the next line.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

// Simulates the broken emission state by stripping `refresh: "..."` from
// the client bundle before evaluating — the smallest isolated
// reproduction of the mismatch that made the user's stack trace possible.
// Happy-dom supplies window+document and Node's `window.eval` actually
// evaluates (Bun's does not), so the bundle runs there.
// 30 s: the 5 s default is too tight for the full "spawn Bun dev server →
// bundle the React+happy-dom-driven fixture → spawn Node to eval it" loop
// under ASAN. It runs in ~2 s on a release build.
test("hmr client does not crash when config.refresh is missing", { timeout: 30_000 }, async () => {
  using dir = tempDir("issue-30678", {
    "index.html": `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
<div id="root"></div>
<script type="module" src="./main.tsx"></script>
</body>
</html>`,
    "main.tsx": `
      import { AuthProvider } from "./useAuth";

      const root = document.getElementById("root");
      if (root) root.textContent = "loaded";
      globalThis.__authProvider = AuthProvider;
    `,
    "useAuth.tsx": `
      import { createContext, useContext, useState } from "react";

      const AuthContext = createContext<any>(null);

      export function AuthProvider({ children }: { children: any }) {
        const [user, setUser] = useState<any>(null);
        return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>;
      }

      export function useAuth() {
        return useContext(AuthContext);
      }
    `,
    "server.ts": `
      import index from "./index.html";

      const server = Bun.serve({
        port: 0,
        routes: { "/": index },
        development: { hmr: true },
      });

      console.log("BUN_PORT=" + server.port);
    `,
    "client.mjs": `
      // Evaluated by Node. Bun's happy-dom \`window.eval\` is not a
      // function — Node's is — so we run this via Node.
      import { Window } from "happy-dom";

      const [url] = process.argv.slice(2);

      const htmlRes = await fetch(url);
      const html = await htmlRes.text();

      const scriptMatch = html.match(/src="(\\/_bun\\/client\\/[^"]+)"/);
      if (!scriptMatch) {
        console.error("NO_SCRIPT_TAG:", html.slice(0, 200));
        process.exit(10);
      }

      const bundleUrl = new URL(scriptMatch[1], url).href;
      const bundleRes = await fetch(bundleUrl);
      let bundle = await bundleRes.text();

      if (!/\\brefresh:\\s*"/.test(bundle)) {
        console.error("NO_REFRESH_IN_BUNDLE");
        process.exit(11);
      }
      // Drop the \`refresh: "..."\` line so \`setRefreshRuntime\` never
      // runs, exactly mirroring the bundler state that triggered #30678.
      // Re-check \`refresh:\` after the strip: if the bundler's emission
      // format ever drifts from the current \`,\\n  refresh: "..."\`, the
      // strip would silently no-op and this test would degrade into a
      // tautology that no longer exercises the crash path.
      bundle = bundle.replace(/,\\n\\s*refresh:\\s*"[^"]+"/, "");
      if (/\\brefresh:\\s*"/.test(bundle)) {
        console.error("STRIP_FAILED (bundle refresh emission format changed; update the regex)");
        process.exit(14);
      }

      const window = new Window({ url, width: 1024, height: 768 });
      window.document.documentElement.innerHTML = '<head></head><body><div id="root"></div></body>';
      window.fetch = async (u, opts) => {
        if (typeof u === "string") u = new URL(u, url).href;
        return fetch(u, opts);
      };
      window.WebSocket = class {
        readyState = 0;
        send() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      };

      const errors = [];
      window.addEventListener("error", e => errors.push(String(e.error ?? e.message)));
      window.console.error = (...a) => {
        const msg = a.map(v => (v && v.stack) || String(v)).join(" ");
        errors.push(msg);
      };
      window.console.warn = () => {};
      window.console.log = () => {};

      process.on("unhandledRejection", e => {
        errors.push("UNHANDLED_REJECTION: " + ((e && (e.message || e.stack)) || e));
      });

      try {
        (0, window.eval)(bundle);
      } catch (e) {
        console.error("EVAL_THREW:", (e && e.stack) || e);
        process.exit(12);
      }

      // Wait for either terminal state: main.tsx's body ran to completion
      // (success: \`window.__authProvider\` is set) or the bootstrap reported
      // an error (failure: \`errors\` non-empty). Polling for only the
      // success signal would hang in the pre-fix regressed case where
      // \`useAuth.tsx\` throws before \`main.tsx\` runs. The module graph is
      // microtask-only, so this settles within a few ticks.
      const deadline = Date.now() + 5000;
      while (!window.__authProvider && errors.length === 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 10));
      }

      const offenders = errors.filter(s => /isLikelyComponentType/.test(s));
      if (offenders.length > 0) {
        console.error("ISLIKELY_CRASH:", ...offenders);
        process.exit(13);
      }
      // Any unexpected error means something else broke on the path
      // from bootstrap to \`main.tsx\`'s body; we'd be printing CLIENT_OK
      // without actually exercising the regression.
      if (errors.length > 0) {
        console.error("UNEXPECTED_CLIENT_ERRORS:", ...errors);
        process.exit(15);
      }
      // \`main.tsx\` sets \`window.__authProvider\` at the end of its
      // module body; if it isn't set, the eval never reached the user
      // module and the fix wasn't actually exercised.
      if (!window.__authProvider) {
        console.error("CLIENT_DID_NOT_REACH_TERMINAL_SUCCESS (poll deadline expired)");
        process.exit(16);
      }
      console.log("CLIENT_OK");
    `,
    "package.json": `{
      "private": true,
      "dependencies": {
        "react": "^18.3.0",
        "happy-dom": "*"
      }
    }`,
  });

  // Link the monorepo's hoisted node_modules so the test skips a real
  // install. The test's modules (react, happy-dom) are already in the
  // repo's node_modules.
  const bunTestNodeModules = path.join(import.meta.dir, "..", "..", "node_modules");
  if (existsSync(bunTestNodeModules)) {
    await fs.symlink(bunTestNodeModules, path.join(String(dir), "node_modules"), "junction").catch(() => {});
  }

  // Start the dev server. `await using` guarantees cleanup even if the
  // test body throws past the `finally` (e.g. outer timeout).
  await using server = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    // Wait for the server to print its port.
    let port = 0;
    const reader = server.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 10_000;
    while (port === 0 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const m = buf.match(/BUN_PORT=(\d+)/);
      if (m) port = Number(m[1]);
    }
    reader.releaseLock();
    expect(port).toBeGreaterThan(0);

    // Run the evaluator under Node — Bun's `happy-dom` `window.eval` is
    // undefined, which would make the test unable to evaluate the bundle.
    // No Bun fallback: this branch exists only because Node's `window.eval`
    // actually evaluates.
    const node = nodeExe();
    if (!node) throw new Error("node executable not found on PATH");
    await using client = Bun.spawn({
      cmd: [node, "client.mjs", `http://localhost:${port}/`],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([client.stdout.text(), client.stderr.text(), client.exited]);

    if (exitCode !== 0) expect(stderr).toBe("");
    expect(stdout).toContain("CLIENT_OK");
    expect(exitCode).toBe(0);
  } finally {
    server.kill();
  }
});
