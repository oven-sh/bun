import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("Bun.serve static routes with real Bun.file", async () => {
  using dir = tempDir("test-bunfile-real", {
    "index.html": `<!DOCTYPE html>
<html>
  <head><title>Test Page</title></head>
  <body><h1>Hello from file!</h1></body>
</html>`,
    "style.css": `body { background: green; }`,
    "server.ts": `
import path from "path";

const server = Bun.serve({
  port: 0,
  static: {
    "/": new Response(Bun.file(path.join(import.meta.dir, "index.html"))),
    "/style.css": new Response(Bun.file(path.join(import.meta.dir, "style.css"))),
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

  // Test HTML file
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

  // Test 404
  {
    const response = await fetch(baseURL + "/not-found");
    expect(response.status).toBe(404);
  }

  // Clean up
  proc.kill();
  await proc.exited;
});