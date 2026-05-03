// https://github.com/oven-sh/bun/issues/30193 — when a pre-bundled static
// site (e.g. SvelteKit's `@sveltejs/adapter-static`) sits next to
// `index.html`, requests for the hashed asset files referenced via
// `<link rel="modulepreload">` and `<link rel="stylesheet">` were falling
// through to the SPA HTML, arriving with `Content-Type: text/html`.
// Firefox then refuses to execute the script because the MIME type is
// wrong.
//
// The fix serves siblings directly via `FileRoute` before the SPA
// fallback. This file isolates the new coverage so sandbox environments
// that break the older tests in `bun-serve-html-entry.test.ts` (they
// assume `localhost` resolves to IPv4) don't mix with the pass/fail
// signal for this change.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe.each(["development", "production"])("bun ./index.html — sibling assets on disk (%s)", NODE_ENV => {
  test(`serves .js / .css with correct MIME, path traversal is rejected (${NODE_ENV})`, async () => {
    const dir = tempDirWithFiles("html-entry-sibling-assets-" + NODE_ENV, {
      "index.html": /*html*/ `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link href="./_app/immutable/entry/start.abc123.js" rel="modulepreload">
    <link href="./_app/immutable/chunks/chunk1.abc123.js" rel="modulepreload">
    <link href="./_app/immutable/assets/style.abc123.css" rel="stylesheet">
  </head>
  <body><div id="app">hello</div></body>
</html>`,
      "_app/immutable/entry/start.abc123.js": `export const MARKER = "SIBLING_JS_OK";\n`,
      "_app/immutable/chunks/chunk1.abc123.js": `export const CHUNK = "SIBLING_CHUNK_OK";\n`,
      "_app/immutable/assets/style.abc123.css": `body{background:#ff00aa}\n`,
    });

    await using proc = Bun.spawn({
      // Pin to 127.0.0.1 so fetch() lands on the same family the server
      // bound to. Default `localhost` resolves to IPv6 in some sandboxes
      // where Bun.serve then only binds ::1 and IPv4 fetch fails.
      cmd: [bunExe(), "index.html", "--port=0", "--hostname=127.0.0.1"],
      env: { ...bunEnv, NODE_ENV },
      cwd: dir,
      stdout: "pipe",
      stderr: "inherit",
    });

    // Pull the port the server picked from stdout. Wait for a trailing "/"
    // so a chunked port number doesn't match early.
    let serverUrl = "";
    const decoder = new TextDecoder();
    let stdout_acc = "";
    for await (const chunk of proc.stdout) {
      stdout_acc += decoder.decode(chunk, { stream: true });
      const matched = stdout_acc.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (matched) {
        serverUrl = matched[0].replace(/\/$/, "");
        break;
      }
    }
    expect(serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    try {
      // `.js` modulepreload target — must be served as javascript with the
      // real file bytes, NOT the bundled HTML.
      const jsRes = await fetch(`${serverUrl}/_app/immutable/entry/start.abc123.js`);
      expect({
        status: jsRes.status,
        // Canonical MIME for `.js` is `text/javascript` (with or without
        // a charset suffix).
        contentType: (jsRes.headers.get("content-type") ?? "").split(";")[0].trim(),
      }).toEqual({ status: 200, contentType: "text/javascript" });
      expect(await jsRes.text()).toContain("SIBLING_JS_OK");

      // Chunk file from a subdirectory.
      const chunkRes = await fetch(`${serverUrl}/_app/immutable/chunks/chunk1.abc123.js`);
      expect(chunkRes.status).toBe(200);
      expect((chunkRes.headers.get("content-type") ?? "").split(";")[0].trim()).toBe("text/javascript");
      expect(await chunkRes.text()).toContain("SIBLING_CHUNK_OK");

      // Stylesheet sibling.
      const cssRes = await fetch(`${serverUrl}/_app/immutable/assets/style.abc123.css`);
      expect({
        status: cssRes.status,
        contentType: (cssRes.headers.get("content-type") ?? "").split(";")[0].trim(),
      }).toEqual({ status: 200, contentType: "text/css" });
      expect(await cssRes.text()).toContain("#ff00aa");

      // Unknown path still falls back to the bundled HTML (SPA behaviour).
      const unknownRes = await fetch(`${serverUrl}/does-not-exist-anywhere.js`);
      expect(unknownRes.status).toBe(200);
      expect(unknownRes.headers.get("content-type") ?? "").toContain("text/html");

      // Path traversal attempts must not escape the HTML's directory.
      // uWS collapses `..` segments in the raw URL, so percent-encoded
      // separators are the only traversal vector that survives to our
      // handler — they must still resolve outside html_dir and fall back
      // to the SPA HTML.
      const travRes = await fetch(`${serverUrl}/..%2F..%2F..%2Fetc%2Fpasswd`);
      expect(travRes.status).toBe(200);
      expect(travRes.headers.get("content-type") ?? "").toContain("text/html");
      expect(await travRes.text()).not.toContain("root:");

      // Requesting `/index.html` must still go through the HTML bundler
      // (bundled output), not return the raw file bytes.
      const idxRes = await fetch(`${serverUrl}/index.html`);
      expect(idxRes.status).toBe(200);
      expect(idxRes.headers.get("content-type") ?? "").toContain("text/html");
      // Bundler injects a `<script type="module">` referencing the JS
      // chunk; the raw HTML on disk doesn't have one.
      expect(await idxRes.text()).toMatch(/<script[^>]*type="module"/);
    } finally {
      proc.kill();
    }
  });
});
