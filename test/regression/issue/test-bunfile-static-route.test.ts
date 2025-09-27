import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.serve static routes with Bun.file work for in-memory blobs", async () => {
  using dir = tempDir("test-bunfile-static", {
    "index.html": `<!DOCTYPE html>
<html>
  <head><title>Test Page</title></head>
  <body><h1>Hello World!</h1></body>
</html>`,
    "server.ts": `
const htmlContent = \`<!DOCTYPE html>
<html>
  <head><title>Test Page</title></head>
  <body><h1>Hello from memory!</h1></body>
</html>\`;

// Create a blob from string (this will be a bytes blob, not a file blob)
const blob = new Blob([htmlContent], { type: "text/html" });

const server = Bun.serve({
  port: 0,
  static: {
    "/": new Response(blob),
    "/test": new Response("Static text response"),
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("PORT:" + server.port);

// Keep server running for a bit
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

  // Test that static routes work
  const baseURL = `http://localhost:${port}`;

  // Test blob response
  {
    const response = await fetch(baseURL + "/");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from memory!");
  }

  // Test text response
  {
    const response = await fetch(baseURL + "/test");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("Static text response");
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
