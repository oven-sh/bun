import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isDebug, tempDirWithFiles } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/24180
// When building fullstack apps with --compile, asset paths in HTML should be
// absolute (starting with `/`) not relative (starting with `./`). Relative paths
// cause 404 errors when navigating to routes other than `/`.
test.skipIf(isDebug)("fullstack compile uses absolute asset paths in generated HTML", async () => {
  const dir = tempDirWithFiles("24180", {
    "index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <script type="module" src="./client.ts"></script>
    <div id="app">Hello</div>
  </body>
</html>
`,
    "styles.css": `
body {
  background: red;
}
`,
    "client.ts": `
console.log("loaded");
`,
    "server.ts": `
import html from "./index.html";

export default {
  port: 0,
  static: {
    "/": html,
    "/about": html,
  },
  fetch(req) {
    return new Response("Not found", { status: 404 });
  },
};
`,
  });

  const outfile = path.join(dir, "myapp");

  // Build the fullstack app with --compile
  const buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./server.ts", "--outfile", outfile],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    new Response(buildProc.stdout).text(),
    new Response(buildProc.stderr).text(),
    buildProc.exited,
  ]);

  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // On Windows, the compiler may append ".exe" to the output file
  const exePath = fs.existsSync(outfile) ? outfile : outfile + ".exe";
  expect(fs.existsSync(exePath)).toBe(true);

  // Run the compiled executable with await using for automatic cleanup
  await using serverProc = Bun.spawn({
    cmd: [exePath],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read stderr to get the dynamically assigned port
  // The server outputs something like "Started development server: http://localhost:PORT"
  const reader = serverProc.stderr.getReader();
  const decoder = new TextDecoder();
  let stderrOutput = "";
  let port: number | null = null;

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    stderrOutput += decoder.decode(value, { stream: true });
    // Match various host formats: localhost:PORT, 127.0.0.1:PORT, [::1]:PORT, http://host:PORT
    const match = stderrOutput.match(/(?:https?:\/\/)?(?:\[[^\]]+\]|[\w.-]+):(\d+)/);
    if (match) {
      port = parseInt(match[1], 10);
      break;
    }
  }
  reader.releaseLock();

  if (port === null) {
    throw new Error(`Failed to detect server port from stderr output:\n${stderrOutput}`);
  }

  // Fetch the HTML from the root route
  const rootUrl = `http://localhost:${port}/`;
  const res = await fetch(rootUrl);
  expect(res.status).toBe(200);
  const html = await res.text();

  // Check that the CSS and JS paths are absolute, not relative
  // They should start with `/` not `./`
  const cssMatch = html.match(/href="([^"]+\.css)"/);
  const jsMatch = html.match(/src="([^"]+\.js)"/);

  expect(cssMatch).not.toBeNull();
  expect(jsMatch).not.toBeNull();

  const cssPath = cssMatch![1];
  const jsPath = jsMatch![1];

  // Verify paths are absolute (start with /)
  expect(cssPath.startsWith("/")).toBe(true);
  expect(jsPath.startsWith("/")).toBe(true);

  // Verify paths don't use relative notation
  expect(cssPath.startsWith("./")).toBe(false);
  expect(jsPath.startsWith("./")).toBe(false);

  // Also verify the assets are actually accessible
  const cssRes = await fetch(`http://localhost:${port}${cssPath}`);
  expect(cssRes.status).toBe(200);
  const cssContent = await cssRes.text();
  expect(cssContent).toContain("background");

  const jsRes = await fetch(`http://localhost:${port}${jsPath}`);
  expect(jsRes.status).toBe(200);
  const jsContent = await jsRes.text();
  expect(jsContent).toContain("loaded");
});
