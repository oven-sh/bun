import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isDebug, tempDirWithFiles } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/24180
// When building fullstack apps with --compile, asset paths in HTML should be
// absolute (starting with `/`) not relative (starting with `./`). Relative paths
// cause 404 errors when navigating to routes other than `/`.
test.skipIf(isDebug)("fullstack compile uses absolute asset paths in generated HTML", { timeout: 60_000 }, async () => {
  // Use a fixed port for testing - the compiled app will use this
  const port = 49842;

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
  port: ${port},
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
  expect(fs.existsSync(outfile)).toBe(true);

  // Run the compiled executable with await using for automatic cleanup
  await using serverProc = Bun.spawn({
    cmd: [outfile],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });

  // Wait for server to be ready by polling the HTTP endpoint
  let res: Response | undefined;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      res = await fetch(`http://localhost:${port}/`);
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  if (!res) {
    throw new Error("Server did not start within timeout");
  }
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
