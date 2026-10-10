import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

/**
 * What an HTML route whose bundle could not be built answers with: the first
 * request (which waited for the build) and every request after it.
 */
const buildFailedResponses = ["GET", "GET", "HEAD"].map(method => ({
  method,
  status: 500,
  contentLength: "0",
  body: "",
}));

// In production the route is built once; when that build fails the route stays
// failed, so the requests served from the failed state must report it the same
// way as the request that waited for the build.
test("production html route whose build failed keeps answering 500", async () => {
  await using dir = tempDir("bun-serve-html-build-failed", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Build failure</title>
          <script type="module" src="./does-not-exist.js"></script>
        </head>
        <body></body>
      </html>
    `,
  });
  const { default: html } = await import(join(String(dir), "index.html"));

  using server = Bun.serve({
    port: 0,
    development: false,
    routes: { "/": html },
    fetch() {
      return new Response("fallback", { status: 404 });
    },
  });

  const results = [];
  for (const method of ["GET", "GET", "HEAD"]) {
    const response = await fetch(server.url, { method });
    results.push({
      method,
      status: response.status,
      contentLength: response.headers.get("content-length"),
      body: await response.text(),
    });
  }
  expect(results).toEqual(buildFailedResponses);
});

describe("serve plugins", () => {
  // A failed plugin load is remembered for the lifetime of the server. The first
  // request is answered when the load rejects; later requests hit the remembered
  // failure right away. In production the route stays failed, in development
  // without HMR the route is retried per request and fails again, and with HMR
  // the dev server answers a route it has not seen before from its plugin error
  // state.
  test.concurrent("requests after a failed plugin load keep getting 500", async () => {
    await using dir = tempDir("html-failed-plugin-load", {
      "bunfig.toml": /* toml */ `
[serve.static]
plugins = ["./plugin.ts"]
`,
      "index.html": /*html*/ `<!DOCTYPE html><html><head><title>Plugin load failure</title></head><body></body></html>`,
      "other.html": /*html*/ `<!DOCTYPE html><html><head><title>Other route</title></head><body></body></html>`,
      "plugin.ts": /*ts*/ `
export default {
  name: "throws-in-setup",
  setup() {
    throw new Error("setup failed on purpose");
  },
};
`,
      "serve-fixture.ts": /*ts*/ `
import html from "./index.html";
import other from "./other.html";
import net from "node:net";

const mode = process.argv[2];
const server = Bun.serve({
  port: 0,
  development: mode === "hmr" ? true : mode === "development" ? { hmr: false } : false,
  // Keep the idle timeout out of the picture: only an explicit close counts.
  idleTimeout: 255,
  routes: { "/": html, "/other": other },
  fetch: () => new Response("fallback", { status: 404 }),
});

// The first request waits for the plugin load and is answered from an
// event-loop task once it rejects. Read it from a raw socket so the fixture
// can report whether the server closes the connection it marked
// "Connection: close".
const first = await new Promise((resolve, reject) => {
  const sock = net.connect(server.port, "127.0.0.1", () => {
    sock.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
  });
  let data = "";
  let closedByServer = true;
  sock.on("data", chunk => {
    data += chunk.toString();
    if (mode === "hmr") {
      // The dev server's parked-request path does not close the socket yet.
      // Content-Length is 0, so the header terminator ends the response.
      if (data.includes("\\r\\n\\r\\n")) {
        closedByServer = false;
        sock.destroy();
      }
      return;
    }
    // The response has arrived. Give the server a bounded time to close.
    sock.setTimeout(2000, () => {
      closedByServer = false;
      sock.destroy();
    });
  });
  sock.on("error", reject);
  sock.on("close", () => {
    const [head, body = ""] = data.split("\\r\\n\\r\\n");
    const [statusLine, ...headerLines] = head.split("\\r\\n");
    const headers = new Headers(headerLines.map(line => line.split(": ", 2)));
    resolve({
      method: "GET",
      status: Number(statusLine.split(" ")[1]),
      contentLength: headers.get("content-length"),
      body,
      closedByServer,
    });
  });
});

const results = [first];
// The later requests go to a route the dev server has not bundled yet.
const later = new URL(mode === "hmr" ? "/other" : "/", server.url);
for (const method of ["GET", "HEAD"]) {
  const response = await fetch(later, { method });
  results.push({
    method,
    status: response.status,
    contentLength: response.headers.get("content-length"),
    body: await response.text(),
  });
}
server.stop(true);
console.log(JSON.stringify(results));
`,
    });

    const firstResponse = { ...buildFailedResponses[0], closedByServer: true };
    const expected = {
      production: [firstResponse, ...buildFailedResponses.slice(1)],
      development: [firstResponse, ...buildFailedResponses.slice(1)],
      // The dev server answers the parked request from its own deferred
      // request path, which does not close the socket yet, and later requests
      // with its own plugin error body.
      hmr: [
        { ...firstResponse, closedByServer: false },
        { method: "GET", status: 500, contentLength: "12", body: "Plugin Error" },
        { method: "HEAD", status: 500, contentLength: "12", body: "" },
      ],
    };

    await Promise.all(
      Object.entries(expected).map(async ([mode, responses]) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "serve-fixture.ts", mode],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toContain("Failed to load plugins for Bun.serve");
        expect(stderr).toContain("setup failed on purpose");
        expect(JSON.parse(stdout)).toEqual(responses);
        expect(exitCode).toBe(0);
      }),
    );
  });
});
