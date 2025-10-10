import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/23431
test("HTML imports in compiled executable use absolute paths for assets", async () => {
  using dir = tempDir("issue-23431", {
    "server.ts": `
import indexPage from "./index.html";

const server = Bun.serve({
  port: 0,
  routes: {
    '/*': indexPage
  }
});

console.log(\`PORT:\${server.port}\`);
`,
    "index.html": `<!doctype html>
<html>
  <head>
    <title>Test</title>
    <script type="module" src="./client.ts"></script>
  </head>
  <body></body>
</html>`,
    "client.ts": `console.log("loaded");`,
  });

  // Compile the server
  const buildResult = Bun.spawnSync({
    cmd: [bunExe(), "build", "server.ts", "--compile", "--outfile", "server"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(buildResult.exitCode).toBe(0);

  // Run the compiled server
  await using server = Bun.spawn({
    cmd: [join(String(dir), "server")],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read port from stdout
  const reader = server.stdout.getReader();
  const { value } = await reader.read();
  const output = new TextDecoder().decode(value);
  const portMatch = output.match(/PORT:(\d+)/);

  if (!portMatch) {
    throw new Error(`Could not find port in output: ${output}`);
  }

  const port = parseInt(portMatch[1]);

  try {
    // Test that assets use absolute paths at nested routes
    const response = await fetch(`http://localhost:${port}/foo/bar`);
    const html = await response.text();

    // Should use /chunk.js (absolute), not ./chunk.js (relative)
    // The chunk name will have a hash, so we check for the pattern
    expect(html).toMatch(/src="\/chunk-[a-z0-9]+\.js"/);
    expect(html).not.toContain('src="./chunk-');

    // Also verify at root path
    const rootResponse = await fetch(`http://localhost:${port}/`);
    const rootHtml = await rootResponse.text();
    expect(rootHtml).toMatch(/src="\/chunk-[a-z0-9]+\.js"/);
  } finally {
    server.kill();
  }
});
