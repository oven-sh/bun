import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("Bun.serve static routes with Bun.file and blobs", async () => {
  using dir = tempDir("test-bunfile-routes", {
    "index.html": `<!DOCTYPE html>
<html>
  <head><title>Test Page</title></head>
  <body><h1>Hello from file!</h1></body>
</html>`,
    "style.css": `body { background: green; }`,
    "server.ts": `
import path from "path";

// Test 1: Create a blob from string (bytes blob)
const htmlContent = \`<!DOCTYPE html>
<html>
  <head><title>Memory Page</title></head>
  <body><h1>Hello from memory!</h1></body>
</html>\`;
const blob = new Blob([htmlContent], { type: "text/html" });

// Test 2: Direct Bun.file() usage (this fix enables this in standalone)
const indexFile = Bun.file(path.join(import.meta.dir, "index.html"));
const styleFile = Bun.file(path.join(import.meta.dir, "style.css"));

const server = Bun.serve({
  port: 0,
  // Use the 'routes' property (newer API) which accepts both Response and direct Bun.file()
  routes: {
    // Test in-memory blob wrapped in Response
    "/memory": new Response(blob),
    // Test direct Bun.file() wrapped in Response
    "/": new Response(indexFile),
    "/style.css": new Response(styleFile),
    // Test plain text response
    "/text": new Response("Static text response"),
    // Test direct Bun.file() (this is what the fix enables)
    "/direct": indexFile,
    "/direct-style": styleFile,
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("PORT:" + server.port);

// Keep server running for tests
await Bun.sleep(3000);
server.stop();
`,
  });

  // Run the server
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", String(dir) + "/server.ts"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  // Get the port from stdout
  const reader = proc.stdout.getReader();
  let portLine = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = new TextDecoder().decode(value);
    portLine += text;
    if (portLine.includes("PORT:")) break;
  }

  const port = portLine.match(/PORT:(\d+)/)?.[1];
  expect(port).toBeDefined();

  const baseURL = `http://localhost:${port}`;

  // Test in-memory blob response
  {
    const response = await fetch(baseURL + "/memory");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from memory!");
  }

  // Test Bun.file() wrapped in Response
  {
    const response = await fetch(baseURL + "/");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from file!");
  }

  // Test CSS file
  {
    const response = await fetch(baseURL + "/style.css");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("background: green");
  }

  // Test plain text response
  {
    const response = await fetch(baseURL + "/text");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("Static text response");
  }

  // Test direct Bun.file() in routes (new fix)
  {
    const response = await fetch(baseURL + "/direct");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from file!");
  }

  // Test direct style file in routes
  {
    const response = await fetch(baseURL + "/direct-style");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("background: green");
  }

  // Test 404
  {
    const response = await fetch(baseURL + "/not-found");
    expect(response.status).toBe(404);
  }

  // Clean up
  proc.kill();
  await proc.exited;
});